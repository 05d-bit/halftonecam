import React, { useEffect, useRef, useState } from "react";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const offscreenCanvas = useRef(null);
  const rafId = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);

  // --- 실시간 값 보장을 위한 Mutable Ref ---
  const settings = useRef({
    dotScale: 0.8,
    cellSize: 10,
    gamma: 1.0,
    brightness: 0.0,
    contrast: 1.1,
    bgTone: 255,
    invert: false,
    colorMode: "color",
    shape: "circle",
    mirror: true
  });

  // UI 리렌더링을 위한 상태 (값 표시용)
  const [ui, setUi] = useState({ ...settings.current });
  const [mode, setMode] = useState("webcam");
  const [isRec, setIsRec] = useState(false);

  // 값 즉시 업데이트 함수
  const change = (key, val) => {
    settings.current[key] = val;
    setUi({ ...settings.current });
  };

  useEffect(() => {
    offscreenCanvas.current = document.createElement("canvas");
    startSource();
    render(); // 루프 시작
    return () => {
      cancelAnimationFrame(rafId.current);
      stopTracks();
    };
  }, []);

  const stopTracks = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    }
  };

  const startSource = async () => {
    try {
      stopTracks();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      videoRef.current.srcObject = stream;
      videoRef.current.play();
    } catch (e) { console.error("카메라 에러"); }
  };

  const render = () => {
    const loop = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && v.readyState >= 2 && c) {
        processFrame(v, c);
      }
      rafId.current = requestAnimationFrame(loop);
    };
    rafId.current = requestAnimationFrame(loop);
  };

  const processFrame = (video, canvas) => {
    const s = settings.current;
    const ctx = canvas.getContext("2d", { alpha: false });
    const off = offscreenCanvas.current;
    const octx = off.getContext("2d", { willReadFrequently: true });

    const w = Math.min(window.innerWidth - 450, 1200);
    const h = (video.videoHeight / video.videoWidth) * w;

    if (canvas.width !== w) {
      canvas.width = w; canvas.height = h;
      off.width = w; off.height = h;
    }

    // 1. 소스 그리기
    octx.save();
    if (mode === "webcam" && s.mirror) {
      octx.translate(w, 0); octx.scale(-1, 1);
    }
    octx.drawImage(video, 0, 0, w, h);
    octx.restore();

    const img = octx.getImageData(0, 0, w, h);
    const data = img.data;

    // 2. 배경 칠하기
    ctx.fillStyle = `rgb(${s.bgTone}, ${s.bgTone}, ${s.bgTone})`;
    ctx.fillRect(0, 0, w, h);

    // 3. 하프톤 연산
    const step = s.cellSize;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (Math.floor(y) * w + Math.floor(x)) * 4;
        
        const tone = (v) => {
          let res = Math.pow(v / 255, 1 / s.gamma);
          res = (res - 0.5) * s.contrast + 0.5 + s.brightness;
          return s.invert ? 1 - clamp(res, 0, 1) : clamp(res, 0, 1);
        };

        const r = tone(data[i]), g = tone(data[i+1]), b = tone(data[i+2]);
        const size = (step / 2) * s.dotScale;

        if (s.colorMode === "color") {
          ctx.globalCompositeOperation = "multiply";
          // 색상 보정: 더 선명한 CMY 톤 적용
          ctx.fillStyle = "rgba(255, 0, 100, 0.9)";
          drawDot(ctx, s.shape, x, y, size * r);
          ctx.fillStyle = "rgba(0, 200, 255, 0.9)";
          drawDot(ctx, s.shape, x + step * 0.15, y, size * g);
          ctx.fillStyle = "rgba(255, 220, 0, 0.9)";
          drawDot(ctx, s.shape, x, y + step * 0.15, size * b);
        } else {
          ctx.globalCompositeOperation = "source-over";
          const gray = r * 0.299 + g * 0.587 + b * 0.114;
          const v = Math.round(255 - gray * 255);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          drawDot(ctx, s.shape, x, y, size * gray * 1.5);
        }
      }
    }
    ctx.globalCompositeOperation = "source-over";
  };

  const drawDot = (ctx, type, x, y, r) => {
    if (r < 0.3) return;
    ctx.beginPath();
    if (type === "square") ctx.rect(x - r, y - r, r * 2, r * 2);
    else if (type === "diamond") {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    } else if (type === "triangle") {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath();
    } else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const toggleRec = () => {
    if (isRec) { recorder.current.stop(); setIsRec(false); }
    else {
      chunks.current = [];
      const stream = canvasRef.current.captureStream(30);
      recorder.current = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.current.ondataavailable = e => chunks.current.push(e.data);
      recorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "halftone.webm"; a.click();
      };
      recorder.current.start();
      setIsRec(true);
    }
  };

  const btn = (a) => ({
    padding: "12px", border: "1px solid #333", borderRadius: "8px",
    background: a ? "#fff" : "#111", color: a ? "#000" : "#fff", cursor: "pointer", fontWeight: "bold"
  });

  return (
    <div style={{ display: "flex", gap: "20px", padding: "20px", background: "#000", minHeight: "100vh", color: "#fff" }}>
      <div style={{ flex: 1, background: "#050505", border: "1px solid #222", borderRadius: "15px", overflow: "hidden" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "auto" }} />
      </div>
      <div style={{ width: "350px", display: "flex", flexDirection: "column", gap: "15px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <button onClick={() => { setMode("webcam"); startSource(); }} style={btn(mode === "webcam")}>카메라</button>
          <label style={{ ...btn(mode === "file"), textAlign: "center" }}>파일<input type="file" hidden onChange={e => {
            setMode("file"); stopTracks();
            videoRef.current.src = URL.createObjectURL(e.target.files[0]);
            videoRef.current.play();
          }} /></label>
        </div>
        {[
          { k: "dotScale", n: "점 크기", min: 0.1, max: 2, st: 0.05 },
          { k: "cellSize", n: "입자 밀도", min: 5, max: 50, st: 1 },
          { k: "gamma", n: "감마", min: 0.1, max: 3.0, st: 0.1 },
          { k: "bgTone", n: "배경 밝기", min: 0, max: 255, st: 1 },
        ].map(i => (
          <div key={i.k}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "5px" }}><span>{i.n}</span><span>{ui[i.k]}</span></div>
            <input type="range" min={i.min} max={i.max} step={i.st} value={ui[i.k]} onChange={e => change(i.k, Number(e.target.value))} style={{ width: "100%" }} />
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <button onClick={() => change("colorMode", "color")} style={btn(ui.colorMode === "color")}>RGB</button>
          <button onClick={() => change("colorMode", "mono")} style={btn(ui.colorMode === "mono")}>흑백</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "5px" }}>
          {["circle", "square", "triangle", "diamond"].map(t => (
            <button key={t} onClick={() => change("shape", t)} style={btn(ui.shape === t)}>{t[0].toUpperCase()}</button>
          ))}
        </div>
        <button onClick={() => change("invert", !ui.invert)} style={btn(ui.invert)}>색상 반전</button>
        <button onClick={toggleRec} style={{ ...btn(isRec), background: isRec ? "#f00" : "#333", marginTop: "10px" }}>
          {isRec ? "녹화 중지" : "녹화 시작"}
        </button>
      </div>
      <video ref={videoRef} style={{ display: "none" }} playsInline muted loop />
    </div>
  );
}

export default App;
