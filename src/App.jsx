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

function adjustSaturation(r, g, b, saturation) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;

  return {
    r: clamp(gray + (r - gray) * saturation, 0, 255),
    g: clamp(gray + (g - gray) * saturation, 0, 255),
    b: clamp(gray + (b - gray) * saturation, 0, 255),
  };
}

function drawGrain(ctx, width, height) {
  ctx.save();

  const grainSize = 2;
  const strength = 42;

  for (let y = 0; y < height; y += grainSize) {
    for (let x = 0; x < width; x += grainSize) {
      const noise = Math.random();
      const alpha = noise < 0.5 ? 0.08 : 0.13;

      ctx.fillStyle =
        noise < 0.5
          ? `rgba(0, 0, 0, ${alpha})`
          : `rgba(255, 255, 255, ${alpha})`;

      ctx.fillRect(x, y, grainSize, grainSize);
    }
  }

  ctx.restore();
}

function Win95Icon({ type, size = 16 }) {
  const wrapStyle = {
    width: size + 6,
    height: size + 6,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#c0c0c0",
    borderTop: "2px solid #ffffff",
    borderLeft: "2px solid #ffffff",
    borderRight: "2px solid #000000",
    borderBottom: "2px solid #000000",
    boxSizing: "border-box",
    flexShrink: 0,
  };

  if (type === "record") {
    return (
      <span style={wrapStyle}>
        <span
          style={{
            width: size - 4,
            height: size - 4,
            borderRadius: "50%",
            background: "#d40000",
            border: "1px solid #6b0000",
            display: "block",
          }}
        />
      </span>
    );
  }

  if (type === "camera") {
    return (
      <span style={wrapStyle}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          style={{ imageRendering: "pixelated" }}
        >
          <rect x="1" y="5" width="14" height="8" fill="#c0c0c0" stroke="#000" strokeWidth="1" />
          <rect x="4" y="3" width="4" height="2" fill="#c0c0c0" stroke="#000" strokeWidth="1" />
          <rect x="5" y="7" width="6" height="4" fill="#000080" stroke="#000" strokeWidth="1" />
          <rect x="7" y="8" width="2" height="2" fill="#ffffff" />
        </svg>
      </span>
    );
  }

  if (type === "disk") {
    return (
      <span style={wrapStyle}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          style={{ imageRendering: "pixelated" }}
        >
          <rect x="1" y="1" width="14" height="14" fill="#c0c0c0" stroke="#000" strokeWidth="1" />
          <rect x="3" y="3" width="8" height="4" fill="#000080" />
          <rect x="4" y="9" width="8" height="4" fill="#ffffff" stroke="#000" strokeWidth="1" />
          <rect x="11" y="3" width="2" height="3" fill="#000" />
        </svg>
      </span>
    );
  }

  if (type === "reset") {
    return (
      <span style={wrapStyle}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          style={{ imageRendering: "pixelated" }}
        >
          <path
            d="M8 2 A6 6 0 1 0 14 8"
            fill="none"
            stroke="#000"
            strokeWidth="2"
          />
          <path d="M9 2 H14 V7" fill="none" stroke="#000" strokeWidth="2" />
        </svg>
      </span>
    );
  }

  if (type === "folder") {
    return (
      <span style={wrapStyle}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          style={{ imageRendering: "pixelated" }}
        >
          <path d="M1 5 H6 L7 4 H15 V14 H1 Z" fill="#d8d000" stroke="#000" strokeWidth="1" />
          <rect x="1" y="6" width="14" height="8" fill="#ece45a" stroke="#000" strokeWidth="1" />
        </svg>
      </span>
    );
  }

  if (type === "webcam") {
    return (
      <span style={wrapStyle}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          style={{ imageRendering: "pixelated" }}
        >
          <rect x="2" y="4" width="9" height="7" fill="#c0c0c0" stroke="#000" strokeWidth="1" />
          <rect x="11" y="6" width="3" height="3" fill="#000080" stroke="#000" strokeWidth="1" />
          <rect x="5" y="11" width="3" height="2" fill="#000" />
        </svg>
      </span>
    );
  }

  return (
    <span style={wrapStyle}>
      <span style={{ width: size - 4, height: size - 4, background: "#000" }} />
    </span>
  );
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
  const fileInputRef = useRef(null);

  const [sourceMode, setSourceMode] = useState("webcam");
  const [videoUrl, setVideoUrl] = useState("");
  const [uploadedName, setUploadedName] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState("user");

  const [dotScale, setDotScale] = useState(8.85);
  const [cellSize, setCellSize] = useState(4);
  const [brightness, setBrightness] = useState(0.18);
  const [contrast, setContrast] = useState(1.15);
  const [gamma, setGamma] = useState(1.15);
  const [invert, setInvert] = useState(false);
  const [mirrorWebcam, setMirrorWebcam] = useState(true);
  const [showGridStroke, setShowGridStroke] = useState(false);
  const [bgTone, setBgTone] = useState(8);
  const [colorMode, setColorMode] = useState("bw");
  const [shape, setShape] = useState("circle");
  const [saturation, setSaturation] = useState(1.15);
  const [showGrain, setShowGrain] = useState(false);

  const [isPreviewRecording, setIsPreviewRecording] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= 980;
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
    saturation,
    showGrain,
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
    setDotScale(8.85);
    setCellSize(4);
    setBrightness(0.18);
    setContrast(1.15);
    setGamma(1.15);
    setInvert(false);
    setColorMode("bw");
    setShape("circle");
    setBgTone(8);
    setMirrorWebcam(true);
    setShowGridStroke(false);
    setSaturation(1.15);
    setShowGrain(false);
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
      ? Math.min(window.innerWidth - 36, 860)
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

    ctx.imageSmoothingEnabled = false;
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

        let r = data[idx];
        let g = data[idx + 1];
        let b = data[idx + 2];

        const sat = adjustSaturation(r, g, b, saturation);
        r = sat.r;
        g = sat.g;
        b = sat.b;

        if (colorMode === "bw") {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const tone = processTone(lum, gamma, contrast, brightness, invert);
          const maxRadius = step * 0.48 * (dotScale / 10);
          const size = tone * maxRadius;

          ctx.fillStyle = "#ffffff";
          drawShape(ctx, shape, x + half, y + half, size);
        }

      if (colorMode === "rgb") {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const tone = processTone(lum, gamma, contrast, brightness, invert);

 const maxRadius = step * 0.46 * (dotScale / 10);
const size = tone * maxRadius;

  const colorStrength = 0.72;
  const rr = Math.round(255 * (1 - colorStrength) + r * colorStrength);
  const gg = Math.round(255 * (1 - colorStrength) + g * colorStrength);
  const bb = Math.round(255 * (1 - colorStrength) + b * colorStrength);

  ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
  drawShape(ctx, shape, x + half, y + half, size);
}

if (colorMode === "cmyk") {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const tone = processTone(lum, gamma, contrast, brightness, invert);

 const maxRadius = step * 0.44 * (dotScale / 10);
 const size = tone * maxRadius;

  const inkMix = 0.72;

  const c = 255 - r;
  const m = 255 - g;
  const yv = 255 - b;

  const rr = Math.round(245 - c * inkMix * 0.32);
  const gg = Math.round(245 - m * inkMix * 0.32);
  const bb = Math.round(245 - yv * inkMix * 0.32);

  ctx.fillStyle = `rgb(${clamp(rr, 0, 255)}, ${clamp(gg, 0, 255)}, ${clamp(bb, 0, 255)})`;
  drawShape(ctx, shape, x + half, y + half, size);

  if (tone > 0.45) {
    ctx.fillStyle = "rgba(20,20,20,0.22)";
    drawShape(
      ctx,
      shape,
      x + half + step * 0.08,
      y + half + step * 0.08,
      size * 0.72
    );
  }
}
        if (showGridStroke) {
          ctx.strokeStyle = "rgba(255,255,255,0.06)";
          ctx.strokeRect(x, y, step, step);
        }
      }
    }

    if (showGrain) {
      drawGrain(ctx, displayWidth, displayHeight);
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

  recorder.start(100);
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
    desktop: "#008080",
    face: "#c0c0c0",
    light: "#ffffff",
    shadow: "#808080",
    dark: "#000000",
    mid: "#dfdfdf",
    title: "#000080",
    titleText: "#ffffff",
    text: "#000000",
    disabled: "#7a7a7a",
    success: "#00aa00",
    error: "#aa0000",
    teal: "#008080",
  };

  const fontStack = '"MS Sans Serif", Tahoma, Geneva, Verdana, sans-serif';

  const windowStyle = {
    background: ui.face,
    borderTop: `2px solid ${ui.light}`,
    borderLeft: `2px solid ${ui.light}`,
    borderRight: `2px solid ${ui.dark}`,
    borderBottom: `2px solid ${ui.dark}`,
    boxShadow: `1px 1px 0 ${ui.dark}`,
    boxSizing: "border-box",
  };

  const insetStyle = {
    background: "#ffffff",
    borderTop: `2px solid ${ui.shadow}`,
    borderLeft: `2px solid ${ui.shadow}`,
    borderRight: `2px solid ${ui.light}`,
    borderBottom: `2px solid ${ui.light}`,
    boxSizing: "border-box",
  };

  const groupBox = {
    ...windowStyle,
    padding: "10px",
    background: ui.face,
    display: "grid",
    gap: "10px",
  };

  const sectionLabel = {
    fontSize: "11px",
    fontWeight: 400,
    color: ui.text,
    fontFamily: fontStack,
    letterSpacing: "0.02em",
  };

  const valueLabel = {
    fontSize: "12px",
    color: ui.text,
    fontFamily: fontStack,
  };

  const btn = (active = false, disabled = false) => ({
    minHeight: "40px",
    width: "100%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "6px 10px",
    background: ui.face,
    color: disabled ? ui.disabled : ui.text,
    borderTop: `2px solid ${active ? ui.shadow : ui.light}`,
    borderLeft: `2px solid ${active ? ui.shadow : ui.light}`,
    borderRight: `2px solid ${active ? ui.light : ui.dark}`,
    borderBottom: `2px solid ${active ? ui.light : ui.dark}`,
    boxShadow: active ? `inset 1px 1px 0 ${ui.dark}` : "none",
    fontFamily: fontStack,
    fontSize: "12px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    boxSizing: "border-box",
    whiteSpace: "nowrap",
  });

  const actionBtn = (active = false, disabled = false) => ({
    minHeight: isMobile ? "42px" : "44px",
    width: "100%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "6px 10px",
    background: ui.face,
    color: disabled ? ui.disabled : ui.text,
    borderTop: `2px solid ${active ? ui.shadow : ui.light}`,
    borderLeft: `2px solid ${active ? ui.shadow : ui.light}`,
    borderRight: `2px solid ${active ? ui.light : ui.dark}`,
    borderBottom: `2px solid ${active ? ui.light : ui.dark}`,
    boxShadow: active ? `inset 1px 1px 0 ${ui.dark}` : "none",
    fontFamily: fontStack,
    fontSize: isMobile ? "11px" : "12px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    boxSizing: "border-box",
    whiteSpace: "nowrap",
  });

  const smallBadge = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "24px",
    padding: "2px 8px",
    background: ui.face,
    borderTop: `2px solid ${ui.light}`,
    borderLeft: `2px solid ${ui.light}`,
    borderRight: `2px solid ${ui.dark}`,
    borderBottom: `2px solid ${ui.dark}`,
    fontSize: "11px",
    fontWeight: 700,
    fontFamily: fontStack,
    color: ui.text,
    boxSizing: "border-box",
  };

  const titleBarButton = {
    width: "18px",
    height: "18px",
    background: ui.face,
    borderTop: `2px solid ${ui.light}`,
    borderLeft: `2px solid ${ui.light}`,
    borderRight: `2px solid ${ui.dark}`,
    borderBottom: `2px solid ${ui.dark}`,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: ui.text,
    fontSize: "12px",
    fontWeight: 700,
    lineHeight: 1,
    boxSizing: "border-box",
  };

  const sliderWrap = {
    ...windowStyle,
    padding: "10px",
    background: ui.face,
    display: "grid",
    gap: "8px",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: ui.desktop,
        padding: isMobile ? "10px" : "14px",
        paddingBottom: isMobile ? "68px" : "64px",
        fontFamily: fontStack,
        boxSizing: "border-box",
        overflowX: "hidden",
        position: "relative",
      }}
    >
      <style>{`
        html, body, #root {
          margin: 0;
          padding: 0;
          width: 100%;
          min-height: 100%;
          background: #008080;
          overflow-x: hidden;
        }

        .win95-range {
          width: 100%;
          appearance: none;
          -webkit-appearance: none;
          background: transparent;
          height: 22px;
          margin: 0;
        }

        .win95-range::-webkit-slider-runnable-track {
          height: 6px;
          background: #d4d0c8;
          border-top: 2px solid #808080;
          border-left: 2px solid #808080;
          border-right: 2px solid #ffffff;
          border-bottom: 2px solid #ffffff;
        }

        .win95-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 20px;
          background: #c0c0c0;
          border-top: 2px solid #ffffff;
          border-left: 2px solid #ffffff;
          border-right: 2px solid #000000;
          border-bottom: 2px solid #000000;
          margin-top: -8px;
          cursor: pointer;
        }

        .win95-range::-moz-range-track {
          height: 6px;
          background: #d4d0c8;
          border-top: 2px solid #808080;
          border-left: 2px solid #808080;
          border-right: 2px solid #ffffff;
          border-bottom: 2px solid #ffffff;
        }

        .win95-range::-moz-range-thumb {
          width: 14px;
          height: 20px;
          background: #c0c0c0;
          border-top: 2px solid #ffffff;
          border-left: 2px solid #ffffff;
          border-right: 2px solid #000000;
          border-bottom: 2px solid #000000;
          cursor: pointer;
        }

        .win95-file-input {
          display: none;
        }
      `}</style>
      
<div
  style={{
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: 0,
    backgroundColor: "#008080",
    backgroundImage: 'url("/tile-logo.png")',
    backgroundRepeat: "repeat",
    backgroundSize: isMobile ? "90px auto" : "140px auto",
    backgroundPosition: "0 0",
    imageRendering: "pixelated",
  }}
/>
      <div
        style={{
          maxWidth: "1680px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 420px",
          gap: "12px",
          alignItems: "start",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={windowStyle}>
          <div
            style={{
              height: "28px",
              background: ui.title,
              color: ui.titleText,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 6px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  width: "14px",
                  height: "14px",
                  background: "#c0c0c0",
                  border: "1px solid #000",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#000080",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                H
              </span>
              <span>Halftone Camera - Preview</span>
            </div>

            <div style={{ display: "flex", gap: "2px" }}>
              <span style={titleBarButton}>_</span>
              <span style={titleBarButton}>□</span>
              <span style={titleBarButton}>×</span>
            </div>
          </div>

          <div
            style={{
              background: ui.face,
              padding: isMobile ? "10px" : "12px",
              boxSizing: "border-box",
              minHeight: isMobile ? "auto" : "calc(100vh - 74px)",
              display: "grid",
              gridTemplateRows: "auto 1fr auto",
              gap: "10px",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
                gap: "8px",
              }}
            >
              {!isPreviewRecording ? (
                <button
                  onClick={startPreviewRecording}
                  disabled={!ready}
                  style={actionBtn(false, !ready)}
                >
                  <Win95Icon type="record" />
                  <span>WEBCAM REC SAVE</span>
                </button>
              ) : (
                <button
                  onClick={stopPreviewRecording}
                  style={actionBtn(true, false)}
                >
                  <Win95Icon type="record" />
                  <span>STOP RECORDING</span>
                </button>
              )}

              <button onClick={downloadFrame} style={actionBtn(false, false)}>
                <Win95Icon type="camera" />
                <span>SAVE FRAME</span>
              </button>

              <button
                onClick={exportProcessedVideo}
                disabled={isExporting || sourceMode !== "file"}
                style={actionBtn(isExporting, isExporting || sourceMode !== "file")}
              >
                <Win95Icon type="disk" />
                <span>
                  {isExporting
                    ? `SAVE VIDEO ${Math.round(exportProgress * 100)}%`
                    : "SAVE HALFTONE VIDEO"}
                </span>
              </button>

              <button onClick={resetValues} style={actionBtn(false, false)}>
                <Win95Icon type="reset" />
                <span>RESET DEFAULT</span>
              </button>
            </div>

            <div
              style={{
                ...insetStyle,
                minHeight: isMobile ? "360px" : "calc(100vh - 210px)",
                padding: isMobile ? "10px" : "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#808080",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: "100%",
                  ...insetStyle,
                  background: "#000",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: "8px",
                    left: "8px",
                    zIndex: 3,
                    display: "flex",
                    gap: "6px",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={smallBadge}>{String(colorMode).toUpperCase()}</span>
                  <span style={smallBadge}>{String(shape).toUpperCase()}</span>
                </div>

                <canvas
                  ref={previewCanvasRef}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "auto",
                    maxWidth: "100%",
                    background: "#000",
                  }}
                />

                <img
                  src="/logo.png"
                  alt="logo"
                  style={{
                    position: "absolute",
                    right: "10px",
                    bottom: "10px",
                    width: isMobile ? "30px" : "38px",
                    objectFit: "contain",
                    imageRendering: "pixelated",
                    opacity: 0.9,
                    filter: "grayscale(1) contrast(1.1)",
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            </div>

            <div
              style={{
                ...insetStyle,
                padding: "6px 8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                fontSize: "12px",
                color: ui.text,
                background: ui.face,
              }}
            >
              <span>
                {error
                  ? error
                  : isExporting
                  ? `Saving video... ${Math.round(exportProgress * 100)}%`
                  : ready
                  ? "Preview Active"
                  : "Initializing..."}
              </span>
              <span>{sourceMode === "webcam" ? "Camera" : uploadedName || "No file"}</span>
            </div>
          </div>
        </div>

        <div style={windowStyle}>
          <div
            style={{
              height: "28px",
              background: ui.title,
              color: ui.titleText,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 6px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  width: "14px",
                  height: "14px",
                  background: "#c0c0c0",
                  border: "1px solid #000",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#000080",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                C
              </span>
              <span>Halftone Camera - Controls</span>
            </div>

            <div style={{ display: "flex", gap: "2px" }}>
              <span style={titleBarButton}>_</span>
              <span style={titleBarButton}>□</span>
              <span style={titleBarButton}>×</span>
            </div>
          </div>

          <div
            style={{
              background: ui.face,
              padding: "10px",
              boxSizing: "border-box",
              display: "grid",
              gap: "10px",
            }}
          >
            <div style={groupBox}>
              <div style={sectionLabel}>Source</div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                }}
              >
                <button onClick={() => setSourceMode("webcam")} style={btn(sourceMode === "webcam")}>
                  <Win95Icon type="webcam" />
                  <span>WEBCAM</span>
                </button>

                <button
                  onClick={() => {
                    setSourceMode("file");
                    fileInputRef.current?.click();
                  }}
                  style={btn(sourceMode === "file")}
                >
                  <Win95Icon type="folder" />
                  <span>VIDEO FILE</span>
                </button>
              </div>

            </div>

            <div style={groupBox}>
              <div style={sectionLabel}>Color Process</div>
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

            <div style={groupBox}>
              <div style={sectionLabel}>Dot Shape</div>
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
                      minHeight: "44px",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={groupBox}>
              <div style={sectionLabel}>Utility Switches</div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                  gap: "8px",
                }}
              >
                <button onClick={() => setInvert((v) => !v)} style={btn(invert)}>
                  INVERT {invert ? "ON" : "OFF"}
                </button>

                <button onClick={() => setMirrorWebcam((v) => !v)} style={btn(mirrorWebcam)}>
                  MIRROR {mirrorWebcam ? "ON" : "OFF"}
                </button>

                <button onClick={toggleCamera} style={btn(false)}>
                  CAMERA FLIP
                </button>
              </div>

              <button onClick={() => setShowGridStroke((v) => !v)} style={btn(showGridStroke)}>
                CELL LINE {showGridStroke ? "ON" : "OFF"}
              </button>

              <button onClick={() => setShowGrain((v) => !v)} style={btn(showGrain)}>
                GRAIN {showGrain ? "ON" : "OFF"}
              </button>
            </div>

            <div style={groupBox}>
              <div style={sectionLabel}>Tone Controls</div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: "8px",
                }}
              >
                <div style={sliderWrap}>
                  <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
                    <span>DOT SIZE</span>
                    <span style={valueLabel}>{dotScale.toFixed(2)}</span>
                  </div>
                  <input
                    className="win95-range"
                    type="range"
                    min="0.1"
                    max="10"
                    step="0.01"
                    value={dotScale}
                    onChange={(e) => setDotScale(Number(e.target.value))}
                  />
                </div>

                <div style={sliderWrap}>
                  <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
                    <span>CONTRAST</span>
                    <span style={valueLabel}>{contrast.toFixed(2)}</span>
                  </div>
                  <input
                    className="win95-range"
                    type="range"
                    min="0.4"
                    max="2.2"
                    step="0.01"
                    value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                  />
                </div>

                <div style={sliderWrap}>
                  <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
                    <span>BRIGHTNESS</span>
                    <span style={valueLabel}>{brightness.toFixed(2)}</span>
                  </div>
                  <input
                    className="win95-range"
                    type="range"
                    min="-0.5"
                    max="0.5"
                    step="0.01"
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                  />
                </div>

                <div style={sliderWrap}>
                  <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
                    <span>GAMMA</span>
                    <span style={valueLabel}>{gamma.toFixed(2)}</span>
                  </div>
                  <input
                    className="win95-range"
                    type="range"
                    min="0.4"
                    max="2.4"
                    step="0.01"
                    value={gamma}
                    onChange={(e) => setGamma(Number(e.target.value))}
                  />
                </div>

                <div style={sliderWrap}>
                  <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
                    <span>CELL</span>
                    <span style={valueLabel}>{cellSize}</span>
                  </div>
                  <input
                    className="win95-range"
                    type="range"
                    min="4"
                    max="28"
                    step="1"
                    value={cellSize}
                    onChange={(e) => setCellSize(Number(e.target.value))}
                  />
                </div>

                <div style={sliderWrap}>
                  <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
                    <span>BG TONE</span>
                    <span style={valueLabel}>{bgTone}</span>
                  </div>
                  <input
                    className="win95-range"
                    type="range"
                    min="0"
                    max="80"
                    step="1"
                    value={bgTone}
                    onChange={(e) => setBgTone(Number(e.target.value))}
                  />
                </div>

                <div style={sliderWrap}>
                  <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
                    <span>SATURATION</span>
                    <span style={valueLabel}>{saturation.toFixed(2)}</span>
                  </div>
                  <input
                    className="win95-range"
                    type="range"
                    min="0"
                    max="2.5"
                    step="0.01"
                    value={saturation}
                    onChange={(e) => setSaturation(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            {isExporting ? (
              <div style={groupBox}>
                <div style={sectionLabel}>Export Progress</div>
                <div
                  style={{
                    ...insetStyle,
                    padding: "6px",
                    background: "#fff",
                  }}
                >
                  <div
                    style={{
                      height: "18px",
                      background: "#ffffff",
                      borderTop: `2px solid ${ui.shadow}`,
                      borderLeft: `2px solid ${ui.shadow}`,
                      borderRight: `2px solid ${ui.light}`,
                      borderBottom: `2px solid ${ui.light}`,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.round(exportProgress * 100)}%`,
                        background: ui.title,
                        transition: "width 0.1s linear",
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        style={{
          ...windowStyle,
          position: "fixed",
          left: isMobile ? "10px" : "14px",
          right: isMobile ? "10px" : "14px",
          bottom: isMobile ? "10px" : "10px",
          background: ui.face,
          height: "38px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 6px",
          boxSizing: "border-box",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div
            style={{
              ...btn(false, false),
              width: "92px",
              minHeight: "28px",
              padding: "0 8px",
              justifyContent: "flex-start",
            }}
          >
            <span
              style={{
                width: "14px",
                height: "14px",
                background: ui.title,
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "10px",
                fontWeight: 700,
              }}
            >
              S
            </span>
            <span>Start</span>
          </div>

          <div
            style={{
              ...insetStyle,
              height: "26px",
              padding: "0 8px",
              display: "flex",
              alignItems: "center",
              background: ui.face,
              fontSize: "12px",
            }}
          >
            Halftone Camera
          </div>
        </div>

        <div
          style={{
            ...insetStyle,
            height: "26px",
            padding: "0 8px",
            display: "flex",
            alignItems: "center",
            background: ui.face,
            fontSize: "12px",
            gap: "10px",
          }}
        >
          <span>{ready ? "READY" : "WAIT"}</span>
          <span>{String(colorMode).toUpperCase()}</span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="win95-file-input"
        type="file"
        accept="video/*"
        onChange={handleUploadChange}
      />

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
