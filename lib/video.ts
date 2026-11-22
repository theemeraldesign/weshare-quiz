export type VideoSource =
  | { kind: "embed"; src: string }
  | { kind: "file"; src: string };

export function getVideoSource(value: string): VideoSource | null {
  const input = value.trim();
  if (!input) return null;

  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (host === "youtu.be") {
      const id = pathParts[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id)
        ? { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` }
        : null;
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      const id =
        url.searchParams.get("v") ||
        (["embed", "shorts", "live"].includes(pathParts[0]) ? pathParts[1] : null);

      return id && /^[a-zA-Z0-9_-]{11}$/.test(id)
        ? { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` }
        : null;
    }

    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id =
        host === "player.vimeo.com" && pathParts[0] === "video"
          ? pathParts[1]
          : [...pathParts].reverse().find((part) => /^\d+$/.test(part));

      return id ? { kind: "embed", src: `https://player.vimeo.com/video/${id}` } : null;
    }

    if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) {
      return { kind: "file", src: url.toString() };
    }

    return null;
  } catch {
    return null;
  }
}
