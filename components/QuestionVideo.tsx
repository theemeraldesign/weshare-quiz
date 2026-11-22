"use client";

import { getVideoSource } from "@/lib/video";

export default function QuestionVideo({ url }: { url?: string | null }) {
  if (!url) return null;

  const source = getVideoSource(url);
  if (!source) return null;

  if (source.kind === "file") {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        aria-label="Question video"
        style={{
          display: "block",
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 12,
          background: "#000",
          objectFit: "contain",
        }}
      >
        <source src={source.src} />
        Your browser does not support embedded video.
      </video>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9" }}>
      <iframe
        src={source.src}
        title="Question video"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: 0,
          borderRadius: 12,
          background: "#000",
        }}
      />
    </div>
  );
}
