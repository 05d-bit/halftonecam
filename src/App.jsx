



import React, { useEffect, useRef, useState } from "react";

export default function HalftoneWebcamApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const programRef = useRef(null);
  const textureRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const uniformsRef = useRef({});
  const uploadedUrlRef = useRef(null);

  const recorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const [sourceMode, setSourceMode] = useState("camera");
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [uploadedName, setUploadedName] = useState("");

  const [dotSize, setDotSize] = useState(8);
  const [contrast, setContrast] = useState(1.1);
  const [brightness, setBrightness] = useState(0.0);
  const [gamma, setGamma] = useState(1.0);
  const [softness, setSoftness] = useState(0.8);
  const [threshold, setThreshold] = useState(0.0);

  const [invert, setInvert] = useState(false);
  const [mode, setMode] = useState("bw");
  const [shape, setShape] = useState("circle");
  const [cameraFacing, setCameraFacing] = useState("user");
  const [mirrorX, setMirrorX] = useState(true);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const [isRecordingCamera, setIsRecordingCamera] = useState(false);
  const [cameraRecordSeconds, setCameraRecordSeconds] = useState(0);
  const cameraTimerRef = useRef(null);

  const paramsRef = useRef({
    dotSize: 8,
    contrast: 1.1,
    brightness: 0.0,
    gamma: 1.0,
    softness: 0.8,
    threshold: 0.0,
    invert: false,
    mode: "bw",
    shape: "circle",
    mirrorX: true,
  });

  useEffect(() => {
    paramsRef.current = {
      dotSize,
      contrast,
      brightness,
      gamma,
      softness,
      threshold,
      invert,
      mode,
      shape,
      mirrorX,
    };
  }, [dotSize, contrast, brightness, gamma, softness, threshold, invert, mode, shape, mirrorX]);

  useEffect(() => {
    let mounted = true;

    const stopCurrentStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    const setupSource = async () => {
      try {
        setReady(false);
        setError("");

        const video = videoRef.current;
        if (!video) return;

        if (isRecordingCamera) {
          stopCameraRecording();
        }

        stopCurrentStream();

        video.pause();
        video.removeAttribute("src");
        video.srcObject = null;
        video.load();

        if (sourceMode === "camera") {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: cameraFacing,
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });

          if (!mounted) return;

          streamRef.current = stream;
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          await video.play();
        } else {
          if (!uploadedUrl) {
            setError("영상 파일을 먼저 선택해주세요.");
            return;
          }

          video.srcObject = null;
          video.src = uploadedUrl;
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          await video.play();
        }

        if (!glRef.current) {
          initWebGL();
        }

        resizeCanvas();

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        render();

        setReady(true);
      } catch (e) {
        console.error(e);
        setError("소스를 불러오지 못했습니다. 카메라 권한 또는 영상 파일을 확인해주세요.");
      }
    };

    setupSource();

    const handleResize = () => resizeCanvas();
    window.addEventListener("resize", handleResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (cameraTimerRef.current) clearInterval(cameraTimerRef.current);
      stopCurrentStream();
    };
  }, [sourceMode, cameraFacing, uploadedUrl]);

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const gl = glRef.current;
    if (!canvas || !gl) return;

    const container = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const maxWidth = container.clientWidth;
    const maxHeight = container.clientHeight || window.innerHeight * 0.9;

    const videoAspect =
      video?.videoWidth && video?.videoHeight
        ? video.videoWidth / video.videoHeight
        : 16 / 9;

    let width = maxWidth;
    let height = width / videoAspect;

    if (height > maxHeight) {
      height = maxHeight;
      width = height * videoAspect;
    }

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const initWebGL = () => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });

    if (!gl) {
      setError("이 브라우저는 WebGL을 지원하지 않습니다.");
      return;
    }

    glRef.current = gl;

    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;

      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;

      varying vec2 v_texCoord;

      uniform sampler2D u_image;
      uniform vec2 u_resolution;
      uniform float u_dotSize;
      uniform float u_contrast;
      uniform float u_brightness;
      uniform float u_gamma;
      uniform float u_softness;
      uniform float u_threshold;
      uniform float u_invert;
      uniform float u_mode;
      uniform float u_shape;
      uniform float u_mirrorX;

      float luminance(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
      }

      vec3 applyTone(vec3 color, float brightness, float contrast, float gamma) {
        color += brightness;
        color = (color - 0.5) * contrast + 0.5;
        color = clamp(color, 0.0, 1.0);
        color = pow(color, vec3(1.0 / max(0.01, gamma)));
        return clamp(color, 0.0, 1.0);
      }

      vec2 rotate2D(vec2 p, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c) * p;
      }

      float sdBox(vec2 p, vec2 b) {
        vec2 d = abs(p) - b;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      }

      float sdDiamond(vec2 p, float r) {
        return (abs(p.x) + abs(p.y)) - r;
      }

      float sdEquilateralTriangle(vec2 p, float r) {
        const float k = 1.7320508;
        p.x = abs(p.x) - r;
        p.y = p.y + r / k;
        if (p.x + k * p.y > 0.0) {
          p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
        }
        p.x -= clamp(p.x, -2.0 * r, 0.0);
        return -length(p) * sign(p.y);
      }

      float sdCross(vec2 p, float s, float t) {
        float v = sdBox(p, vec2(t, s));
        float h = sdBox(p, vec2(s, t));
        return min(v, h);
      }

      float shapeMask(vec2 frag, float cell, float amount, float softness, float shapeType) {
        float size = amount * (cell * 0.48);
        vec2 p = mod(frag, cell) - cell * 0.5;
        float edge = max(0.2, softness);
        float dist = 0.0;

        if (shapeType < 0.5) {
          dist = length(p) - size;
        } else if (shapeType < 1.5) {
          dist = sdBox(p, vec2(size));
        } else if (shapeType < 2.5) {
          dist = sdEquilateralTriangle(vec2(p.x, -p.y), size * 1.05);
        } else if (shapeType < 3.5) {
          dist = sdDiamond(p, size * 1.35);
        } else {
          float d1 = sdCross(p, size, max(1.0, size * 0.22));
          vec2 pr = rotate2D(p, radians(45.0));
          float d2 = sdCross(pr, size * 0.92, max(1.0, size * 0.18));
          dist = min(d1, d2);
        }

        return 1.0 - smoothstep(-edge, edge, dist);
      }

      float shapeMaskRotated(vec2 frag, float cell, float amount, float softness, float shapeType, float angle) {
        vec2 p = rotate2D(frag, angle);
        return shapeMask(p, cell, amount, softness, shapeType);
      }

      vec4 cmykFromRgb(vec3 rgb) {
        float k = 1.0 - max(max(rgb.r, rgb.g), rgb.b);
        float denom = max(0.0001, 1.0 - k);

        float c = (1.0 - rgb.r - k) / denom;
        float m = (1.0 - rgb.g - k) / denom;
        float y = (1.0 - rgb.b - k) / denom;

        return vec4(clamp(c, 0.0, 1.0), clamp(m, 0.0, 1.0), clamp(y, 0.0, 1.0), clamp(k, 0.0, 1.0));
      }

      void main() {
        vec2 frag = gl_FragCoord.xy;
        float cell = max(3.0, u_dotSize);

        vec2 cellCoord = floor(frag / cell);
        vec2 cellCenter = (cellCoord + 0.5) * cell;

        vec2 uv = cellCenter / u_resolution;
        uv.y = 1.0 - uv.y;

        if (u_mirrorX > 0.5) {
          uv.x = 1.0 - uv.x;
        }

        vec3 src = texture2D(u_image, uv).rgb;
        src = applyTone(src, u_brightness, u_contrast, u_gamma);

        if (u_mode < 0.5) {
          float lum = luminance(src);
          lum = clamp((lum - u_threshold) / max(0.001, 1.0 - u_threshold), 0.0, 1.0);

          if (u_invert > 0.5) {
            lum = 1.0 - lum;
          }

          float amount = 1.0 - lum;
          float mask = shapeMask(frag, cell, amount, u_softness, u_shape);
          vec3 color = mix(vec3(1.0), vec3(0.0), mask);
          gl_FragColor = vec4(color, 1.0);
          return;
        }

        if (u_mode < 1.5) {
          float lum = luminance(src);
          lum = clamp((lum - u_threshold) / max(0.001, 1.0 - u_threshold), 0.0, 1.0);

          if (u_invert > 0.5) {
            lum = 1.0 - lum;
          }

          float amount = 1.0 - lum;
          float mask = shapeMask(frag, cell, amount, u_softness, u_shape);
          vec3 color = mix(vec3(1.0), src, mask);
          gl_FragColor = vec4(color, 1.0);
          return;
        }

        vec4 cmyk = cmykFromRgb(src);
        float c = cmyk.x;
        float m = cmyk.y;
        float y = cmyk.z;
        float k = cmyk.w;

        if (u_invert > 0.5) {
          c = 1.0 - c;
          m = 1.0 - m;
          y = 1.0 - y;
          k = 1.0 - k;
        }

        c = clamp((c - u_threshold) / max(0.001, 1.0 - u_threshold), 0.0, 1.0);
        m = clamp((m - u_threshold) / max(0.001, 1.0 - u_threshold), 0.0, 1.0);
        y = clamp((y - u_threshold) / max(0.001, 1.0 - u_threshold), 0.0, 1.0);
        k = clamp((k - u_threshold) / max(0.001, 1.0 - u_threshold), 0.0, 1.0);

        float cyanMask = shapeMaskRotated(frag, cell, c, u_softness, u_shape, radians(15.0));
        float magentaMask = shapeMaskRotated(frag, cell, m, u_softness, u_shape, radians(75.0));
        float yellowMask = shapeMaskRotated(frag, cell, y, u_softness, u_shape, radians(0.0));
        float blackMask = shapeMaskRotated(frag, cell, k, u_softness, u_shape, radians(45.0));

        vec3 color = vec3(1.0);
        color *= mix(vec3(1.0), vec3(0.0, 1.0, 1.0), cyanMask);
        color *= mix(vec3(1.0), vec3(1.0, 0.0, 1.0), magentaMask);
        color *= mix(vec3(1.0), vec3(1.0, 1.0, 0.0), yellowMask);
        color *= mix(vec3(1.0), vec3(0.0), blackMask);

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `;

    const createShader = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(info || "Shader compile failed");
      }

      return shader;
    };

    const createProgram = (vsSource, fsSource) => {
      const vs = createShader(gl.VERTEX_SHADER, vsSource);
      const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
      const program = gl.createProgram();

      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        throw new Error(info || "Program link failed");
      }

      return program;
    };

    try {
      const program = createProgram(vertexShaderSource, fragmentShaderSource);
      programRef.current = program;
      gl.useProgram(program);

      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
          -1,  1,
           1, -1,
           1,  1,
        ]),
        gl.STATIC_DRAW
      );

      const texCoordBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          0, 0,
          1, 0,
          0, 1,
          0, 1,
          1, 0,
          1, 1,
        ]),
        gl.STATIC_DRAW
      );

      const aPosition = gl.getAttribLocation(program, "a_position");
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

      const aTexCoord = gl.getAttribLocation(program, "a_texCoord");
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(aTexCoord);
      gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      textureRef.current = texture;

      uniformsRef.current = {
        image: gl.getUniformLocation(program, "u_image"),
        resolution: gl.getUniformLocation(program, "u_resolution"),
        dotSize: gl.getUniformLocation(program, "u_dotSize"),
        contrast: gl.getUniformLocation(program, "u_contrast"),
        brightness: gl.getUniformLocation(program, "u_brightness"),
        gamma: gl.getUniformLocation(program, "u_gamma"),
        softness: gl.getUniformLocation(program, "u_softness"),
        threshold: gl.getUniformLocation(program, "u_threshold"),
        invert: gl.getUniformLocation(program, "u_invert"),
        mode: gl.getUniformLocation(program, "u_mode"),
        shape: gl.getUniformLocation(program, "u_shape"),
        mirrorX: gl.getUniformLocation(program, "u_mirrorX"),
      };

      gl.uniform1i(uniformsRef.current.image, 0);
    } catch (e) {
      console.error(e);
      setError("셰이더 초기화에 실패했습니다.");
    }
  };

  const render = () => {
    const gl = glRef.current;
    const program = programRef.current;
    const texture = textureRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const uniforms = uniformsRef.current;
    const params = paramsRef.current;

    if (!gl || !program || !texture || !video || !canvas) return;

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);

      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.dotSize, params.dotSize * (window.devicePixelRatio || 1));
      gl.uniform1f(uniforms.contrast, params.contrast);
      gl.uniform1f(uniforms.brightness, params.brightness);
      gl.uniform1f(uniforms.gamma, params.gamma);
      gl.uniform1f(uniforms.softness, params.softness);
      gl.uniform1f(uniforms.threshold, params.threshold);
      gl.uniform1f(uniforms.invert, params.invert ? 1 : 0);
      gl.uniform1f(uniforms.mirrorX, params.mirrorX ? 1 : 0);

      let modeValue = 0;
      if (params.mode === "rgb") modeValue = 1;
      if (params.mode === "cmyk") modeValue = 2;
      gl.uniform1f(uniforms.mode, modeValue);

      let shapeValue = 0;
      if (params.shape === "square") shapeValue = 1;
      if (params.shape === "triangle") shapeValue = 2;
      if (params.shape === "diamond") shapeValue = 3;
      if (params.shape === "star") shapeValue = 4;
      gl.uniform1f(uniforms.shape, shapeValue);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    rafRef.current = requestAnimationFrame(render);
  };

  const downloadFrame = () => {
    const canvas = canvasRef.current;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `halftone-${Date.now()}.png`;
    link.click();
  };

  const getSupportedMimeType = () => {
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) return "video/webm;codecs=vp9";
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) return "video/webm;codecs=vp8";
  if (MediaRecorder.isTypeSupported("video/webm")) return "video/webm";
  return "";
};

  const startCameraRecording = () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        alert("이 브라우저는 webm 녹화를 지원하지 않습니다.");
        return;
      }

      recordedChunksRef.current = [];

      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `halftone-camera-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };

      recorder.start(100);
      setIsRecordingCamera(true);
      setCameraRecordSeconds(0);

      if (cameraTimerRef.current) clearInterval(cameraTimerRef.current);
      cameraTimerRef.current = setInterval(() => {
        setCameraRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      console.error(err);
      alert("웹캠 녹화를 시작하지 못했습니다.");
    }
  };

  const stopCameraRecording = () => {
    try {
      if (cameraTimerRef.current) {
        clearInterval(cameraTimerRef.current);
        cameraTimerRef.current = null;
      }

      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }

      setIsRecordingCamera(false);
    } catch (err) {
      console.error(err);
      alert("웹캠 녹화를 정지하지 못했습니다.");
    }
  };

  const exportProcessedVideo = async () => {
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (!canvas || !video) {
        alert("캔버스 또는 영상 소스를 찾을 수 없습니다.");
        return;
      }

      if (sourceMode !== "file") {
        alert("영상 파일 모드에서만 전체 영상 저장이 가능합니다.");
        return;
      }

      if (!video.duration || !isFinite(video.duration)) {
        alert("영상 길이를 확인할 수 없습니다.");
        return;
      }

      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        alert("이 브라우저는 webm 녹화를 지원하지 않습니다.");
        return;
      }

      setIsExporting(true);
      setExportProgress(0);

      recordedChunksRef.current = [];

      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      const stopPromise = new Promise((resolve) => {
        recorder.onstop = resolve;
      });

      const originalLoop = video.loop;
      const originalMuted = video.muted;
      const originalTime = video.currentTime;
      const originalPaused = video.paused;

      video.pause();
      video.currentTime = 0;
      video.loop = false;
      video.muted = true;

      const endedPromise = new Promise((resolve) => {
        const onEnded = () => {
          video.removeEventListener("ended", onEnded);
          resolve();
        };
        video.addEventListener("ended", onEnded);
      });

      recorder.start(100);

      let progressRaf = null;
      const updateProgress = () => {
        if (video.duration) {
          setExportProgress(video.currentTime / video.duration);
        }
        progressRaf = requestAnimationFrame(updateProgress);
      };
      updateProgress();

      await video.play();
      await endedPromise;

      recorder.stop();
      await stopPromise;

      if (progressRaf) cancelAnimationFrame(progressRaf);

      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `halftone-export-${Date.now()}.webm`;
      a.click();

      URL.revokeObjectURL(url);

      video.loop = originalLoop;
      video.muted = originalMuted;
      video.currentTime = originalTime;

      if (!originalPaused) {
        await video.play();
      }

      setExportProgress(1);
      setTimeout(() => setExportProgress(0), 800);
    } catch (err) {
      console.error(err);
      alert("영상 저장 중 오류가 발생했습니다.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (uploadedUrlRef.current) {
      URL.revokeObjectURL(uploadedUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    uploadedUrlRef.current = url;
    setUploadedUrl(url);
    setUploadedName(file.name);
    setSourceMode("file");
    setMirrorX(false);
  };

  const formatSeconds = (sec) => {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  const pillButton = (active = false) => ({
    borderRadius: "999px",
    padding: "10px 12px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: active ? "white" : "rgba(255,255,255,0.05)",
    color: active ? "black" : "white",
    cursor: "pointer",
    fontSize: "13px",
    minHeight: "40px",
    whiteSpace: "nowrap",
  });

  const shapeIcons = {
    circle: "○",
    square: "□",
    triangle: "△",
    diamond: "◇",
    star: "★",
  };

  const iconButton = (active = false) => ({
    borderRadius: "14px",
    padding: "0",
    border: "1px solid rgba(255,255,255,0.14)",
    background: active ? "white" : "rgba(255,255,255,0.05)",
    color: active ? "black" : "white",
    cursor: "pointer",
    fontSize: "24px",
    minHeight: "52px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  const compactSliderBlock = (label, valueText, value, min, max, step, setter) => (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "14px",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        minHeight: "92px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
        }}
      >
        <span style={{ opacity: 0.9 }}>{label}</span>
        <span style={{ opacity: 0.75 }}>{valueText}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setter(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "white",
        padding: "14px",
        fontFamily: "sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "1600px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 380px",
          gap: "14px",
          height: "calc(100vh - 28px)",
        }}
      >
        <div
          style={{
            minWidth: 0,
            borderRadius: "28px",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "black",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            minHeight: 0,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#111",
              position: "relative",
            }}
          >
            <video ref={videoRef} style={{ display: "none" }} playsInline muted />
            <canvas
              ref={canvasRef}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            />

            <div
              style={{
                position: "absolute",
                top: "16px",
                left: "16px",
                zIndex: 10,
                padding: "12px 14px",
                borderRadius: "18px",
                background: "rgba(0,0,0,0.45)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.08)",
                maxWidth: "420px",
              }}
            >
              <div style={{ fontSize: "28px", fontWeight: 700, lineHeight: 1.05 }}>
                Halftone Camera / Video
              </div>
              <div
                style={{
                  marginTop: "6px",
                  fontSize: "13px",
                  color: "rgba(255,255,255,0.75)",
                  lineHeight: 1.45,
                }}
              >
                웹캠/업로드 영상 모두 지원, 컬러 모드·도형·좌우 반전·영상 저장까지 가능한 버전입니다.
              </div>
              <div
                style={{
                  marginTop: "8px",
                  fontSize: "12px",
                  color: "rgba(255,255,255,0.6)",
                }}
              >
                현재 소스: {sourceMode === "camera" ? "웹캠" : uploadedName || "영상 파일"}
              </div>
            </div>

            {isRecordingCamera && (
              <div
                style={{
                  position: "absolute",
                  top: "16px",
                  right: "16px",
                  zIndex: 10,
                  padding: "10px 14px",
                  borderRadius: "999px",
                  background: "rgba(255,0,0,0.18)",
                  border: "1px solid rgba(255,80,80,0.4)",
                  backdropFilter: "blur(8px)",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                ● REC {formatSeconds(cameraRecordSeconds)}
              </div>
            )}

            {!ready && !error && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(255,255,255,0.7)",
                  fontSize: "14px",
                }}
              >
                소스를 준비 중입니다...
              </div>
            )}

            {error && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px",
                  textAlign: "center",
                  fontSize: "14px",
                  color: "#fca5a5",
                  background: "rgba(0,0,0,0.7)",
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            minHeight: 0,
            borderRadius: "24px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(0,0,0,0.18)",
              position: "sticky",
              top: 0,
              zIndex: 5,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              <button
                onClick={() => {
                  setSourceMode("camera");
                  setMirrorX(true);
                }}
                style={pillButton(sourceMode === "camera")}
              >
                웹캠
              </button>
              <button
                onClick={() => setSourceMode("file")}
                style={pillButton(sourceMode === "file")}
              >
                영상 파일
              </button>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "14px",
                padding: "10px 12px",
                marginBottom: "8px",
              }}
            >
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                onChange={handleFileChange}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "8px" }}>
                {uploadedName ? `선택된 파일: ${uploadedName}` : "아직 선택된 영상 파일이 없습니다."}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              <button onClick={() => setMode("bw")} style={pillButton(mode === "bw")}>B/W</button>
              <button onClick={() => setMode("rgb")} style={pillButton(mode === "rgb")}>RGB</button>
              <button onClick={() => setMode("cmyk")} style={pillButton(mode === "cmyk")}>CMYK</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: "8px",
                }}
              >
                <button
                  onClick={() => setShape("circle")}
                  style={iconButton(shape === "circle")}
                  title="Circle"
                >
                  {shapeIcons.circle}
                </button>

                <button
                  onClick={() => setShape("square")}
                  style={iconButton(shape === "square")}
                  title="Square"
                >
                  {shapeIcons.square}
                </button>

                <button
                  onClick={() => setShape("triangle")}
                  style={iconButton(shape === "triangle")}
                  title="Triangle"
                >
                  {shapeIcons.triangle}
                </button>

                <button
                  onClick={() => setShape("diamond")}
                  style={iconButton(shape === "diamond")}
                  title="Diamond"
                >
                  {shapeIcons.diamond}
                </button>

                <button
                  onClick={() => setShape("star")}
                  style={iconButton(shape === "star")}
                  title="Star"
                >
                  {shapeIcons.star}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                <button onClick={() => setInvert((v) => !v)} style={pillButton(invert)}>
                  {invert ? "Invert On" : "Invert Off"}
                </button>

                <button onClick={() => setMirrorX((v) => !v)} style={pillButton(mirrorX)}>
                  {mirrorX ? "좌우반전 On" : "좌우반전 Off"}
                </button>

                <button
                  onClick={() => {
                    if (sourceMode !== "camera") {
                      setSourceMode("camera");
                      setMirrorX(true);
                      return;
                    }
                    setCameraFacing((v) => (v === "user" ? "environment" : "user"));
                  }}
                  style={pillButton(false)}
                >
                  카메라 전환
                </button>
              </div>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
              }}
            >
              {compactSliderBlock("Dot", dotSize.toFixed(0), dotSize, 4, 28, 1, setDotSize)}
              {compactSliderBlock("Contrast", contrast.toFixed(2), contrast, 0.5, 2.5, 0.01, setContrast)}
              {compactSliderBlock("Brightness", brightness.toFixed(2), brightness, -0.5, 0.5, 0.01, setBrightness)}
              {compactSliderBlock("Gamma", gamma.toFixed(2), gamma, 0.4, 2.4, 0.01, setGamma)}
              {compactSliderBlock("Softness", softness.toFixed(2), softness, 0.2, 2.5, 0.01, setSoftness)}
              {compactSliderBlock("Threshold", threshold.toFixed(2), threshold, 0.0, 0.85, 0.01, setThreshold)}
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "16px",
                padding: "12px",
                fontSize: "12px",
                color: "rgba(255,255,255,0.7)",
                lineHeight: 1.45,
              }}
            >
              {sourceMode === "camera"
                ? "웹캠 모드에서는 하프톤 프리뷰를 바로 녹화해서 webm으로 저장할 수 있습니다."
                : "업로드 영상은 하프톤 처리된 전체 결과를 webm으로 저장합니다."}
            </div>

            {sourceMode === "camera" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <button
                  onClick={isRecordingCamera ? stopCameraRecording : startCameraRecording}
                  style={{
                    gridColumn: "1 / -1",
                    borderRadius: "14px",
                    padding: "12px",
                    border: "none",
                    background: isRecordingCamera ? "#ff4d4f" : "white",
                    color: isRecordingCamera ? "white" : "black",
                    cursor: "pointer",
                    fontSize: "14px",
                    minHeight: "44px",
                    fontWeight: 600,
                  }}
                >
                  {isRecordingCamera
                    ? `녹화 정지 (${formatSeconds(cameraRecordSeconds)})`
                    : "웹캠 하프톤 녹화 시작"}
                </button>

                <button
                  onClick={downloadFrame}
                  style={{
                    borderRadius: "14px",
                    padding: "12px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.05)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  프레임 저장
                </button>

                <button
                  onClick={() => {
                    setDotSize(8);
                    setContrast(1.1);
                    setBrightness(0.0);
                    setGamma(1.0);
                    setSoftness(0.8);
                    setThreshold(0.0);
                    setInvert(false);
                    setMode("bw");
                    setShape("circle");
                  }}
                  style={{
                    borderRadius: "14px",
                    padding: "12px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.05)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  기본값 복원
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
                <button
                  onClick={exportProcessedVideo}
                  disabled={isExporting || sourceMode !== "file"}
                  style={{
                    borderRadius: "14px",
                    padding: "12px",
                    border: "none",
                    background:
                      isExporting || sourceMode !== "file"
                        ? "rgba(255,255,255,0.12)"
                        : "white",
                    color:
                      isExporting || sourceMode !== "file"
                        ? "rgba(255,255,255,0.45)"
                        : "black",
                    cursor: isExporting || sourceMode !== "file" ? "not-allowed" : "pointer",
                    fontSize: "14px",
                    minHeight: "44px",
                    fontWeight: 600,
                  }}
                >
                  {isExporting
                    ? `하프톤 영상 저장 중 ${Math.round(exportProgress * 100)}%`
                    : "하프톤 영상 저장"}
                </button>

                <button
                  onClick={downloadFrame}
                  style={{
                    borderRadius: "14px",
                    padding: "12px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.05)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  현재 프레임 저장
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  }
