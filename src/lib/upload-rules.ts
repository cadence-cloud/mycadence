/** Shared (client + server) upload limits. The server re-checks everything. */
export const UPLOAD_RULES = {
  photo: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], maxBytes: 15 * 1024 * 1024 },
  video: { types: ["video/mp4", "video/quicktime", "video/webm"], maxBytes: 250 * 1024 * 1024 },
  document: { types: ["application/pdf", "image/jpeg", "image/png"], maxBytes: 20 * 1024 * 1024 },
} as const;

/** Formats most browsers can display inline. Others are offered as a download. */
export const INLINE_PLAYABLE = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "application/pdf"]);

export function classifyUpload(mime: string, sizeBytes: number, intent: "media" | "document"): { ok: true; kind: "photo" | "video" | "document" } | { ok: false; message: string } {
  if (intent === "document") {
    if (!(UPLOAD_RULES.document.types as readonly string[]).includes(mime)) return { ok: false, message: "Documents must be PDF, JPEG, or PNG." };
    if (sizeBytes > UPLOAD_RULES.document.maxBytes) return { ok: false, message: "Documents can be up to 20 MB." };
    return { ok: true, kind: "document" };
  }
  for (const kind of ["photo", "video"] as const) {
    if ((UPLOAD_RULES[kind].types as readonly string[]).includes(mime)) {
      if (sizeBytes > UPLOAD_RULES[kind].maxBytes) return { ok: false, message: kind === "photo" ? "Photos can be up to 15 MB." : "Videos can be up to 250 MB. Try trimming the clip." };
      return { ok: true, kind };
    }
  }
  return { ok: false, message: "Unsupported format. Use JPEG, PNG, WebP or HEIC photos, or MP4, MOV or WebM video." };
}

