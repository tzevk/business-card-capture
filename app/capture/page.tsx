"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import "./capture.css";

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: "environment",
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

/**
 * ── AI Training Data Strategy ──
 * 70% controlled: fixed output size (1024×585), consistent aspect ratio,
 *                 format (PNG), and basic quality floor.
 * 30% natural:    lenient thresholds allow real-world variation in
 *                 lighting, slight blur, angles, and color casts —
 *                 all valuable for robust model training.
 */

/** Only reject extremely dark frames (near-black). Dim lighting is OK. */
const BRIGHTNESS_THRESHOLD = 25;
/** How often (ms) to sample brightness from the live feed */
const BRIGHTNESS_POLL_MS = 500;
/** Only reject severely blurry shots. Mild softness is fine for training. */
const BLUR_THRESHOLD = 5;

/** Fixed output dimensions (1.75:1 business-card ratio) — the "controlled" part */
const OUTPUT_W = 1024;
const OUTPUT_H = 585;

/**
 * Sample the video element and return average brightness (0-255).
 * Uses a small off-screen canvas for performance.
 */
function getAverageBrightness(video: HTMLVideoElement): number {
  const sampleW = 64;
  const sampleH = 48;
  const canvas = document.createElement("canvas");
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 255;

  ctx.drawImage(video, 0, 0, sampleW, sampleH);
  const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

  let total = 0;
  // Luminance from RGB: 0.299R + 0.587G + 0.114B
  for (let i = 0; i < data.length; i += 4) {
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return total / (sampleW * sampleH);
}

/**
 * Compute Laplacian variance on a grayscale image to measure sharpness.
 * A 3×3 Laplacian kernel is convolved over a down-scaled copy of the image.
 * Returns the variance of the result — low variance = blurry.
 */
function getLaplacianVariance(imageSrc: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Down-scale for speed
      const w = 160;
      const h = Math.round((img.height / img.width) * w);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);

      // Convert to grayscale buffer
      const gray = new Float32Array(w * h);
      for (let i = 0; i < gray.length; i++) {
        const p = i * 4;
        gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      }

      // Apply 3×3 Laplacian kernel: [0,1,0 / 1,-4,1 / 0,1,0]
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const lap =
            gray[(y - 1) * w + x] +
            gray[y * w + (x - 1)] +
            -4 * gray[y * w + x] +
            gray[y * w + (x + 1)] +
            gray[(y + 1) * w + x];
          sum += lap;
          sumSq += lap * lap;
          count++;
        }
      }

      const mean = sum / count;
      const variance = sumSq / count - mean * mean;
      resolve(variance);
    };
    img.src = imageSrc;
  });
}

/**
 * Resize an image data-URL to OUTPUT_W × OUTPUT_H using canvas.
 * Crops to the target aspect ratio (center-crop) then scales down,
 * so the result is never stretched or letterboxed.
 */
function resizeImage(imageSrc: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const targetRatio = OUTPUT_W / OUTPUT_H;
      const srcRatio = img.width / img.height;

      // Center-crop source to match target aspect ratio
      let sx = 0;
      let sy = 0;
      let sw = img.width;
      let sh = img.height;

      if (srcRatio > targetRatio) {
        // Source is wider — crop sides
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
      } else {
        // Source is taller — crop top/bottom
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
      }

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_W;
      canvas.height = OUTPUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas context unavailable"));

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_W, OUTPUT_H);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load image for resize"));
    img.src = imageSrc;
  });
}

export default function CapturePage() {
  const webcamRef = useRef<Webcam>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [brightness, setBrightness] = useState<number>(255);
  const [blurWarning, setBlurWarning] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [showFlash, setShowFlash] = useState(false);

  const tooDark = brightness < BRIGHTNESS_THRESHOLD;

  // Derive a friendly status label
  const statusLabel = tooDark
    ? "low-light"
    : brightness < 80
      ? "dim"
      : "ready";

  // Poll brightness from the live video feed
  useEffect(() => {
    if (capturedImage) return;

    const id = setInterval(() => {
      const video = webcamRef.current?.video;
      if (video && video.readyState >= 2) {
        setBrightness(getAverageBrightness(video));
      }
    }, BRIGHTNESS_POLL_MS);

    return () => clearInterval(id);
  }, [capturedImage]);

  const handleCapture = useCallback(async () => {
    if (tooDark || processing) return;
    setBlurWarning(null);
    setProcessing(true);

    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) {
      setProcessing(false);
      return;
    }

    const variance = await getLaplacianVariance(imageSrc);

    if (variance < BLUR_THRESHOLD) {
      setBlurWarning("Too blurry — hold your phone steady and try again");
      setProcessing(false);
      return;
    }

    // Resize to fixed 1024×585 before storing
    const resized = await resizeImage(imageSrc);

    // Camera-flash effect
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 200);

    setCapturedImage(resized);
    setCaptureCount((c) => c + 1);
    setProcessing(false);
  }, [tooDark, processing]);

  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setBlurWarning(null);
  }, []);

  return (
    <div className="capture-page">
      {/* ── Header ── */}
      <header className="capture-header">
        <h1 className="capture-title">
          <span className="capture-title-icon">&#9878;</span>{" "}
          CaptureCAM
        </h1>
        {captureCount > 0 && (
          <span className="capture-counter">{captureCount} captured</span>
        )}
      </header>

      <main className="capture-main">
        {capturedImage ? (
          /* ── Preview state ── */
          <div className="preview-container">
            <div className="preview-badge">&#10003; Captured</div>
            <img
              src={capturedImage}
              alt="Captured business card"
              className="preview-image"
            />
            <p className="preview-size">1024 &times; 585 px &middot; PNG</p>
            <div className="capture-actions">
              <button className="btn btn-secondary" onClick={handleRetake}>
                &#8634; Retake
              </button>
              <a
                className="btn btn-primary"
                href={capturedImage}
                download="business-card.png"
              >
                &#8615; Save
              </a>
            </div>
          </div>
        ) : (
          /* ── Camera state ── */
          <div className="camera-container">
            {/* Status pill */}
            <div className={`status-pill status-pill--${statusLabel}`}>
              <span className="status-dot" />
              {statusLabel === "ready"
                ? "Ready to capture"
                : statusLabel === "dim"
                  ? "Dim lighting — still OK"
                  : "Too dark — add light"}
            </div>

            <div className="camera-viewport">
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/png"
                videoConstraints={VIDEO_CONSTRAINTS}
                className="camera-feed"
              />
              <div className="overlay">
                <div className="overlay-mask overlay-mask-top" />
                <div className="overlay-middle">
                  <div className="overlay-mask overlay-mask-side" />
                  <div className="overlay-cutout">
                    <span className="overlay-corner overlay-corner-tl" />
                    <span className="overlay-corner overlay-corner-tr" />
                    <span className="overlay-corner overlay-corner-bl" />
                    <span className="overlay-corner overlay-corner-br" />
                    <span className="overlay-label">Place card here</span>
                  </div>
                  <div className="overlay-mask overlay-mask-side" />
                </div>
                <div className="overlay-mask overlay-mask-bottom" />
              </div>

              {/* Flash effect */}
              {showFlash && <div className="capture-flash" />}
            </div>

            {/* Warnings */}
            {blurWarning && !tooDark && (
              <div className="blur-warning">
                <span className="blur-warning-icon">&#9711;</span>
                {blurWarning}
              </div>
            )}

            {/* Brightness bar */}
            <div className="brightness-bar">
              <div
                className={`brightness-bar-fill${
                  tooDark ? " brightness-bar-fill--low" : ""
                }`}
                style={{ width: `${Math.min((brightness / 255) * 100, 100)}%` }}
              />
            </div>

            {/* Capture button */}
            <div className="capture-actions">
              <button
                className={`btn btn-capture${tooDark || processing ? " btn-disabled" : ""}`}
                onClick={handleCapture}
                disabled={tooDark || processing}
              >
                {processing ? (
                  <span className="spinner" />
                ) : (
                  <span className="btn-capture-ring" />
                )}
              </button>
            </div>

            <p className="capture-hint">
              Align the card within the blue frame, then tap the button
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
