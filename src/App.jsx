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

  if (shape === "triangle") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.9, y + r);
    ctx.lineTo(x - r * 0.9, y + r);
    ctx.closePath();
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

  if (shape === "star") {
    const spikes = 5;
    const outerRadius = r;
    const innerRadius = r * 0.45;
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;

    ctx.moveTo(x, y - outerRadius);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(x + Math.cos(rot) * outerRadius, y + Math.sin(rot) * outerRadius);
      rot += step;
      ctx.lineTo(x + Math.cos(rot) * innerRadius, y + Math.sin(rot) * innerRadius);
      rot += step;
    }
    ctx.closePath();
    ctx.fill();
    return;
  }

  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function getLuminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function App() {
  const videoRef = useRef(null);
  const hiddenCanvasRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const animationRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const [mode, setMode] = useState("webcam"); // webcam | file
  const [colorMode, setColorMode] = useState("bw"); // bw | rgb | cmyk
  const [shape, setShape] = useState("circle");

  const [dotSize, setDotSize] = useState(8);
  const [spacing, setSpacing] = useState(12);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1.15);
  const [gamma, setGamma] = useState(1.0);
  const [threshold, setThreshold] = useState(0);
  const [softness, setSoftness] = useState(0.8);
  const [backgroundTone, setBackgroundTone] = useState(8);

  const [invert, setInvert] = useState(false);
  const [mirror, setMirror] = useState(true);
  const [showGrid, setShowGrid] = useState(false);

  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [statusText, setStatusText] = useState("준비됨");
  const [selectedFileName, setSelectedFileName] = useState("");

  const uiScale = useMemo(() => {
    if (typeof window === "undefined") return 1;
    if (window.innerWidth <= 520) return 0.88;
    if (window.innerWidth <= 768) return 0.94;
    return 1;
  }, []);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, []);

  function stopAll() {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  async function setupWebcam() {
    try {
      stopAll();
      setStatusText("웹캠 연결 중...");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      await video.play();

      setIsCameraReady(true);
      setStatusText("웹캠 준비 완료");
      startRendering();
    } catch (error) {
      console.error(error);
      setIsCameraReady(false);
      setStatusText("웹캠 접근 실패");
      alert("웹캠 접근에 실패했습니다. 브라우저 권한을 확인해주세요.");
    }
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    stopAll();
    setMode("file");
    setSelectedFileName(file.name);
    setStatusText("영상 파일 불러오는 중...");

    const video = videoRef.current;
    if (!video) return;

    const url = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = url;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = async () => {
      try {
        await video.play();
        setStatusText("영상 파일 준비 완료");
        startRendering();
      } catch (e) {
        console.error(e);
        setStatusText("영상 재생 실패");
      }
    };
  }

  function startRendering() {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    setIsRendering(true);

    const render = () => {
      processFrame();
      animationRef.current = requestAnimationFrame(render);
    };

    render();
  }

  function processFrame() {
    const video = videoRef.current;
    const hiddenCanvas = hiddenCanvasRef.current;
    const outputCanvas = outputCanvasRef.current;

    if (!video || !hiddenCanvas || !outputCanvas) return;
    if (!video.videoWidth || !video.videoHeight) return;

    const hiddenCtx = hiddenCanvas.getContext("2d", { willReadFrequently: true });
    const outCtx = outputCanvas.getContext("2d");

    if (!hiddenCtx || !outCtx) return;

    const sourceW = video.videoWidth;
    const sourceH = video.videoHeight;

    hiddenCanvas.width = sourceW;
    hiddenCanvas.height = sourceH;

    const renderWidth = sourceW;
    const renderHeight = sourceH;

    outputCanvas.width = renderWidth;
    outputCanvas.height = renderHeight;

    hiddenCtx.save();
    hiddenCtx.clearRect(0, 0, sourceW, sourceH);

    if (mirror) {
      hiddenCtx.translate(sourceW, 0);
      hiddenCtx.scale(-1, 1);
    }

    hiddenCtx.drawImage(video, 0, 0, sourceW, sourceH);
    hiddenCtx.restore();

    const imageData = hiddenCtx.getImageData(0, 0, sourceW, sourceH);
    const data = imageData.data;

    outCtx.fillStyle = invert ? "#fff" : "#000";
    outCtx.fillRect(0, 0, renderWidth, renderHeight);

    const step = Math.max(4, Math.round(spacing));
    const sizeBase = dotSize;
    const bgDot = clamp(backgroundTone / 20, 0, 1.2);

    for (let y = 0; y < sourceH; y += step) {
      for (let x = 0; x < sourceW; x += step) {
        const i = (y * sourceW + x) * 4;
        const r0 = data[i];
        const g0 = data[i + 1];
        const b0 = data[i + 2];

        let r = clamp((r0 / 255 + brightness) * contrast, 0, 1);
        let g = clamp((g0 / 255 + brightness) * contrast, 0, 1);
        let b = clamp((b0 / 255 + brightness) * contrast, 0, 1);

        r = Math.pow(r, 1 / gamma);
        g = Math.pow(g, 1 / gamma);
        b = Math.pow(b, 1 / gamma);

        const lum = getLuminance(r, g, b);
        let darkness = 1 - lum;

        if (invert) darkness = 1 - darkness;

        if (threshold > 0) {
          darkness = darkness < threshold ? 0 : darkness;
        }

        darkness = Math.pow(clamp(darkness, 0, 1), Math.max(0.15, softness));

        const cx = x + step / 2;
        const cy = y + step / 2;

        if (bgDot > 0) {
          outCtx.fillStyle = invert ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.12)";
          drawShape(outCtx, shape, cx, cy, bgDot);
        }

        const s = clamp(darkness * sizeBase, 0, sizeBase);

        if (s <= 0.05) continue;

        if (colorMode === "bw") {
          outCtx.fillStyle = invert ? "#000" : "#fff";
          drawShape(outCtx, shape, cx, cy, s);
        } else if (colorMode === "rgb") {
          outCtx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
          drawShape(outCtx, shape, cx, cy, s);
        } else {
          const c = 1 - r;
          const m = 1 - g;
          const yv = 1 - b;

          if (c > 0.08) {
            outCtx.fillStyle = "rgba(0,255,255,0.85)";
            drawShape(outCtx, shape, cx - 2, cy, s * c);
          }
          if (m > 0.08) {
            outCtx.fillStyle = "rgba(255,0,255,0.85)";
            drawShape(outCtx, shape, cx + 2, cy, s * m);
          }
          if (yv > 0.08) {
            outCtx.fillStyle = "rgba(255,255,0,0.85)";
            drawShape(outCtx, shape, cx, cy + 2, s * yv);
          }
        }
      }
    }

    if (showGrid) {
      outCtx.save();
      outCtx.strokeStyle = invert ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.14)";
      outCtx.lineWidth = 1;
      for (let x = 0; x < renderWidth; x += step) {
        outCtx.beginPath();
        outCtx.moveTo(x, 0);
        outCtx.lineTo(x, renderHeight);
        outCtx.stroke();
      }
      for (let y = 0; y < renderHeight; y += step) {
        outCtx.beginPath();
        outCtx.moveTo(0, y);
        outCtx.lineTo(renderWidth, y);
        outCtx.stroke();
      }
      outCtx.restore();
    }
  }

  function saveFrame() {
    const canvas = outputCanvasRef.current;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `halftone-frame-${Date.now()}.png`);
    }, "image/png");
  }

  function saveProcessedVideo() {
    const canvas = outputCanvasRef.current;
    if (!canvas) return;

    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    try {
      recordedChunksRef.current = [];
      const stream = canvas.captureStream(30);

      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm",
      });

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        downloadBlob(blob, `halftone-video-${Date.now()}.webm`);
        setIsRecording(false);
        setStatusText("하프톤 영상 저장 완료");
      };

      recorder.start();
      setIsRecording(true);
      setStatusText("하프톤 영상 녹화 중...");
    } catch (error) {
      console.error(error);
      alert("영상 저장을 시작할 수 없습니다.");
    }
  }

  function saveOriginalWebcam() {
    const video = videoRef.current;
    if (!video || !video.srcObject) {
      alert("웹캠이 활성화되어 있지 않습니다.");
      return;
    }

    if (isRecording) {
      alert("현재 하프톤 녹화 중입니다. 먼저 종료해주세요.");
      return;
    }

    try {
      recordedChunksRef.current = [];
      const stream = video.srcObject;

      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm",
      });

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        downloadBlob(blob, `webcam-original-${Date.now()}.webm`);
        setIsRecording(false);
        setStatusText("웹캠 원본 저장 완료");
      };

      recorder.start();
      setIsRecording(true);
      setStatusText("웹캠 원본 녹화 중...");
    } catch (error) {
      console.error(error);
      alert("웹캠 저장을 시작할 수 없습니다.");
    }
  }

  function resetControls() {
    setColorMode("bw");
    setShape("circle");
    setDotSize(8);
    setSpacing(12);
    setBrightness(0);
    setContrast(1.15);
    setGamma(1.0);
    setThreshold(0);
    setSoftness(0.8);
    setBackgroundTone(8);
    setInvert(false);
    setMirror(true);
    setShowGrid(false);
  }

  const styles = {
    page: {
      minHeight: "100vh",
      background: "#dcdcdc",
      padding: window.innerWidth <= 768 ? "12px" : "24px",
      boxSizing: "border-box",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif',
    },
    shell: {
      width: "100%",
      maxWidth: "1400px",
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: window.innerWidth <= 980 ? "1fr" : "160px 1fr",
      gap: window.innerWidth <= 980 ? "12px" : "18px",
      alignItems: "start",
    },
    logoRail: {
      display: "flex",
      justifyContent: window.innerWidth <= 980 ? "flex-start" : "center",
      alignItems: "flex-start",
      paddingTop: window.innerWidth <= 980 ? "0" : "6px",
    },
    logo: {
      width: window.innerWidth <= 980 ? "64px" : "82px",
      height: "auto",
      display: "block",
    },
    main: {
      background: "#050505",
      borderRadius: window.innerWidth <= 768 ? "20px" : "28px",
      padding: window.innerWidth <= 768 ? "10px" : "16px",
      boxShadow: "0 10px 40px rgba(0,0,0,0.18)",
      overflow: "hidden",
    },
    previewWrap: {
      background: "#000",
      borderRadius: window.innerWidth <= 768 ? "16px" : "20px",
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)",
    },
    previewCanvas: {
      width: "100%",
      display: "block",
      background: "#000",
      aspectRatio: "16 / 9",
      objectFit: "contain",
    },
    controls: {
      marginTop: "14px",
      background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
      borderRadius: window.innerWidth <= 768 ? "18px" : "24px",
      border: "1px solid rgba(255,255,255,0.08)",
      padding: window.innerWidth <= 768 ? "12px" : "14px",
      color: "#fff",
    },
    grid2: {
      display: "grid",
      gridTemplateColumns: window.innerWidth <= 768 ? "1fr" : "1fr 1fr",
      gap: "10px",
      marginBottom: "10px",
    },
    grid3: {
      display: "grid",
      gridTemplateColumns:
        window.innerWidth <= 768 ? "1fr" : window.innerWidth <= 1100 ? "1fr 1fr" : "1fr 1fr 1fr",
      gap: "10px",
      marginBottom: "10px",
    },
    grid4: {
      display: "grid",
      gridTemplateColumns:
        window.innerWidth <= 768
          ? "1fr 1fr"
          : window.innerWidth <= 1100
          ? "1fr 1fr"
          : "1fr 1fr 1fr 1fr",
      gap: "10px",
      marginBottom: "10px",
    },
    grid6: {
      display: "grid",
      gridTemplateColumns:
        window.innerWidth <= 640
          ? "1fr"
          : window.innerWidth <= 980
          ? "1fr 1fr"
          : "1fr 1fr 1fr",
      gap: "10px",
      marginBottom: "10px",
    },
    button: (active = false) => ({
      width: "100%",
      minHeight: window.innerWidth <= 768 ? "52px" : "58px",
      borderRadius: "16px",
      border: active ? "1px solid rgba(255,255,255,0.25)" : "1px solid rgba(255,255,255,0.12)",
      background: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.05)",
      color: "#fff",
      fontSize: `${15 * uiScale}px`,
      fontWeight: 500,
      cursor: "pointer",
      transition: "all 0.15s ease",
      padding: "0 12px",
    }),
    actionButton: {
      width: "100%",
      minHeight: window.innerWidth <= 768 ? "54px" : "60px",
      borderRadius: "16px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.04)",
      color: "#fff",
      fontSize: `${15 * uiScale}px`,
      fontWeight: 500,
      cursor: "pointer",
      padding: "0 12px",
    },
    dangerButton: {
      width: "100%",
      minHeight: window.innerWidth <= 768 ? "54px" : "60px",
      borderRadius: "16px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.16)",
      color: "#fff",
      fontSize: `${15 * uiScale}px`,
      fontWeight: 600,
      cursor: "pointer",
      padding: "0 12px",
    },
    controlCard: {
      background: "rgba(0,0,0,0.24)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "16px",
      padding: window.innerWidth <= 768 ? "12px" : "14px",
      minHeight: "90px",
      boxSizing: "border-box",
    },
    labelRow: {
      display: "flex",
      justifyContent: "space-between",
      gap: "10px",
      alignItems: "center",
      marginBottom: "12px",
      color: "#e8e8e8",
      fontSize: `${14 * uiScale}px`,
    },
    slider: {
      width: "100%",
    },
    hidden: {
      display: "none",
    },
    select: {
      width: "100%",
      minHeight: window.innerWidth <= 768 ? "52px" : "58px",
      borderRadius: "16px",
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      padding: "0 14px",
      fontSize: `${15 * uiScale}px`,
      outline: "none",
    },
    fileBox: {
      display: "flex",
      alignItems: window.innerWidth <= 768 ? "flex-start" : "center",
      justifyContent: "space-between",
      flexDirection: window.innerWidth <= 768 ? "column" : "row",
      gap: "10px",
      background: "rgba(0,0,0,0.24)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "16px",
      padding: "12px",
      marginBottom: "10px",
    },
    fileName: {
      color: "rgba(255,255,255,0.8)",
      fontSize: `${14 * uiScale}px`,
      wordBreak: "break-all",
    },
    status: {
      marginTop: "8px",
      color: "rgba(255,255,255,0.68)",
      fontSize: `${13 * uiScale}px`,
      textAlign: "center",
    },
    footerButtons: {
      display: "grid",
      gridTemplateColumns: window.innerWidth <= 768 ? "1fr" : "1fr 1fr",
      gap: "10px",
      marginTop: "10px",
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.logoRail}>
          <img src="/logo.png" alt="logo" style={styles.logo} />
        </div>

        <div style={styles.main}>
          <div style={styles.previewWrap}>
            <canvas ref={outputCanvasRef} style={styles.previewCanvas} />
          </div>

          <div style={styles.controls}>
            <div style={styles.grid2}>
              <button
                style={styles.button(mode === "webcam")}
                onClick={() => {
                  setMode("webcam");
                  setupWebcam();
                }}
              >
                웹캠
              </button>

              <button
                style={styles.button(mode === "file")}
                onClick={() => {
                  setMode("file");
                }}
              >
                영상 파일
              </button>
            </div>

            <div style={styles.fileBox}>
              <label style={{ width: window.innerWidth <= 768 ? "100%" : "auto" }}>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  style={styles.hidden}
                />
                <span
                  style={{
                    ...styles.button(true),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: window.innerWidth <= 768 ? "100%" : "160px",
                  }}
                >
                  파일 선택
                </span>
              </label>

              <div style={styles.fileName}>
                {selectedFileName || "선택한 파일 없음"}
              </div>
            </div>

            <div style={styles.grid3}>
              <button style={styles.actionButton} onClick={saveFrame}>
                프레임 저장
              </button>
              <button style={styles.actionButton} onClick={saveOriginalWebcam}>
                웹캠 녹화 저장
              </button>
              <button
                style={isRecording ? styles.dangerButton : styles.actionButton}
                onClick={saveProcessedVideo}
              >
                {isRecording ? "하프톤 녹화 종료" : "하프톤 영상 저장"}
              </button>
            </div>

            <div style={styles.grid4}>
              <div style={styles.controlCard}>
                <div style={styles.labelRow}>
                  <span>닷 크기</span>
                  <span>{dotSize.toFixed(2)}</span>
                </div>
                <input
                  style={styles.slider}
                  type="range"
                  min="0.5"
                  max="20"
                  step="0.05"
                  value={dotSize}
                  onChange={(e) => setDotSize(parseFloat(e.target.value))}
                />
              </div>

              <div style={styles.controlCard}>
                <div style={styles.labelRow}>
                  <span>간격</span>
                  <span>{spacing}</span>
                </div>
                <input
                  style={styles.slider}
                  type="range"
                  min="4"
                  max="30"
                  step="1"
                  value={spacing}
                  onChange={(e) => setSpacing(parseInt(e.target.value, 10))}
                />
              </div>

              <div style={styles.controlCard}>
                <div style={styles.labelRow}>
                  <span>밝기</span>
                  <span>{brightness.toFixed(2)}</span>
                </div>
                <input
                  style={styles.slider}
                  type="range"
                  min="-0.6"
                  max="0.6"
                  step="0.01"
                  value={brightness}
                  onChange={(e) => setBrightness(parseFloat(e.target.value))}
                />
              </div>

              <div style={styles.controlCard}>
                <div style={styles.labelRow}>
                  <span>대비</span>
                  <span>{contrast.toFixed(2)}</span>
                </div>
                <input
                  style={styles.slider}
                  type="range"
                  min="0.4"
                  max="3"
                  step="0.01"
                  value={contrast}
                  onChange={(e) => setContrast(parseFloat(e.target.value))}
                />
              </div>

              <div style={styles.controlCard}>
                <div style={styles.labelRow}>
                  <span>감마</span>
                  <span>{gamma.toFixed(2)}</span>
                </div>
                <input
                  style={styles.slider}
                  type="range"
                  min="0.3"
                  max="3"
                  step="0.01"
                  value={gamma}
                  onChange={(e) => setGamma(parseFloat(e.target.value))}
                />
              </div>

              <div style={styles.controlCard}>
                <div style={styles.labelRow}>
                  <span>배경톤</span>
                  <span>{backgroundTone}</span>
                </div>
                <input
                  style={styles.slider}
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={backgroundTone}
                  onChange={(e) => setBackgroundTone(parseInt(e.target.value, 10))}
                />
              </div>

              <div style={styles.controlCard}>
                <div style={styles.labelRow}>
                  <span>소프트니스</span>
                  <span>{softness.toFixed(2)}</span>
                </div>
                <input
                  style={styles.slider}
                  type="range"
                  min="0.15"
                  max="2"
                  step="0.01"
                  value={softness}
                  onChange={(e) => setSoftness(parseFloat(e.target.value))}
                />
              </div>

              <div style={styles.controlCard}>
                <div style={styles.labelRow}>
                  <span>임계값</span>
                  <span>{threshold.toFixed(2)}</span>
                </div>
                <input
                  style={styles.slider}
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div style={styles.grid4}>
              <button
                style={styles.button(colorMode === "bw")}
                onClick={() => setColorMode("bw")}
              >
                흑백
              </button>
              <button
                style={styles.button(colorMode === "rgb")}
                onClick={() => setColorMode("rgb")}
              >
                RGB
              </button>
              <button
                style={styles.button(colorMode === "cmyk")}
                onClick={() => setColorMode("cmyk")}
              >
                CMYK
              </button>

              <select
                value={shape}
                onChange={(e) => setShape(e.target.value)}
                style={styles.select}
              >
                <option value="circle">원</option>
                <option value="square">사각형</option>
                <option value="triangle">삼각형</option>
                <option value="diamond">다이아</option>
                <option value="star">별</option>
              </select>
            </div>

            <div style={styles.grid4}>
              <button style={styles.button(invert)} onClick={() => setInvert((v) => !v)}>
                반전 {invert ? "ON" : "OFF"}
              </button>
              <button style={styles.button(mirror)} onClick={() => setMirror((v) => !v)}>
                웹캠 좌우반전 {mirror ? "ON" : "OFF"}
              </button>
              <button style={styles.button(showGrid)} onClick={() => setShowGrid((v) => !v)}>
                셀 라인 {showGrid ? "ON" : "OFF"}
              </button>
              <button style={styles.button(false)} onClick={resetControls}>
                기본값 복원
              </button>
            </div>

            <div style={styles.footerButtons}>
              <button style={styles.actionButton} onClick={setupWebcam}>
                웹캠 프리뷰 활성화
              </button>
              <button
                style={styles.actionButton}
                onClick={() => {
                  stopAll();
                  setIsRendering(false);
                  setIsCameraReady(false);
                  setStatusText("중지됨");
                }}
              >
                중지
              </button>
            </div>

            <div style={styles.status}>
              상태: {statusText}
              {mode === "webcam" && isCameraReady ? " / 웹캠 연결됨" : ""}
              {isRendering ? " / 렌더링 중" : ""}
            </div>
          </div>
        </div>
      </div>

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{ display: "none" }}
      />
      <canvas ref={hiddenCanvasRef} style={{ display: "none" }} />
    </div>
  );
}

export default App;
