export function getLessonVideoSource(value: string): {
  kind: "youtube" | "vimeo" | "file";
  url: string;
} | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be"].includes(host)) {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = host === "youtu.be" ? parts[0] : url.pathname === "/watch" ? url.searchParams.get("v") : ["embed", "shorts"].includes(parts[0]) ? parts[1] : null;
      return id && /^[\w-]{11}$/.test(id) ? { kind: "youtube", url: `https://www.youtube-nocookie.com/embed/${id}` } : null;
    }
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
      const match = url.pathname.match(/^\/(?:video\/)?([0-9]+)(?:\/([a-zA-Z0-9]+))?\/?$/);
      if (!match) return null;
      const hash = url.searchParams.get("h") || match[2];
      return { kind: "vimeo", url: `https://player.vimeo.com/video/${match[1]}${hash && /^[a-zA-Z0-9]+$/.test(hash) ? `?h=${hash}` : ""}` };
    }
    return /\.(mp4|webm)$/i.test(url.pathname) ? { kind: "file", url: url.href } : null;
  } catch {
    return null;
  }
}
