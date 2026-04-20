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
          const size = tone * (step * 0.5) * dotScale;

          ctx.fillStyle = "#ffffff";
          drawShape(ctx, shape, x + half, y + half, size);
        }

        if (colorMode === "rgb") {
          const rr = processTone(r, gamma, contrast, brightness, invert);
          const gg = processTone(g, gamma, contrast, brightness, invert);
          const bb = processTone(b, gamma, contrast, brightness, invert);

          ctx.fillStyle = "rgb(255,60,60)";
          drawShape(ctx, shape, x + half - step * 0.18, y + half, rr * (step * 0.32) * dotScale);

          ctx.fillStyle = "rgb(60,255,110)";
          drawShape(ctx, shape, x + half + step * 0.18, y + half, gg * (step * 0.32) * dotScale);

          ctx.fillStyle = "rgb(80,160,255)";
          drawShape(ctx, shape, x + half, y + half - step * 0.18, bb * (step * 0.32) * dotScale);
        }

        if (colorMode === "cmyk") {
          const c = processTone(255 - r, gamma, contrast, brightness, invert);
          const m = processTone(255 - g, gamma, contrast, brightness, invert);
          const yv = processTone(255 - b, gamma, contrast, brightness, invert);
          const kBase = Math.min(255 - r, 255 - g, 255 - b);
          const k = processTone(kBase, gamma, contrast, brightness, invert);

          ctx.fillStyle = "rgb(0,255,255)";
          drawShape(ctx, shape, x + half - step * 0.16, y + half - step * 0.12, c * (step * 0.27) * dotScale);

          ctx.fillStyle = "rgb(255,0,255)";
          drawShape(ctx, shape, x + half + step * 0.16, y + half - step * 0.12, m * (step * 0.27) * dotScale);

          ctx.fillStyle = "rgb(255,255,0)";
          drawShape(ctx, shape, x + half, y + half + step * 0.14, yv * (step * 0.27) * dotScale);

          ctx.fillStyle = "rgb(20,20,20)";
          drawShape(ctx, shape, x + half, y + half, k * (step * 0.2) * dotScale);
        }

        if (showGridStroke) {
          ctx.strokeStyle = "rgba(255,255,255,0.06)";
          ctx.lineWidth = 1;
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
      const blob = new Blob(previewRecordedChunksRef.current, {
        type: mimeType || "video/webm",
      });
      downloadBlob(blob, `halftone-webcam-${Date.now()}.webm`);
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

      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      downloadBlob(blob, `halftone-video-${Date.now()}.webm`);
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

  const btn = (active = false) => ({
    borderRadius: "18px",
    minHeight: "54px",
    padding: "12px 14px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: active ? "#f2f2f2" : "rgba(255,255,255,0.04)",
    color: active ? "#111" : "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  });

  const sliderWrap = {
    borderRadius: "20px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: "16px",
    display: "grid",
    gap: "10px",
  };

  const sectionTitle = {
    fontSize: "13px",
    color: "rgba(255,255,255,0.78)",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#fff",
        padding: isMobile ? "14px" : "18px",
        fontFamily:
          "Inter, Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "1600px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 460px",
          gap: "18px",
          alignItems: "start",
        }}
      >
        <div
          style={{
            minWidth: 0,
            borderRadius: "32px",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "#050505",
            position: "relative",
            minHeight: isMobile ? "auto" : "calc(100vh - 36px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "100%",
              minHeight: isMobile ? "420px" : "calc(100vh - 36px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#050505",
              position: "relative",
            }}
          >
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
                top: isMobile ? "14px" : "20px",
                left: isMobile ? "14px" : "20px",
                width: isMobile ? "42px" : "54px",
                zIndex: 10,
                objectFit: "contain",
              }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
        </div>

        <div
          style={{
            borderRadius: "28px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "#060606",
            padding: isMobile ? "14px" : "16px",
            display: "grid",
            gap: "14px",
            position: isMobile ? "static" : "sticky",
            top: "18px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            <button onClick={() => setSourceMode("webcam")} style={btn(sourceMode === "webcam")}>
              웹캠
            </button>
            <button onClick={() => setSourceMode("file")} style={btn(sourceMode === "file")}>
              영상 파일
            </button>
          </div>

          <div
            style={{
              borderRadius: "20px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              padding: "14px",
              display: "grid",
              gap: "12px",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                flexWrap: "wrap",
                fontSize: "14px",
                color: "#fff",
              }}
            >
              <input
                type="file"
                accept="video/*"
                onChange={handleUploadChange}
                style={{ fontSize: "14px" }}
              />
              <span style={{ opacity: 0.86 }}>
                {uploadedName || "선택된 파일 없음"}
              </span>
            </label>

            <div
              style={{
                fontSize: "13px",
                color: "rgba(255,255,255,0.62)",
                lineHeight: 1.45,
              }}
            >
              {sourceMode === "webcam"
                ? ready
                  ? "웹캠 프리뷰 활성화"
                  : "웹캠을 준비 중입니다."
                : uploadedName
                ? "업로드한 영상 프리뷰 활성화"
                : "아직 선택된 영상 파일이 없습니다."}
            </div>

            {error ? (
              <div
                style={{
                  fontSize: "13px",
                  color: "#ff8d8d",
                  lineHeight: 1.45,
                }}
              >
                {error}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "10px",
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              gap: "10px",
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
            }}
          >
            <button onClick={() => setInvert((v) => !v)} style={btn(invert)}>
              Invert {invert ? "On" : "Off"}
            </button>
            <button onClick={() => setMirrorWebcam((v) => !v)} style={btn(mirrorWebcam)}>
              좌우반전 {mirrorWebcam ? "On" : "Off"}
            </button>
            <button onClick={toggleCamera} style={btn(false)}>
              카메라 전환
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: "10px",
            }}
          >
            <div style={sliderWrap}>
              <div style={{ fontSize: "18px", fontWeight: 600 }}>Dot</div>
              <div style={sectionTitle}>
                <span>닷 크기</span>
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

            <div style={sliderWrap}>
              <div style={{ fontSize: "18px", fontWeight: 600 }}>Contrast</div>
              <div style={sectionTitle}>
                <span>대비</span>
                <span>{contrast.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.2"
                step="0.01"
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
              />
            </div>

            <div style={sliderWrap}>
              <div style={{ fontSize: "18px", fontWeight: 600 }}>Brightness</div>
              <div style={sectionTitle}>
                <span>밝기</span>
                <span>{brightness.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="-0.5"
                max="0.5"
                step="0.01"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
              />
            </div>

            <div style={sliderWrap}>
              <div style={{ fontSize: "18px", fontWeight: 600 }}>Gamma</div>
              <div style={sectionTitle}>
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

            <div style={sliderWrap}>
              <div style={{ fontSize: "18px", fontWeight: 600 }}>Softness</div>
              <div style={sectionTitle}>
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

            <div style={sliderWrap}>
              <div style={{ fontSize: "18px", fontWeight: 600 }}>Threshold</div>
              <div style={sectionTitle}>
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

          <button
            onClick={() => setShowGridStroke((v) => !v)}
            style={btn(showGridStroke)}
          >
            셀 라인 {showGridStroke ? "ON" : "OFF"}
          </button>
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
