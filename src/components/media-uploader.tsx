"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { classifyUpload } from "@/lib/upload-rules";

type Category = "patient_footage" | "document" | "invoice" | "general_demo";
type Job = {
  localId: string;
  file: File;
  title: string;
  status: "uploading" | "done" | "error" | "cancelled";
  progress: number;
  error?: string;
  mediaId?: string;
  xhr?: XMLHttpRequest;
};

export interface UploaderProps {
  patientId: string | null;
  visitId?: string | null;
  draftId?: string | null;
  exercises?: { key: string; name: string }[];
  defaultCategory?: Category;
  allowCategories?: Category[];
  onUploaded?: (m: { id: string; title: string; planItemKey: string | null; category: Category; mimeType: string }) => void;
  compact?: boolean;
}

const CATEGORY_LABEL: Record<Category, string> = {
  patient_footage: "Photo or video of the patient",
  document: "Document",
  invoice: "Invoice",
  general_demo: "General demonstration (no patient)",
};

export function MediaUploader({ patientId, visitId, draftId, exercises = [], defaultCategory = "patient_footage", allowCategories = ["patient_footage", "document", "invoice"], onUploaded, compact }: UploaderProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<Category>(defaultCategory);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [explanation, setExplanation] = useState("");
  const [itemKey, setItemKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const isDoc = category === "document" || category === "invoice";

  const update = (localId: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.localId === localId ? { ...j, ...patch } : j)));

  function pick(f: File | null) {
    setFormError(null);
    setFile(f);
    if (f) {
      const c = classifyUpload(f.type || "application/octet-stream", f.size, isDoc ? "document" : "media");
      if (!c.ok) setFormError(c.message);
      if (!title) setTitle(category === "invoice" ? "Invoice" : "");
    }
  }

  async function start(job: Job, meta: { explanation: string; planItemKey: string | null }) {
    update(job.localId, { status: "uploading", progress: 0, error: undefined });
    let mediaId = job.mediaId;
    try {
      if (!mediaId) {
        const res = await fetch("/api/media", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientId,
            visitId: visitId ?? null,
            draftId: draftId ?? null,
            planItemKey: meta.planItemKey,
            exerciseName: exercises.find((e) => e.key === meta.planItemKey)?.name ?? null,
            category,
            title: job.title,
            explanation: meta.explanation || null,
            mimeType: job.file.type,
            sizeBytes: job.file.size,
            capturedOn: null,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Upload could not start");
        mediaId = j.id as string;
        update(job.localId, { mediaId });
      }
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        update(job.localId, { xhr });
        xhr.open("PUT", `/api/media/${mediaId}/content`);
        xhr.setRequestHeader("content-type", job.file.type);
        xhr.upload.onprogress = (e) => e.lengthComputable && update(job.localId, { progress: Math.round((e.loaded / e.total) * 100) });
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(safeError(xhr.responseText))));
        xhr.onerror = () => reject(new Error("Network error. Check your connection and retry."));
        xhr.onabort = () => reject(new Error("cancelled"));
        xhr.send(job.file);
      });
      update(job.localId, { status: "done", progress: 100, xhr: undefined });
      onUploaded?.({ id: mediaId!, title: job.title, planItemKey: meta.planItemKey, category, mimeType: job.file.type });
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "cancelled") return;
      update(job.localId, { status: "error", error: msg, xhr: undefined });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setFormError("Choose a file first.");
    if (!title.trim()) return setFormError("Add a descriptive title, e.g. “Single-leg squat — side view”.");
    const c = classifyUpload(file.type || "application/octet-stream", file.size, isDoc ? "document" : "media");
    if (!c.ok) return setFormError(c.message);
    const job: Job = { localId: crypto.randomUUID(), file, title: title.trim(), status: "uploading", progress: 0 };
    setJobs((js) => [job, ...js]);
    const meta = { explanation, planItemKey: itemKey || null };
    setFile(null);
    setTitle("");
    setExplanation("");
    setItemKey("");
    if (fileRef.current) fileRef.current.value = "";
    void start(job, meta);
  }

  async function cancel(job: Job) {
    job.xhr?.abort();
    update(job.localId, { status: "cancelled", xhr: undefined });
    if (job.mediaId) await fetch(`/api/media/${job.mediaId}`, { method: "DELETE" });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-3">
        {allowCategories.length > 1 && (
          <fieldset>
            <legend className="label">What are you adding?</legend>
            <div className="flex flex-wrap gap-2">
              {allowCategories.map((c) => (
                <label key={c} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${category === c ? "border-pine-700 bg-pine-50 font-semibold" : "border-sand-300 bg-white"}`}>
                  <input type="radio" name="category" className="sr-only" checked={category === c} onChange={() => { setCategory(c); setFile(null); if (fileRef.current) fileRef.current.value = ""; }} />
                  {CATEGORY_LABEL[c]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label className="label" htmlFor="upload-file">File</label>
          <input
            ref={fileRef}
            id="upload-file"
            type="file"
            accept={isDoc ? "application/pdf,image/jpeg,image/png" : "image/*,video/*"}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-pine-900 file:px-4 file:font-semibold file:text-white"
          />
          <p className="hint">{isDoc ? "PDF, JPEG or PNG up to 20 MB." : "Photos up to 15 MB (JPEG, PNG, WebP, HEIC). Videos up to 250 MB (MP4, MOV, WebM)."}</p>
        </div>
        <div className={compact ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
          <div>
            <label className="label" htmlFor="upload-title">Title</label>
            <input id="upload-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isDoc ? "Invoice — Nov 3 visit" : "Single-leg squat — side view"} maxLength={200} />
          </div>
          {!isDoc && exercises.length > 0 && (
            <div>
              <label className="label" htmlFor="upload-ex">Related exercise (optional)</label>
              <select id="upload-ex" className="input" value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
                <option value="">None</option>
                {exercises.map((x) => (
                  <option key={x.key} value={x.key}>{x.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {!isDoc && (
          <div>
            <label className="label" htmlFor="upload-expl">What should the patient notice? (optional)</label>
            <textarea id="upload-expl" className="input min-h-20" value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={2000} />
          </div>
        )}
        {formError && <p role="alert" className="text-sm font-medium text-red-800">{formError}</p>}
        <button className="btn-secondary w-full sm:w-auto" disabled={!file || !!formError}>Upload</button>
      </form>

      {jobs.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.localId} className="rounded-xl border border-sand-200 bg-sand-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{j.title}</span>
                <span className="shrink-0 text-muted">
                  {j.status === "uploading" && `${j.progress}%`}
                  {j.status === "done" && "Uploaded"}
                  {j.status === "cancelled" && "Cancelled"}
                  {j.status === "error" && "Failed"}
                </span>
              </div>
              {j.status === "uploading" && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand-200" role="progressbar" aria-valuenow={j.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${j.title}`}>
                  <div className="h-full bg-pine-700 transition-[width]" style={{ width: `${j.progress}%` }} />
                </div>
              )}
              {j.error && <p className="mt-1 text-red-800">{j.error}</p>}
              <div className="mt-2 flex gap-2">
                {j.status === "uploading" && <button type="button" className="btn-secondary btn-sm" onClick={() => cancel(j)}>Cancel</button>}
                {j.status === "error" && (
                  <>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => start(j, { explanation: "", planItemKey: null })}>Retry</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => cancel(j)}>Discard</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function safeError(text: string) {
  try {
    return JSON.parse(text).error ?? "Upload failed";
  } catch {
    return "Upload failed";
  }
}
