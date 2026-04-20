import React, { useEffect, useMemo, useRef, useState } from "react";

// --- 유틸리티 함수 ---
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// --- 도형 그리기 ---
const drawShape = (ctx, shape, x, y, size) => {
  if (size <= 0.2) return;
  ctx.beginPath();
  if (shape === "square") ctx.rect(x - size, y - size, size * 2, size * 2);
  else if (shape === "diamond") {
    ctx.moveTo(x, y - size); ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size); ctx.lineTo(x - size, y); ctx.closePath();
  } else if (shape === "triangle") {
    ctx.moveTo(x, y - size); ctx.lineTo(x + size, y + size);
    ctx.lineTo(x - size, y + size); ctx.closePath();
  } else if (shape === "star") {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? size : size * 0.45;
      const a = -Math.PI / 2 + (Math.PI / 5) * i;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  } else ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
};

const processTone = (v, gamma, contrast, brightness, invert) => {
  let val = v / 255;
  val = Math.pow(val, 1 / gamma);
  val = (val - 0.5) * contrast + 0.5;
  val += brightness;
  val = clamp(val, 0, 1);
  return invert ? 1 - val : val;
};

function App() {
  // Refs
  const sourceVideoRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const offscreenRef = useRef(null);
  const rafRef = useRef(0);
  const webcamStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // States
  const [sourceMode, setSourceMode] = useState("webcam");
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth <= 980);
  const [ready, setReady] = useState(false);

  // 필터 설정 (검은 화면 방지를 위해 bgTone 기본값을 255로 설정)
  const [dotScale, setDotScale] = useState(0.8);
  const [cellSize, setCellSize] = useState(10);
  const [brightness, setBrightness] = useState(0.0);
  const [contrast, setContrast] = useState(1.1);
  const [gamma, setGamma] = useState(1.0);
  const [invert, setInvert] = useState(false);
  const [colorMode, setColorMode] = useState("color"); // 'color' or 'mono'
  const [shape, setShape] = useState("circle");
  const [bgTone, setBgTone] = useState(255); 
  const [mirrorWebcam, setMirrorWebcam] = useState(true);

  // 녹화 관련 상태
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    offscreenRef.current = document.createElement("canvas");
    const handleResize = () => setIsMobile(window.innerWidth <= 980);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      stopWebcam();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (sourceMode === "webcam") startWebcam();
  }, [sourceMode]);

  const startWebcam = async () => {
    try {
      stopWebcam();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      webcamStreamRef.current = stream;
      if (sourceVideoRef.current) {
        sourceVideoRef.current.srcObject = stream;
        sourceVideoRef.current.onloadedmetadata = () => {
          sourceVideoRef.current.play();
          setReady(true);
          renderLoop();
        };
      }
    } catch (e) { console.error("Webcam error:", e); }
  };

  const stopWebcam = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
  };

  const renderLoop = () => {
    cancelAnimationFrame(rafRef.current);
    const loop = () => {
      if (sourceVideoRef.current && previewCanvasRef.current) {
        drawHalftone(sourceVideoRef.current, previewCanvasRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const drawHalftone = (video, canvas) => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const off = offscreenRef.current;
    if (!ctx || !off || video.videoWidth === 0) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = isMobile ? window.innerWidth - 40 : Math.min(window.innerWidth - 500, 1000);
    const ch = (vh / vw) * cw;

    if (canvas.width !== cw) {
      canvas.width = cw; canvas.height = ch;
      off.width = cw; off.height = ch;
    }

    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.save();
    if (sourceMode === "webcam" && mirrorWebcam) {
      octx.translate(cw, 0); octx.scale(-1, 1);
    }
    octx.drawImage(video, 0, 0, cw, ch);
    octx.restore();

    const { data } = octx.getImageData(0, 0, cw, ch);
    
    // 배경 채우기 (bgTone이 낮으면 검게 나오므로 주의)
    ctx.fillStyle = `rgb(${bgTone},${bgTone},${bgTone})`;
    ctx.fillRect(0, 0, cw, ch);

    const step = Math.max(4, cellSize);
    for (let y = 0; y < ch; y += step) {
      for (let x = 0; x < cw; x += step) {
        const i = (Math.floor(y) * cw + Math.floor(x)) * 4;
        const r = data[i], g = data[i+1], b = data[i+2];
        
        const tr = processTone(r, gamma, contrast, brightness, invert);
        const tg = processTone(g, gamma, contrast, brightness, invert);
        const tb = processTone(b, gamma, contrast, brightness, invert);
        const luma = (tr * 0.299 + tg * 0.587 + tb * 0.114);

        const radius = (step / 2) * dotScale;

        if (colorMode === "color") {
          ctx.globalCompositeOperation = "multiply";
          ctx.fillStyle = "rgba(255,0,150,0.7)"; // Magenta-ish
          drawShape(ctx, shape, x, y, radius * tr);
          ctx.fillStyle = "rgba(0,255,200,0.7)"; // Cyan-ish
          drawShape(ctx, shape, x + step*0.1, y, radius * tg);
          ctx.fillStyle = "rgba(255,200,0,0.7)"; // Yellow-ish
          drawShape(ctx, shape, x, y + step*0.1, radius * tb);
          ctx.globalCompositeOperation = "source-over";
        } else {
          const gVal = Math.round(255 - luma * 255);
          ctx.fillStyle = `rgb(${gVal},${gVal},${gVal})`;
          drawShape(ctx, shape, x, y, radius * luma * 1.5);
        }
      }
    }
  };

  // --- 녹화 기능 추가 ---
  const toggleRecording = () => {
    if (isRecording) {
      recorderRef.current.stop();
      setIsRecording(false);
    } else {
      chunksRef.current = [];
      const stream = previewCanvasRef.current.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        downloadBlob(blob, `halftone-record-${Date.now()}.webm`);
      };
      rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      stopWebcam();
      setSourceMode("file");
      const url = URL.createObjectURL(file);
      sourceVideoRef.current.srcObject = null;
      sourceVideoRef.current.src = url;
      sourceVideoRef.current.play();
      renderLoop();
    }
  };

  const sBtn = (active) => ({
    padding: "10px", borderRadius: "8px", border: "1px solid #333",
    background: active ? "#fff" : "#111", color: active ? "#000" : "#fff",
    cursor: "pointer", fontWeight: "bold", fontSize: "13px"
  });

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: "20px", padding: "20px", background: "#000", minHeight: "100vh", color: "#fff" }}>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-start", background: "#0a0a0a", borderRadius: "15px", overflow: "hidden", border: "1px solid #222" }}>
        <canvas ref={previewCanvasRef} style={{ maxWidth: "100%", height: "auto" }} />
      </div>

      <div style={{ width: isMobile ? "100%" : "380px", display: "flex", flexDirection: "column", gap: "15px", background: "#111", padding: "20px", borderRadius: "15px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <button onClick={() => setSourceMode("webcam")} style={sBtn(sourceMode === "webcam")}>카메라</button>
          <label style={{ ...sBtn(sourceMode === "file"), textAlign: "center" }}>
            영상 파일<input type="file" onChange={handleFileUpload} hidden />
          </label>
        </div>

        <div style={{ height: "1px", background: "#222" }} />

        {[
          { n: "점 크기", v: dotScale, s: setDotScale, min: 0.1, max: 2, st: 0.05 },
          { n: "입자 밀도", v: cellSize, s: setCellSize, min: 5, max: 50, st: 1 },
          { n: "밝기", v: brightness, s: setBrightness, min: -0.5, max: 0.5, st: 0.01 },
          { n: "대비", v: contrast, s: setContrast, min: 0.5, max: 2.5, st: 0.1 },
          { n: "배경톤", v: bgTone, s: setBgTone, min: 0, max: 255, st: 1 },
        ].map(i => (
          <div key={i.n}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "5px", color: "#888" }}>
              <span>{i.n}</span><span>{i.v}</span>
            </div>
            <input type="range" min={i.min} max={i.max} step={i.st} value={i.v} onChange={e => i.s(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
        ))}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <button onClick={() => setColorMode("color")} style={sBtn(colorMode === "color")}>RGB 모드</button>
          <button onClick={() => setColorMode("mono")} style={sBtn(colorMode === "mono")}>단색 모드</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "5px" }}>
          {["circle", "square", "triangle", "diamond", "star"].map(sh => (
            <button key={sh} onClick={() => setShape(sh)} style={{ ...sBtn(shape === sh), padding: "5px", fontSize: "10px" }}>{sh.toUpperCase()}</button>
          ))}
        </div>

        <button onClick={toggleRecording} style={{ ...sBtn(isRecording), background: isRecording ? "#ff4444" : "#222", color: "#fff", marginTop: "10px", padding: "15px" }}>
          {isRecording ? "녹화 중지 및 저장" : "화면 녹화 시작"}
        </button>

        <button onClick={() => {
          const blob = previewCanvasRef.current.toBlob(b => downloadBlob(b, `snap-${Date.now()}.png`));
        }} style={{ ...sBtn(false), background: "#333" }}>현재 프레임 스크린샷</button>
      </div>

      <video ref={sourceVideoRef} style={{ display: "none" }} playsInline muted loop />
    </div>
  );
}

export default App;
