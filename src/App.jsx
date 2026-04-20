import React, { useEffect, useRef, useState } from "react";

// --- 유틸리티 및 수식 보존 ---
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function App() {
  const sourceVideoRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const offscreenRef = useRef(null);
  const rafRef = useRef(0);
  const webcamStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // --- [핵심] 실시간 값 참조를 위한 Ref ---
  const params = useRef({
    dotScale: 0.8,
    cellSize: 10,
    brightness: 0.0,
    contrast: 1.1,
    gamma: 1.0,
    invert: false,
    colorMode: "color",
    shape: "circle",
    bgTone: 255,
    mirror: true
  });

  // UI 상태 동기화용
  const [ui, setUi] = useState({ ...params.current });
  const [sourceMode, setSourceMode] = useState("webcam");
  const [isRecording, setIsRecording] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth <= 980);

  // 값 변경 함수
  const setParam = (key, val) => {
    params.current[key] = val;
    setUi({ ...params.current }); // UI 업데이트
  };

  useEffect(() => {
    offscreenRef.current = document.createElement("canvas");
    const handleResize = () => setIsMobile(window.innerWidth <= 980);
    window.addEventListener("resize", handleResize);
    
    if (sourceMode === "webcam") startWebcam();
    renderLoop(); // 루프 시작

    return () => {
      window.removeEventListener("resize", handleResize);
      stopWebcam();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      webcamStreamRef.current = stream;
      if (sourceVideoRef.current) {
        sourceVideoRef.current.srcObject = stream;
        sourceVideoRef.current.play();
      }
    } catch (e) { alert("카메라를 켤 수 없습니다."); }
  };

  const stopWebcam = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(t => t.stop());
      webcamStreamRef.current = null;
    }
  };

  const renderLoop = () => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const draw = () => {
    const video = sourceVideoRef.current;
    const canvas = previewCanvasRef.current;
    const off = offscreenRef.current;
    if (!video || !canvas || !off || video.readyState < 2) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const octx = off.getContext("2d", { willReadFrequently: true });
    const p = params.current; // 실시간 값 참조

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = isMobile ? window.innerWidth - 40 : Math.min(window.innerWidth - 500, 1100);
    const ch = (vh / vw) * cw;

    if (canvas.width !== cw) {
      canvas.width = cw; canvas.height = ch;
      off.width = cw; off.height = ch;
    }

    // 1. 소스 그리기 (미러링 포함)
    octx.save();
    if (sourceMode === "webcam" && p.mirror) {
      octx.translate(cw, 0); octx.scale(-1, 1);
    }
    octx.drawImage(video, 0, 0, cw, ch);
    octx.restore();

    const { data } = octx.getImageData(0, 0, cw, ch);

    // 2. 배경색 칠하기
    ctx.fillStyle = `rgb(${p.bgTone},${p.bgTone},${p.bgTone})`;
    ctx.fillRect(0, 0, cw, ch);

    // 3. 하프톤 렌더링
    const step = Math.max(4, p.cellSize);
    for (let y = 0; y < ch; y += step) {
      for (let x = 0; x < cw; x += step) {
        const i = (Math.floor(y) * cw + Math.floor(x)) * 4;
        
        const process = (v) => {
          let val = Math.pow(v / 255, 1 / p.gamma);
          val = (val - 0.5) * p.contrast + 0.5 + p.brightness;
          return p.invert ? 1 - clamp(val, 0, 1) : clamp(val, 0, 1);
        };

        const tr = process(data[i]), tg = process(data[i+1]), tb = process(data[i+2]);
        const radius = (step / 2) * p.dotScale;

        if (p.colorMode === "color") {
          ctx.globalCompositeOperation = "multiply";
          ctx.fillStyle = "rgba(255, 0, 150, 0.8)";
          drawShapeInner(ctx, p.shape, x, y, radius * tr);
          ctx.fillStyle = "rgba(0, 255, 200, 0.8)";
          drawShapeInner(ctx, p.shape, x + step * 0.1, y, radius * tg);
          ctx.fillStyle = "rgba(255, 210, 0, 0.8)";
          drawShapeInner(ctx, p.shape, x, y + step * 0.1, radius * tb);
        } else {
          ctx.globalCompositeOperation = "source-over";
          const luma = tr * 0.299 + tg * 0.587 + tb * 0.114;
          const g = Math.round(255 - luma * 255);
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          drawShapeInner(ctx, p.shape, x, y, radius * luma * 1.6);
        }
      }
    }
    ctx.globalCompositeOperation = "source-over";
  };

  const drawShapeInner = (ctx, type, x, y, r) => {
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

  const handleRec = () => {
    if (isRecording) {
      recorderRef.current.stop();
      setIsRecording(false);
    } else {
      chunksRef.current = [];
      const stream = previewCanvasRef.current.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
      rec.ondataavailable = e => chunksRef.current.push(e.data);
      rec.onstop = () => downloadBlob(new Blob(chunksRef.current, { type: "video/webm" }), `output.webm`);
      rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
    }
  };

  const btnS = (a) => ({
    padding: "10px", borderRadius: "8px", border: "1px solid #333",
    background: a ? "#fff" : "#111", color: a ? "#000" : "#fff", cursor: "pointer", fontSize: "12px"
  });

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: "20px", padding: "20px", background: "#050505", minHeight: "100vh", color: "#fff" }}>
      <div style={{ flex: 1, background: "#000", borderRadius: "15px", border: "1px solid #222", overflow: "hidden" }}>
        <canvas ref={previewCanvasRef} style={{ width: "100%", height: "auto" }} />
      </div>

      <div style={{ width: isMobile ? "100%" : "360px", display: "flex", flexDirection: "column", gap: "12px", background: "#111", padding: "20px", borderRadius: "15px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <button onClick={() => { setSourceMode("webcam"); startWebcam(); }} style={btnS(sourceMode === "webcam")}>CAMERA</button>
          <label style={{ ...btnS(sourceMode === "file"), textAlign: "center" }}>FILE<input type="file" onChange={e => {
            setSourceMode("file"); stopWebcam();
            sourceVideoRef.current.src = URL.createObjectURL(e.target.files[0]);
            sourceVideoRef.current.play();
          }} hidden /></label>
        </div>

        <div style={{ height: "1px", background: "#222" }} />

        {[
          { k: "dotScale", n: "DOT SCALE", min: 0.1, max: 2, st: 0.05 },
          { k: "cellSize", n: "DENSITY", min: 5, max: 50, st: 1 },
          { k: "gamma", n: "GAMMA", min: 0.1, max: 3.0, st: 0.1 },
          { k: "bgTone", n: "BACKGROUND", min: 0, max: 255, st: 1 },
        ].map(i => (
          <div key={i.k}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#888", marginBottom: "4px" }}>
              <span>{i.n}</span><span>{ui[i.k]}</span>
            </div>
            <input type="range" min={i.min} max={i.max} step={i.st} value={ui[i.k]} onChange={e => setParam(i.k, Number(e.target.value))} style={{ width: "100%" }} />
          </div>
        ))}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <button onClick={() => setParam("colorMode", "color")} style={btnS(ui.colorMode === "color")}>RGB</button>
          <button onClick={() => setParam("colorMode", "mono")} style={btnS(ui.colorMode === "mono")}>MONO</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "5px" }}>
          {["circle", "square", "triangle", "diamond"].map(sh => (
            <button key={sh} onClick={() => setParam("shape", sh)} style={btnS(ui.shape === sh)}>{sh[0].toUpperCase()}</button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <button onClick={() => setParam("invert", !ui.invert)} style={btnS(ui.invert)}>INVERT</button>
          <button onClick={() => setParam("mirror", !ui.mirror)} style={btnS(ui.mirror)}>MIRROR</button>
        </div>

        <button onClick={handleRec} style={{ ...btnS(isRecording), background: isRecording ? "#ff4444" : "#333", marginTop: "10px", padding: "15px" }}>
          {isRecording ? "STOP RECORDING" : "START RECORDING"}
        </button>
      </div>
      <video ref={sourceVideoRef} style={{ display: "none" }} playsInline muted loop />
    </div>
  );
}

export default App;
