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

  const tooDark = brightness < BRIGHTNESS_THRESHOLD;

  // Poll brightness from the live video feed
  useEffect(() => {
    if (capturedImage) return;            // stop polling when previewing

    const id = setInterval(() => {
      const video = webcamRef.current?.video;
      if (video && video.readyState >= 2) {
        setBrightness(getAverageBrightness(video));
      }
    }, BRIGHTNESS_POLL_MS);

    return () => clearInterval(id);
  }, [capturedImage]);

  const handleCapture = useCallback(async () => {
    if (tooDark) return;                  // block capture when too dark
    setBlurWarning(null);

    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) return;

    const variance = await getLaplacianVariance(imageSrc);

    if (variance < BLUR_THRESHOLD) {
      setBlurWarning(
        `Image is too blurry (sharpness ${variance.toFixed(1)}). Hold steady and try again.`
      );
      return;
    }

    // Resize to fixed 1024×585 before storing
    const resized = await resizeImage(imageSrc);
    setCapturedImage(resized);
  }, [tooDark]);

  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setBlurWarning(null);
  }, []);

  return (
    <div className="capture-page">
      <header className="capture-header">
        <h1 className="capture-title">Business Card Capture</h1>
      </header>

      <main className="capture-main">
        {capturedImage ? (
          <div className="preview-container">
            <img
              src={capturedImage}
              alt="Captured business card"
              className="preview-image"
            />
            <div className="capture-actions">
              <button className="btn btn-secondary" onClick={handleRetake}>
                Retake
              </button>
              <a
                className="btn btn-primary"
                href={capturedImage}
                download="business-card.png"
              >
                Download
              </a>
            </div>
          </div>
        ) : (
          <div className="camera-container">
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
                  </div>
                  <div className="overlay-mask overlay-mask-side" />
                </div>
                <div className="overlay-mask overlay-mask-bottom" />
              </div>
            </div>
            {tooDark && (
              <div className="brightness-warning">
                <span className="brightness-warning-icon">&#9888;</span>
                Too dark to capture — add more light
              </div>
            )}

            {blurWarning && !tooDark && (
              <div className="blur-warning">
                <span className="blur-warning-icon">&#9676;</span>
                {blurWarning}
              </div>
            )}

            <div className="brightness-bar">
              <div
                className={`brightness-bar-fill${
                  tooDark ? " brightness-bar-fill--low" : ""
                }`}
                style={{ width: `${Math.min((brightness / 255) * 100, 100)}%` }}
              />
            </div>

            <p className="capture-hint">
              Align the business card within the frame
            </p>
            <div className="capture-actions">
              <button
                className={`btn btn-primary${tooDark ? " btn-disabled" : ""}`}
                onClick={handleCapture}
                disabled={tooDark}
              >
                Capture
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
