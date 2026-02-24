"use client";

import { useEffect, useState } from "react";
import "./gallery.css";

interface GalleryImage {
  filename: string;
  url: string;
  size: number;
  createdAt: string;
}

export default function GalleryPage() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GalleryImage | null>(null);

  useEffect(() => {
    fetch("/api/gallery")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setImages(data.images);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="gallery-page">
      {/* ── Header ── */}
      <header className="gallery-header">
        <a href="/capture" className="gallery-back">&#8592;</a>
        <h1 className="gallery-title">Gallery</h1>
        <span className="gallery-count">{images.length}</span>
      </header>

      {/* ── Content ── */}
      <main className="gallery-main">
        {loading ? (
          <div className="gallery-empty">
            <span className="spinner" />
            <p>Loading captures…</p>
          </div>
        ) : images.length === 0 ? (
          <div className="gallery-empty">
            <span className="gallery-empty-icon">&#128247;</span>
            <p>No captures yet</p>
            <a href="/capture" className="btn btn-primary">
              Start Capturing
            </a>
          </div>
        ) : (
          <div className="gallery-grid">
            {images.map((img) => (
              <button
                key={img.filename}
                className="gallery-card"
                onClick={() => setSelected(img)}
              >
                <img
                  src={img.url}
                  alt={img.filename}
                  className="gallery-thumb"
                  loading="lazy"
                />
                <span className="gallery-card-time">
                  {new Date(img.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* ── Lightbox ── */}
      {selected && (
        <div className="lightbox" onClick={() => setSelected(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="lightbox-close"
              onClick={() => setSelected(null)}
            >
              &times;
            </button>
            <img
              src={selected.url}
              alt={selected.filename}
              className="lightbox-image"
            />
            <div className="lightbox-info">
              <span>{(selected.size / 1024).toFixed(0)} KB</span>
              <span>&middot;</span>
              <span>
                {new Date(selected.createdAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
