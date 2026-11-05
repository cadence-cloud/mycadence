import { INLINE_PLAYABLE } from "@/lib/upload-rules";
import { formatDate } from "@/lib/time";
import { Badge } from "./ui";

export interface MediaRow {
  id: string;
  title: string;
  explanation: string | null;
  mimeType: string;
  category: string;
  exerciseName: string | null;
  capturedOn: string | null;
  createdAt: Date;
  visitDate?: string | null;
}

/** Inline display through the authorized /api/media route. Never a public URL. */
export function MediaTile({ m, footer }: { m: MediaRow; footer?: React.ReactNode }) {
  const src = `/api/media/${m.id}`;
  const inline = INLINE_PLAYABLE.has(m.mimeType);
  const isImage = m.mimeType.startsWith("image/");
  const isVideo = m.mimeType.startsWith("video/");
  const date = m.capturedOn ?? m.visitDate ?? null;
  return (
    <figure className="overflow-hidden rounded-2xl border border-sand-200 bg-white">
      {isImage && inline && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={m.title} loading="lazy" className="aspect-[4/3] w-full bg-sand-100 object-cover" />
      )}
      {isVideo && inline && (
        <video src={src} controls playsInline preload="metadata" className="aspect-video w-full bg-pine-950">
          Your browser can’t play this video. <a href={`${src}?download=1`}>Download it</a>.
        </video>
      )}
      {!inline && (isImage || isVideo) && (
        <div className="flex aspect-video items-center justify-center bg-sand-100 px-4 text-center text-sm text-muted">
          This format ({m.mimeType.split("/")[1].toUpperCase()}) may not play in your browser.
        </div>
      )}
      <figcaption className="space-y-1 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{m.title}</span>
          {m.category === "invoice" && <Badge tone="neutral">Invoice</Badge>}
          {m.category === "document" && <Badge tone="neutral">Document</Badge>}
          {m.category === "general_demo" && <Badge tone="blue">General demo</Badge>}
        </div>
        {(date || m.exerciseName) && (
          <p className="text-sm text-muted">
            {date && formatDate(date)}
            {date && m.exerciseName && " · "}
            {m.exerciseName}
          </p>
        )}
        {m.explanation && <p className="text-[15px]">{m.explanation}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {(!inline || m.mimeType === "application/pdf") && (
            <a href={`${src}?download=1`} className="btn-secondary btn-sm">Download</a>
          )}
          {m.mimeType === "application/pdf" && (
            <a href={src} target="_blank" rel="noopener" className="btn-ghost btn-sm">Open</a>
          )}
          {footer}
        </div>
      </figcaption>
    </figure>
  );
}
