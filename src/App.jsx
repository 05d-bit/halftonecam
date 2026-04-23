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

  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }

  return "";
}

function getVideoExtension(mimeType) {
  if (!mimeType) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  return "webm";
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

export default function App() {
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
  const [uploadedName, setUploadedName] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState("user");

  const [dotScale, setDotScale] = useState(0.85);
  const [cellSize, setCellSize] = useState(12);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1.15);
  const [gamma, setGamma] = useState(1);
  const [invert, setInvert] = useState(false);
  const [mirrorWebcam, setMirrorWebcam] = useState(true);
  const [showGridStroke, setShowGridStroke] = useState(false);
  const [bgTone, setBgTone] = useState(8);
  const [colorMode, setColorMode] = useState("rgb");
  const [shape, setShape] = useState("circle");

  const [isPreviewRecording, setIsPreviewRecording] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= 900;
  }, []);

  const shapeOptions = [
    { value: "circle", label: "○" },
    { value: "square", label: "□" },
    { value: "triangle", label: "△" },
    { value: "diamond", label: "◇" },
    { value: "star", label: "★" },
  ];

  useEffect(() => {
    offscreenRef.current = document.createElement("canvas");

    return () => {
      cancelAnimationFrame(rafRef.current);
      stopWebcam();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sourceMode === "webcam") {
      void startWebcam();
    } else {
      stopWebcam();
      const video = sourceVideoRef.current;
      if (video && videoUrl) {
        video.srcObject = null;
        video.src = videoUrl;
        video.muted = true;
        video.playsInline = true;
        video.onloadedmetadata = async () => {
          try {
            await video.play();
          } catch {
            //
          }
          setReady(true);
          runPreview();
        };
      }
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  useEffect(() => {
    if (sourceMode === "webcam") {
      void startWebcam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraFacingMode]);

  useEffect(() => {
    if (!ready) return;
    runPreview();
  }, [
    ready,
    dotScale,
    cellSize,
    brightness,
    contrast,
    gamma,
    invert,
    mirrorWebcam,
    showGridStroke,
    bgTone,
    colorMode,
    shape,
  ]);

  async function startWebcam() {
    try {
      setError("");
      setReady(false);

      stopWebcam();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: cameraFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      webcamStreamRef.current = stream;

      const video = sourceVideoRef.current;
      if (!video) return;

      video.pause();
      video.src = "";
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve();
      });

      try {
        await video.play();
      } catch {
        //
      }

      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        setReady(true);
        runPreview();
      } else {
        const waitReady = () => {
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            setReady(true);
            runPreview();
          } else {
            requestAnimationFrame(waitReady);
          }
        };
        waitReady();
      }
    } catch {
      setError("웹캠을 열 수 없습니다. 브라우저 권한을 확인해 주세요.");
      setReady(false);
    }
  }

  function stopWebcam() {
    const video = sourceVideoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        //
      }
      video.srcObject = null;
    }

    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      webcamStreamRef.current = null;
    }
  }

  function handleLoadedMetadata() {
    const video = sourceVideoRef.current;
    if (!video) return;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setReady(true);
      runPreview();
    }
  }

  function handleUploadChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (videoUrl) URL.revokeObjectURL(videoUrl);

    const url = URL.createObjectURL(file);
    setUploadedName(file.name);
    setVideoUrl(url);
    setSourceMode("file");
    setError("");
    setReady(false);

    const video = sourceVideoRef.current;
    if (!video) return;

    stopWebcam();

    video.srcObject = null;
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = async () => {
      try {
        await video.play();
      } catch {
        //
      }
      setReady(true);
      runPreview();
    };
  }

  function resetValues() {
    setDotScale(0.85);
    setCellSize(12);
    setBrightness(0);
    setContrast(1.15);
    setGamma(1);
    setInvert(false);
    setColorMode("rgb");
    setShape("circle");
    setBgTone(8);
    setMirrorWebcam(true);
    setShowGridStroke(false);
  }

  function runPreview() {
    cancelAnimationFrame(rafRef.current);

    const loop = () => {
      const video = sourceVideoRef.current;
      const canvas = previewCanvasRef.current;

      if (
        video &&
        canvas &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
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

    const maxPreviewWidth = isMobile
      ? Math.min(window.innerWidth - 28, 860)
      : Math.min(window.innerWidth - 470, 1100);

    const displayWidth = Math.max(320, maxPreviewWidth);
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

    const monoBaseRadius = dotScale * 6.0;
    const rgbBaseRadius = dotScale * 3.8;
    const cmyBaseRadius = dotScale * 3.2;
    const kBaseRadius = dotScale * 2.3;

    for (let y = 0; y < displayHeight; y += step) {
      for (let x = 0; x < displayWidth; x += step) {
        const px = Math.min(displayWidth - 1, Math.floor(x + half));
        const py = Math.min(displayHeight - 1, Math.floor(y + half));
        const idx = (py * displayWidth + px) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        if (colorMode === "bw") {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const tone = processTone(lum, gamma, contrast, brightness, invert);
          const maxRadius = Math.min(monoBaseRadius, step * 0.48);
          const size = tone * maxRadius;

          ctx.fillStyle = "#ffffff";
          drawShape(ctx, shape, x + half, y + half, size);
        }

        if (colorMode === "rgb") {
          const rr = processTone(r, gamma, contrast, brightness, invert);
          const gg = processTone(g, gamma, contrast, brightness, invert);
          const bb = processTone(b, gamma, contrast, brightness, invert);
          const maxRadius = Math.min(rgbBaseRadius, step * 0.26);
          const offset = step * 0.18;

          ctx.fillStyle = "rgb(255,60,60)";
          drawShape(ctx, shape, x + half - offset, y + half, rr * maxRadius);

          ctx.fillStyle = "rgb(60,255,110)";
          drawShape(ctx, shape, x + half + offset, y + half, gg * maxRadius);

          ctx.fillStyle = "rgb(80,160,255)";
          drawShape(ctx, shape, x + half, y + half - offset, bb * maxRadius);
        }

        if (colorMode === "cmyk") {
          const c = processTone(255 - r, gamma, contrast, brightness, invert);
          const m = processTone(255 - g, gamma, contrast, brightness, invert);
          const yv = processTone(255 - b, gamma, contrast, brightness, invert);
          const kBase = Math.min(255 - r, 255 - g, 255 - b);
          const k = processTone(kBase, gamma, contrast, brightness, invert);
          const cmyMaxRadius = Math.min(cmyBaseRadius, step * 0.22);
          const kMaxRadius = Math.min(kBaseRadius, step * 0.18);

          ctx.fillStyle = "rgb(0,255,255)";
          drawShape(ctx, shape, x + half - step * 0.16, y + half - step * 0.12, c * cmyMaxRadius);

          ctx.fillStyle = "rgb(255,0,255)";
          drawShape(ctx, shape, x + half + step * 0.16, y + half - step * 0.12, m * cmyMaxRadius);

          ctx.fillStyle = "rgb(255,255,0)";
          drawShape(ctx, shape, x + half, y + half + step * 0.14, yv * cmyMaxRadius);

          ctx.fillStyle = "rgb(20,20,20)";
          drawShape(ctx, shape, x + half, y + half, k * kMaxRadius);
        }

        if (showGridStroke) {
          ctx.strokeStyle = "rgba(255,255,255,0.06)";
          ctx.strokeRect(x, y, step, step);
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
    if (!canvas || !ready) return;

    const stream = canvas.captureStream(30);
    const mimeType = getMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    previewRecordedChunksRef.current = [];
    previewRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        previewRecordedChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const finalType = mimeType || "video/webm";
      const ext = getVideoExtension(finalType);
      const blob = new Blob(previewRecordedChunksRef.current, {
        type: finalType,
      });
      downloadBlob(blob, `halftone-webcam-${Date.now()}.${ext}`);
      previewRecordedChunksRef.current = [];
    };

    recorder.start();
    setIsPreviewRecording(true);
  }

  function stopPreviewRecording() {
    if (previewRecorderRef.current && previewRecorderRef.current.state !== "inactive") {
      previewRecorderRef.current.stop();
    }
    setIsPreviewRecording(false);
  }

  async function exportProcessedVideo() {
    if (sourceMode !== "file" || !videoUrl || isExporting) return;

    const exportVideo = exportVideoRef.current;
    if (!exportVideo) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      exportVideo.src = videoUrl;
      exportVideo.muted = true;
      exportVideo.playsInline = true;

      await new Promise((resolve) => {
        exportVideo.onloadedmetadata = () => resolve();
      });

      const width = exportVideo.videoWidth || 1280;
      const height = exportVideo.videoHeight || 720;
      const fps = 30;

      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = width;
      exportCanvas.height = height;

      const stream = exportCanvas.captureStream(fps);
      const mimeType = getMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      const done = new Promise((resolve) => {
        recorder.onstop = resolve;
      });

      recorder.start();

      exportVideo.currentTime = 0;
      await exportVideo.play();

      await new Promise((resolve) => {
        const draw = () => {
          if (exportVideo.paused || exportVideo.ended) {
            resolve();
            return;
          }

          renderHalftone(exportVideo, exportCanvas, { mirror: false });

          const duration = exportVideo.duration || 1;
          setExportProgress(clamp(exportVideo.currentTime / duration, 0, 1));

          setTimeout(() => {
            requestAnimationFrame(draw);
          }, 1000 / fps);
        };

        draw();
      });

      recorder.stop();
      await done;

      const finalType = mimeType || "video/webm";
      const ext = getVideoExtension(finalType);
      const blob = new Blob(chunks, { type: finalType });
      downloadBlob(blob, `halftone-video-${Date.now()}.${ext}`);
    } catch {
      setError("영상 저장 중 문제가 발생했습니다.");
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      if (exportVideoRef.current) {
        exportVideoRef.current.pause();
        exportVideoRef.current.src = "";
      }
    }
  }

  function toggleCamera() {
    setCameraFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }

  const ui = {
    paper: "#ece7dc",
    panel: "#d7d1c4",
    panelDeep: "#c9c2b5",
    ink: "#1b1a17",
    muted: "#5c564d",
    line: "#2f2a24",
    accent: "#111111",
    danger: "#8f2f2f",
    success: "#1b4f2b",
    shadow: "4px 4px 0 #2f2a24",
    inset: "inset 1px 1px 0 #f8f4ec, inset -1px -1px 0 #a9a191",
    mono: '"IBM Plex Mono", "SFMono-Regular", "Menlo", "Consolas", monospace',
    sans: '"Chicago", "Geneva", "Inter", "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  };

  const btn = (active = false) => ({
    borderRadius: "0",
    minHeight: "44px",
    padding: "10px 12px",
    border: `2px solid ${ui.line}`,
    background: active ? ui.ink : ui.panel,
    color: active ? "#f4efe6" : ui.ink,
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.02em",
    cursor: "pointer",
    width: "100%",
    boxShadow: active ? "none" : `2px 2px 0 ${ui.line}`,
    transition: "transform 0.08s ease, box-shadow 0.08s ease",
    fontFamily: ui.mono,
    textTransform: "uppercase",
  });

  const sliderWrap = {
    borderRadius: "0",
    border: `2px solid ${ui.line}`,
    background: "#f4efe6",
    padding: "12px",
    display: "grid",
    gap: "8px",
    boxShadow: `2px 2px 0 ${ui.line}`,
  };

  const sectionTitle = {
    fontSize: "11px",
    color: ui.muted,
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    fontFamily: ui.mono,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  const panelBox = {
    borderRadius: "0",
    border: `2px solid ${ui.line}`,
    background: ui.panel,
    boxShadow: `3px 3px 0 ${ui.line}`,
  };

  const labelChip = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "28px",
    padding: "0 10px",
    border: `2px solid ${ui.line}`,
    background: "#f4efe6",
    color: ui.ink,
    fontSize: "11px",
    fontWeight: 700,
    fontFamily: ui.mono,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #d7d1c4 0%, #e6e0d4 28%, #ece7dc 100%)",
        color: ui.ink,
        padding: isMobile ? "10px" : "14px",
        fontFamily: ui.sans,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "1680px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 420px",
          gap: "14px",
          alignItems: "start",
        }}
      >
        <div
          style={{
            ...panelBox,
            overflow: "hidden",
            background: "#bdb6a7",
            minHeight: isMobile ? "auto" : "calc(100vh - 28px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              padding: "10px 12px",
              borderBottom: `2px solid ${ui.line}`,
              background:
                "repeating-linear-gradient(90deg, #cbc4b7 0, #cbc4b7 8px, #d6d0c4 8px, #d6d0c4 16px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={labelChip}>HALFTONE CAM</span>
              <span style={{ ...labelChip, background: ready ? "#dfe7d6" : "#efe0d4" }}>
                {ready ? "READY" : "WAIT"}
              </span>
              <span style={labelChip}>{sourceMode === "webcam" ? "WEBCAM" : "FILE"}</span>
            </div>

            <div
              style={{
                fontFamily: ui.mono,
                fontSize: "11px",
                color: ui.muted,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              print utility preview
            </div>
          </div>

          <div
            style={{
              position: "relative",
              background:
                "linear-gradient(180deg, #7d776d 0%, #8d8679 100%)",
              minHeight: isMobile ? "380px" : "calc(100vh - 84px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: isMobile ? "12px" : "18px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                width: "100%",
                border: `2px solid ${ui.line}`,
                background: "#0f0f0f",
                boxShadow: "inset 0 0 0 4px #c9c2b5, 4px 4px 0 #2f2a24",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "10px",
                  left: "10px",
                  zIndex: 3,
                  display: "flex",
                  gap: "6px",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    ...labelChip,
                    background: "#f4efe6",
                    minHeight: "24px",
                    fontSize: "10px",
                  }}
                >
                  {colorMode}
                </span>
                <span
                  style={{
                    ...labelChip,
                    background: "#f4efe6",
                    minHeight: "24px",
                    fontSize: "10px",
                  }}
                >
                  {shape}
                </span>
              </div>

              <canvas
                ref={previewCanvasRef}
                style={{
                  display: "block",
                  width: "100%",
                  height: "auto",
                  maxWidth: "100%",
                  background: "#050505",
                }}
              />

              <img
                src="/logo.png"
                alt="logo"
                style={{
                  position: "absolute",
                  right: "12px",
                  bottom: "12px",
                  width: isMobile ? "32px" : "42px",
                  zIndex: 3,
                  objectFit: "contain",
                  opacity: 0.92,
                  imageRendering: "pixelated",
                  filter: "grayscale(1) contrast(1.1)",
                }}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            ...panelBox,
            padding: "10px",
            display: "grid",
            gap: "10px",
            position: isMobile ? "static" : "sticky",
            top: "14px",
            background: ui.panelDeep,
          }}
        >
          <div
            style={{
              ...panelBox,
              background: "#f4efe6",
              padding: "10px 12px",
              boxShadow: `inset 1px 1px 0 #fffaf2, inset -1px -1px 0 #b6ae9f`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "-0.02em" }}>
                HALFTONE CAMERA
              </div>
              <div
                style={{
                  fontFamily: ui.mono,
                  fontSize: "11px",
                  color: ui.muted,
                  textTransform: "uppercase",
                }}
              >
                retro print control desk
              </div>
            </div>
          </div>

          <div
            style={{
              ...panelBox,
              background: ui.panel,
              padding: "10px",
              display: "grid",
              gap: "8px",
            }}
          >
            <div
              style={{
                fontFamily: ui.mono,
                fontSize: "11px",
                color: ui.muted,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Source
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              <button onClick={() => setSourceMode("webcam")} style={btn(sourceMode === "webcam")}>
                Webcam
              </button>
              <button onClick={() => setSourceMode("file")} style={btn(sourceMode === "file")}>
                Video File
              </button>
            </div>

            <div
              style={{
                ...panelBox,
                background: "#f4efe6",
                padding: "10px",
                display: "grid",
                gap: "10px",
              }}
            >
              <label
                style={{
                  display: "grid",
                  gap: "8px",
                  fontSize: "13px",
                  color: ui.ink,
                }}
              >
                <span
                  style={{
                    fontFamily: ui.mono,
                    fontSize: "11px",
                    color: ui.muted,
                    textTransform: "uppercase",
                  }}
                >
                  Upload Video
                </span>

                <input
                  type="file"
                  accept="video/*"
                  onChange={handleUploadChange}
                  style={{
                    width: "100%",
                    fontSize: "12px",
                    fontFamily: ui.mono,
                    color: ui.ink,
                  }}
                />
              </label>

              <div
                style={{
                  border: `2px solid ${ui.line}`,
                  background: "#ebe4d8",
                  padding: "8px 10px",
                  fontFamily: ui.mono,
                  fontSize: "11px",
                  color: ui.ink,
                  minHeight: "36px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {uploadedName || "NO FILE SELECTED"}
              </div>

              <div
                style={{
                  fontSize: "12px",
                  color: ui.muted,
                  lineHeight: 1.5,
                  fontFamily: ui.mono,
                }}
              >
                {sourceMode === "webcam"
                  ? ready
                    ? "WEBCAM PREVIEW ACTIVE"
                    : "PREPARING WEBCAM..."
                  : uploadedName
                  ? "UPLOADED VIDEO PREVIEW ACTIVE"
                  : "WAITING FOR VIDEO FILE"}
              </div>

              {error ? (
                <div
                  style={{
                    border: `2px solid ${ui.danger}`,
                    background: "#f1d8d4",
                    padding: "8px 10px",
                    fontSize: "12px",
                    color: ui.danger,
                    lineHeight: 1.45,
                    fontFamily: ui.mono,
                  }}
                >
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <div
            style={{
              ...panelBox,
              background: ui.panel,
              padding: "10px",
              display: "grid",
              gap: "8px",
            }}
          >
            <div
              style={{
                fontFamily: ui.mono,
                fontSize: "11px",
                color: ui.muted,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Color Process
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "8px",
              }}
            >
              <button onClick={() => setColorMode("bw")} style={btn(colorMode === "bw")}>
                B/W
              </button>
              <button onClick={() => setColorMode("rgb")} style={btn(colorMode === "rgb")}>
                RGB
              </button>
              <button onClick={() => setColorMode("cmyk")} style={btn(colorMode === "cmyk")}>
                CMYK
              </button>
            </div>
          </div>

          <div
            style={{
              ...panelBox,
              background: ui.panel,
              padding: "10px",
              display: "grid",
              gap: "8px",
            }}
          >
            <div
              style={{
                fontFamily: ui.mono,
                fontSize: "11px",
                color: ui.muted,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Dot Shape
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: "8px",
              }}
            >
              {shapeOptions.map((item) => (
                <button
                  key={item.value}
                  onClick={() => setShape(item.value)}
                  style={{
                    ...btn(shape === item.value),
                    fontSize: "18px",
                    minHeight: "48px",
                    textTransform: "none",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              ...panelBox,
              background: ui.panel,
              padding: "10px",
              display: "grid",
              gap: "8px",
            }}
          >
            <div
              style={{
                fontFamily: ui.mono,
                fontSize: "11px",
                color: ui.muted,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Utility Switches
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                gap: "8px",
              }}
            >
              <button onClick={() => setInvert((v) => !v)} style={btn(invert)}>
                Invert {invert ? "On" : "Off"}
              </button>
              <button onClick={() => setMirrorWebcam((v) => !v)} style={btn(mirrorWebcam)}>
                Mirror {mirrorWebcam ? "On" : "Off"}
              </button>
              <button onClick={toggleCamera} style={btn(false)}>
                Camera Flip
              </button>
            </div>

            <button
              onClick={() => setShowGridStroke((v) => !v)}
              style={btn(showGridStroke)}
            >
              Cell Line {showGridStroke ? "On" : "Off"}
            </button>
          </div>

          <div
            style={{
              ...panelBox,
              background: ui.panel,
              padding: "10px",
              display: "grid",
              gap: "10px",
            }}
          >
            <div
              style={{
                fontFamily: ui.mono,
                fontSize: "11px",
                color: ui.muted,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Tone Controls
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: "10px",
              }}
            >
              <div style={sliderWrap}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    fontFamily: ui.mono,
                    textTransform: "uppercase",
                  }}
                >
                  Dot Size
                </div>
                <div style={sectionTitle}>
                  <span>Scale</span>
                  <span>{dotScale.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.01"
                  value={dotScale}
                  onChange={(e) => setDotScale(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#111111" }}
                />
              </div>

              <div style={sliderWrap}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    fontFamily: ui.mono,
                    textTransform: "uppercase",
                  }}
                >
                  Contrast
                </div>
                <div style={sectionTitle}>
                  <span>Level</span>
                  <span>{contrast.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="2.2"
                  step="0.01"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#111111" }}
                />
              </div>

              <div style={sliderWrap}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    fontFamily: ui.mono,
                    textTransform: "uppercase",
                  }}
                >
                  Brightness
                </div>
                <div style={sectionTitle}>
                  <span>Level</span>
                  <span>{brightness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="-0.5"
                  max="0.5"
                  step="0.01"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#111111" }}
                />
              </div>

              <div style={sliderWrap}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    fontFamily: ui.mono,
                    textTransform: "uppercase",
                  }}
                >
                  Gamma
                </div>
                <div style={sectionTitle}>
                  <span>Level</span>
                  <span>{gamma.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="2.4"
                  step="0.01"
                  value={gamma}
                  onChange={(e) => setGamma(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#111111" }}
                />
              </div>

              <div style={sliderWrap}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    fontFamily: ui.mono,
                    textTransform: "uppercase",
                  }}
                >
                  Dot Spacing
                </div>
                <div style={sectionTitle}>
                  <span>Cell</span>
                  <span>{cellSize}</span>
                </div>
                <input
                  type="range"
                  min="4"
                  max="28"
                  step="1"
                  value={cellSize}
                  onChange={(e) => setCellSize(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#111111" }}
                />
              </div>

              <div style={sliderWrap}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    fontFamily: ui.mono,
                    textTransform: "uppercase",
                  }}
                >
                  Background
                </div>
                <div style={sectionTitle}>
                  <span>Tone</span>
                  <span>{bgTone}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="80"
                  step="1"
                  value={bgTone}
                  onChange={(e) => setBgTone(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#111111" }}
                />
              </div>
            </div>
          </div>

          <div
            style={{
              ...panelBox,
              background: ui.panel,
              padding: "10px",
              display: "grid",
              gap: "8px",
            }}
          >
            <div
              style={{
                fontFamily: ui.mono,
                fontSize: "11px",
                color: ui.muted,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Save / Output
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: "8px",
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
                  Webcam Rec Save
                </button>
              ) : (
                <button onClick={stopPreviewRecording} style={btn(true)}>
                  Stop Recording
                </button>
              )}

              <button onClick={downloadFrame} style={btn(false)}>
                Save Frame
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
                  ? `Export ${Math.round(exportProgress * 100)}%`
                  : "Save Halftone Video"}
              </button>

              <button onClick={resetValues} style={btn(false)}>
                Reset Default
              </button>
            </div>

            {isExporting ? (
              <div
                style={{
                  border: `2px solid ${ui.line}`,
                  background: "#f4efe6",
                  padding: "6px",
                }}
              >
                <div
                  style={{
                    height: "16px",
                    border: `2px solid ${ui.line}`,
                    background: "#d5cdbf",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round(exportProgress * 100)}%`,
                      height: "100%",
                      background: "#1b1a17",
                      transition: "width 0.1s linear",
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <video
        ref={sourceVideoRef}
        playsInline
        muted
        autoPlay
        style={{ display: "none" }}
        onLoadedMetadata={handleLoadedMetadata}
      />
      <video ref={exportVideoRef} playsInline muted style={{ display: "none" }} />
    </div>
  );
}
