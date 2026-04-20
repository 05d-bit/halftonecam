import React, { useEffect, useMemo, useRef, useState } from "react";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawShape(ctx, shape, x, y, size) {
  const r = Math.max(size, 0.2);

  ctx.beginPath();

  if (shape === "square") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
    return;
  }

  if (shape === "diamond") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (shape === "triangle") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x - r, y + r);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (shape === "star") {
    const outer = r;
    const inner = r * 0.45;
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + (Math.PI / 5) * i;
      const radius = i % 2 === 0 ? outer : inner;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    return;
  }

  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function getMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return "video/webm;codecs=vp9";
  }
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
    return "video/webm;codecs=vp8";
  }
  if (MediaRecorder.isTypeSupported("video/webm")) {
    return "video/webm";
  }
  return "";
}

function processTone(v, gamma, contrast, brightness, invert) {
  let value = v / 255;
  value = Math.pow(value, 1 / gamma);
  value = (value - 0.5) * contrast + 0.5;
  value += brightness;
  value = clamp(value, 0, 1);
  if (invert) value = 1 - value;
  return value;
}

function App() {
  const sourceVideoRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const offscreenRef = useRef(null);
  const rafRef = useRef(0);
  const webcamStreamRef = useRef(null);
  const previewRecorderRef = useRef(null);
  const previewRecordedChunksRef = useRef([]);
  const exportVideoRef = useRef(null);

  const [sourceMode, setSourceMode] = useState("webcam");
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 980 : false
  );

  const [dotScale, setDotScale] = useState(0.43);
  const [cellSize, setCellSize] = useState(4);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1.17);
  const [gamma, setGamma] = useState(1);
  const [invert, setInvert] = useState(false);
  const [colorMode, setColorMode] = useState("color");
  const [shape, setShape] = useState("circle");
  const [bgTone, setBgTone] = useState(8);
  const [mirrorWebcam, setMirrorWebcam] = useState(true);

  const [isPreviewRecording, setIsPreviewRecording] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const logoSrc = "/logo.png";

  const shapeOptions = useMemo(
    () => [
      { value: "circle", label: "○" },
      { value: "square", label: "□" },
      { value: "triangle", label: "△" },
      { value: "diamond", label: "◇" },
      { value: "star", label: "★" },
    ],
    []
  );

  useEffect(() => {
    offscreenRef.current = document.createElement("canvas");

    const onResize = () => {
      setIsMobile(window.innerWidth <= 980);
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafRef.current);
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    if (sourceMode === "webcam") {
      void startWebcam();
    } else {
      stopWebcam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  async function startWebcam() {
    try {
      setError("");
      setReady(false);

      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      webcamStreamRef.current = stream;

      const video = sourceVideoRef.current;
      if (!video) return;

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      setReady(true);
      runPreview();
    } catch {
      setError("웹캠을 열 수 없습니다. 브라우저 권한을 확인해 주세요.");
      setReady(false);
    }
  }

  function stopWebcam() {
    const video = sourceVideoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      webcamStreamRef.current = null;
    }
  }

  function handleLoadedMetadata() {
    setReady(true);
    runPreview();
  }

  function handleUploadChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (videoUrl) URL.revokeObjectURL(videoUrl);

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setSourceMode("file");
    setError("");
    setReady(false);

    const video = sourceVideoRef.current;
    if (!video) return;

    video.srcObject = null;
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = async () => {
      try {
        await video.play();
      } catch {
        // autoplay block ignored
      }
      setReady(true);
      runPreview();
    };
  }

  function resetValues() {
    setDotScale(0.43);
    setCellSize(4);
    setBrightness(0);
    setContrast(1.17);
    setGamma(1);
    setInvert(false);
    setColorMode("color");
    setShape("circle");
    setBgTone(8);
    setMirrorWebcam(true);
  }

  function runPreview() {
    cancelAnimationFrame(rafRef.current);

    const loop = () => {
      const video = sourceVideoRef.current;
      const canvas = previewCanvasRef.current;
      if (video && canvas && video.videoWidth > 0 && video.videoHeight > 0) {
        renderHalftone(video, canvas, {
          mirror: sourceMode === "webcam" && mirrorWebcam,
        });
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }

  function renderHalftone(video, targetCanvas, { mirror = false } = {}) {
    const ctx = targetCanvas.getContext("2d", { willReadFrequently: true });
    const offscreen = offscreenRef.current;
    if (!ctx || !offscreen) return;

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;

    const panelApprox = isMobile ? 0 : 520;
    const horizontalPadding = isMobile ? 32 : 120;
    const maxPreviewWidth = Math.max(
      320,
      Math.min(window.innerWidth - horizontalPadding - panelApprox, 1180)
    );

    const displayWidth = maxPreviewWidth;
    const displayHeight = Math.round((vh / vw) * displayWidth);

    if (
      targetCanvas.width !== displayWidth ||
      targetCanvas.height !== displayHeight
    ) {
      targetCanvas.width = displayWidth;
      targetCanvas.height = displayHeight;
    }

    if (offscreen.width !== displayWidth || offscreen.height !== displayHeight) {
      offscreen.width = displayWidth;
      offscreen.height = displayHeight;
    }

    const octx = offscreen.getContext("2d", { willReadFrequently: true });
    if (!octx) return;

    octx.save();
    octx.clearRect(0, 0, displayWidth, displayHeight);

    if (mirror) {
      octx.translate(displayWidth, 0);
      octx.scale(-1, 1);
    }

    octx.drawImage(video, 0, 0, displayWidth, displayHeight);
    octx.restore();

    const imageData = octx.getImageData(0, 0, displayWidth, displayHeight);
    const data = imageData.data;

    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const bg = Math.round(clamp(bgTone, 0, 255));
    ctx.fillStyle = `rgb(${bg},${bg},${bg})`;
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    const step = Math.max(4, cellSize);
    const half = step / 2;

    for (let y = 0; y < displayHeight; y += step) {
      for (let x = 0; x < displayWidth; x += step) {
        const px = Math.min(displayWidth - 1, Math.floor(x + half));
        const py = Math.min(displayHeight - 1, Math.floor(y + half));
        const idx = (py * displayWidth + px) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const toneR = processTone(r, gamma, contrast, brightness, invert);
        const toneG = processTone(g, gamma, contrast, brightness, invert);
        const toneB = processTone(b, gamma, contrast, brightness, invert);

        const luma = processTone(
          r * 0.299 + g * 0.587 + b * 0.114,
          gamma,
          contrast,
          brightness,
          invert
        );

        const cx = x + half;
        const cy = y + half;

        if (colorMode === "color") {
          const base = step * dotScale * 0.5;
          const sizeR = base * toneR;
          const sizeG = base * toneG;
          const sizeB = base * toneB;

          ctx.globalCompositeOperation = "multiply";

          ctx.fillStyle = `rgba(255, 60, 100, 0.72)`;
          drawShape(ctx, shape, cx - step * 0.16, cy - step * 0.08, sizeR);

          ctx.fillStyle = `rgba(0, 210, 160, 0.68)`;
          drawShape(ctx, shape, cx + step * 0.14, cy - step * 0.02, sizeG);

          ctx.fillStyle = `rgba(70, 140, 255, 0.68)`;
          drawShape(ctx, shape, cx, cy + step * 0.14, sizeB);

          ctx.globalCompositeOperation = "source-over";
        } else {
          const radius = step * dotScale * 0.5 * luma;
          const gray = Math.round(235 - luma * 210);
          ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
          drawShape(ctx, shape, cx, cy, radius);
        }
      }
    }
  }

  function downloadFrame() {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `halftone-frame-${Date.now()}.png`);
    }, "image/png");
  }

  function startPreviewRecording() {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const mimeType = getMimeType();
    if (!mimeType) {
      setError("이 브라우저에서는 영상 녹화를 지원하지 않습니다.");
      return;
    }

    previewRecordedChunksRef.current = [];
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        previewRecordedChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(previewRecordedChunksRef.current, { type: mimeType });
      downloadBlob(blob, `halftone-webcam-${Date.now()}.webm`);
      setIsPreviewRecording(false);
    };

    previewRecorderRef.current = recorder;
    recorder.start(100);
    setIsPreviewRecording(true);
  }

  function stopPreviewRecording() {
    if (
      previewRecorderRef.current &&
      previewRecorderRef.current.state !== "inactive"
    ) {
      previewRecorderRef.current.stop();
    }
  }

  async function exportProcessedVideo() {
    if (sourceMode !== "file" || !videoUrl) return;

    const mimeType = getMimeType();
    if (!mimeType) {
      setError("이 브라우저에서는 영상 저장을 지원하지 않습니다.");
      return;
    }

    setError("");
    setIsExporting(true);
    setExportProgress(0);

    try {
      const video = exportVideoRef.current;
      if (!video) throw new Error("export video element missing");

      video.src = videoUrl;
      video.muted = true;
      video.currentTime = 0;
      await video.play().catch(() => {});

      await new Promise((resolve) => {
        if (video.readyState >= 2) resolve(true);
        else video.onloadedmetadata = () => resolve(true);
      });

      const exportCanvas = document.createElement("canvas");
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      exportCanvas.width = w;
      exportCanvas.height = h;

      const stream = exportCanvas.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 10_000_000,
      });

      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      const stopPromise = new Promise((resolve) => {
        recorder.onstop = resolve;
      });

      recorder.start(100);

      const drawFrame = () => {
        if (video.paused || video.ended) return;
        renderExportFrame(video, exportCanvas);
        if (video.duration > 0) {
          setExportProgress(video.currentTime / video.duration);
        }
        requestAnimationFrame(drawFrame);
      };

      video.currentTime = 0;
      await video.play();
      drawFrame();

      await new Promise((resolve) => {
        video.onended = resolve;
      });

      recorder.stop();
      await stopPromise;

      const blob = new Blob(chunks, { type: mimeType });
      downloadBlob(blob, `halftone-video-${Date.now()}.webm`);
      setExportProgress(1);
    } catch {
      setError("영상 저장 중 오류가 발생했습니다.");
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportProgress(0), 1200);
    }
  }

  function renderExportFrame(video, targetCanvas) {
    const ctx = targetCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const temp = document.createElement("canvas");
    temp.width = targetCanvas.width;
    temp.height = targetCanvas.height;
    const tctx = temp.getContext("2d", { willReadFrequently: true });
    if (!tctx) return;

    tctx.drawImage(video, 0, 0, targetCanvas.width, targetCanvas.height);
    const imageData = tctx.getImageData(
      0,
      0,
      targetCanvas.width,
      targetCanvas.height
    );
    const data = imageData.data;

    const bg = Math.round(clamp(bgTone, 0, 255));
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.fillStyle = `rgb(${bg},${bg},${bg})`;
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

    const step = Math.max(4, cellSize);
    const half = step / 2;

    for (let y = 0; y < targetCanvas.height; y += step) {
      for (let x = 0; x < targetCanvas.width; x += step) {
        const px = Math.min(targetCanvas.width - 1, Math.floor(x + half));
        const py = Math.min(targetCanvas.height - 1, Math.floor(y + half));
        const idx = (py * targetCanvas.width + px) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const toneR = processTone(r, gamma, contrast, brightness, invert);
        const toneG = processTone(g, gamma, contrast, brightness, invert);
        const toneB = processTone(b, gamma, contrast, brightness, invert);

        const luma = processTone(
          r * 0.299 + g * 0.587 + b * 0.114,
          gamma,
          contrast,
          brightness,
          invert
        );

        const cx = x + half;
        const cy = y + half;

        if (colorMode === "color") {
          const base = step * dotScale * 0.5;
          const sizeR = base * toneR;
          const sizeG = base * toneG;
          const sizeB = base * toneB;

          ctx.globalCompositeOperation = "multiply";

          ctx.fillStyle = `rgba(255, 60, 100, 0.72)`;
          drawShape(ctx, shape, cx - step * 0.16, cy - step * 0.08, sizeR);

          ctx.fillStyle = `rgba(0, 210, 160, 0.68)`;
          drawShape(ctx, shape, cx + step * 0.14, cy - step * 0.02, sizeG);

          ctx.fillStyle = `rgba(70, 140, 255, 0.68)`;
          drawShape(ctx, shape, cx, cy + step * 0.14, sizeB);

          ctx.globalCompositeOperation = "source-over";
        } else {
          const radius = step * dotScale * 0.5 * luma;
          const gray = Math.round(235 - luma * 210);
          ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
          drawShape(ctx, shape, cx, cy, radius);
        }
      }
    }
  }

  const pageStyle = {
    minHeight: "100vh",
    background: "#000",
    color: "#fff",
    padding: isMobile ? "18px 14px 24px" : "40px 28px 32px",
    boxSizing: "border-box",
  };

  const shellStyle = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 470px",
    gap: isMobile ? "18px" : "20px",
    alignItems: "start",
    maxWidth: "1600px",
    margin: "0 auto",
    paddingTop: isMobile ? "54px" : "0",
  };

  const panelStyle = {
    background: "rgba(10,10,10,0.96)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: isMobile ? "20px" : "24px",
    padding: isMobile ? "14px" : "18px",
    boxShadow: "0 16px 50px rgba(0,0,0,0.35)",
  };

  const previewWrapStyle = {
    ...panelStyle,
    padding: 0,
    overflow: "hidden",
  };

  const sectionTitle = {
    fontSize: "13px",
    color: "rgba(255,255,255,0.78)",
    marginBottom: "8px",
    fontWeight: 600,
  };

  const tabBtn = (active) => ({
    height: isMobile ? "48px" : "52px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: active ? "#f2f2f2" : "rgba(255,255,255,0.04)",
    color: active ? "#111" : "#fff",
    fontWeight: 700,
    fontSize: isMobile ? "16px" : "15px",
    cursor: "pointer",
  });

  const btn = (active = false) => ({
    minHeight: isMobile ? "52px" : "56px",
    borderRadius: "18px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: active ? "#f2f2f2" : "rgba(255,255,255,0.04)",
    color: active ? "#111" : "#fff",
    fontSize: isMobile ? "15px" : "14px",
    fontWeight: 700,
    cursor: "pointer",
  });

  const blockStyle = {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "18px",
    padding: isMobile ? "14px" : "16px",
  };

  const sliderBlock = {
    ...blockStyle,
    display: "grid",
    gap: "12px",
  };

  const sliderLabel = {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    fontSize: isMobile ? "15px" : "14px",
    color: "rgba(255,255,255,0.88)",
  };

  return (
    <div style={pageStyle}>
      <img
        src={logoSrc}
        alt="logo"
        style={{
          position: "fixed",
          top: isMobile ? "14px" : "28px",
          left: isMobile ? "18px" : "28px",
          width: isMobile ? "54px" : "66px",
          height: isMobile ? "54px" : "66px",
          objectFit: "contain",
          zIndex: 50,
          pointerEvents: "none",
        }}
      />

      {error && (
        <div
          style={{
            maxWidth: "1600px",
            margin: "0 auto 14px",
            background: "rgba(255,80,80,0.14)",
            border: "1px solid rgba(255,80,80,0.28)",
            color: "#ffd2d2",
            borderRadius: "14px",
            padding: "12px 14px",
            fontSize: "14px",
          }}
        >
          {error}
        </div>
      )}

      <div style={shellStyle}>
        <div style={previewWrapStyle}>
          <canvas
            ref={previewCanvasRef}
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              background: "#050505",
            }}
          />
        </div>

        <div style={panelStyle}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
              marginBottom: "14px",
            }}
          >
            <button
              onClick={() => setSourceMode("webcam")}
              style={tabBtn(sourceMode === "webcam")}
            >
              웹캠
            </button>
            <button
              onClick={() => setSourceMode("file")}
              style={tabBtn(sourceMode === "file")}
            >
              영상 파일
            </button>
          </div>

          <div style={{ ...blockStyle, marginBottom: "14px" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "110px",
                  height: "44px",
                  borderRadius: "10px",
                  background: "#f2f2f2",
                  color: "#111",
                  fontWeight: 700,
                }}
              >
                파일 선택
              </span>
              <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "14px" }}>
                {videoUrl ? "영상 파일 선택됨" : "선택된 파일 없음"}
              </span>
              <input
                type="file"
                accept="video/*"
                onChange={handleUploadChange}
                style={{ display: "none" }}
              />
            </label>

            <div
              style={{
                marginTop: "14px",
                color: "rgba(255,255,255,0.42)",
                fontSize: "14px",
                textAlign: "center",
              }}
            >
              {videoUrl
                ? "불러온 영상으로 프리뷰 중입니다."
                : "아직 선택된 영상 파일이 없습니다."}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "10px",
              marginBottom: "14px",
            }}
          >
            <button
              onClick={() => setColorMode("mono")}
              style={btn(colorMode === "mono")}
            >
              B/W
            </button>
            <button
              onClick={() => setColorMode("color")}
              style={btn(colorMode === "color")}
            >
              RGB
            </button>
            <button style={{ ...btn(false), opacity: 0.5, cursor: "default" }}>
              CMYK
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              gap: "10px",
              marginBottom: "14px",
            }}
          >
            {shapeOptions.map((item) => (
              <button
                key={item.value}
                onClick={() => setShape(item.value)}
                style={btn(shape === item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "10px",
              marginBottom: "14px",
            }}
          >
            <button onClick={() => setInvert((v) => !v)} style={btn(invert)}>
              Invert {invert ? "On" : "Off"}
            </button>
            <button
              onClick={() => setMirrorWebcam((v) => !v)}
              style={btn(mirrorWebcam)}
            >
              좌우반전 {mirrorWebcam ? "On" : "Off"}
            </button>
            <button
              onClick={() => setSourceMode((prev) => (prev === "webcam" ? "file" : "webcam"))}
              style={btn(false)}
            >
              카메라 전환
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: "12px",
              marginBottom: "14px",
            }}
          >
            <div style={sliderBlock}>
              <div style={sectionTitle}>Dot</div>
              <div style={sliderLabel}>
                <span>크기</span>
                <span>{dotScale.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="1.4"
                step="0.01"
                value={dotScale}
                onChange={(e) => setDotScale(Number(e.target.value))}
              />
            </div>

            <div style={sliderBlock}>
              <div style={sectionTitle}>Contrast</div>
              <div style={sliderLabel}>
                <span>대비</span>
                <span>{contrast.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.4"
                step="0.01"
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
              />
            </div>

            <div style={sliderBlock}>
              <div style={sectionTitle}>Brightness</div>
              <div style={sliderLabel}>
                <span>밝기</span>
                <span>{brightness.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="-0.4"
                max="0.4"
                step="0.01"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
              />
            </div>

            <div style={sliderBlock}>
              <div style={sectionTitle}>Gamma</div>
              <div style={sliderLabel}>
                <span>감마</span>
                <span>{gamma.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.4"
                step="0.01"
                value={gamma}
                onChange={(e) => setGamma(Number(e.target.value))}
              />
            </div>

            <div style={sliderBlock}>
              <div style={sectionTitle}>Softness</div>
              <div style={sliderLabel}>
                <span>간격</span>
                <span>{cellSize}</span>
              </div>
              <input
                type="range"
                min="4"
                max="28"
                step="1"
                value={cellSize}
                onChange={(e) => setCellSize(Number(e.target.value))}
              />
            </div>

            <div style={sliderBlock}>
              <div style={sectionTitle}>Threshold</div>
              <div style={sliderLabel}>
                <span>배경톤</span>
                <span>{bgTone}</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="1"
                value={bgTone}
                onChange={(e) => setBgTone(Number(e.target.value))}
              />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: "10px",
            }}
          >
            {!isPreviewRecording ? (
              <button
                onClick={startPreviewRecording}
                disabled={!ready}
                style={{
                  ...btn(false),
                  opacity: ready ? 1 : 0.45,
                  cursor: ready ? "pointer" : "not-allowed",
                }}
              >
                웹캠 녹화 저장
              </button>
            ) : (
              <button onClick={stopPreviewRecording} style={btn(true)}>
                녹화 종료
              </button>
            )}

            <button onClick={downloadFrame} style={btn(false)}>
              프레임 저장
            </button>

            <button
              onClick={exportProcessedVideo}
              disabled={isExporting || sourceMode !== "file"}
              style={{
                ...btn(isExporting),
                opacity: isExporting || sourceMode !== "file" ? 0.5 : 1,
                cursor:
                  isExporting || sourceMode !== "file"
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {isExporting
                ? `영상 저장 중 ${Math.round(exportProgress * 100)}%`
                : "하프톤 영상 저장"}
            </button>

            <button onClick={resetValues} style={btn(false)}>
              기본값 복원
            </button>
          </div>

          <div
            style={{
              marginTop: "14px",
              fontSize: "13px",
              color: "rgba(255,255,255,0.62)",
              textAlign: "center",
            }}
          >
            {ready
              ? sourceMode === "webcam"
                ? "웹캠 프리뷰 활성화"
                : "영상 파일 프리뷰 활성화"
              : "소스를 준비 중입니다"}
          </div>
        </div>
      </div>

      <video
        ref={sourceVideoRef}
        playsInline
        muted
        style={{ display: "none" }}
        onLoadedMetadata={handleLoadedMetadata}
      />
      <video ref={exportVideoRef} playsInline muted style={{ display: "none" }} />
    </div>
  );
}

export default App;
