"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

type Action = (prev: unknown, form: FormData) => Promise<{ error?: string; ok?: boolean }>;

export function SubmitButton({ children, pendingText, className = "btn-primary" }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}

export function MessageForm({ action, hidden, placeholder = "Write a message", label = "Message" }: { action: Action; hidden: Record<string, string>; placeholder?: string; label?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-2">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor="msg-body" className="sr-only">{label}</label>
      <textarea id="msg-body" name="body" required maxLength={5000} placeholder={placeholder} className="input min-h-24" />
      {state?.error && <p role="alert" className="text-sm text-red-800">{state.error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending}>{pending ? "Sending…" : "Send"}</button>
      </div>
    </form>
  );
}

export function ActionForm({ action, children, className = "space-y-3", resetOnOk = true, okText = "Saved." }: { action: Action; children: React.ReactNode; className?: string; resetOnOk?: boolean; okText?: string }) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <p role="alert" className="text-sm font-medium text-red-800">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm font-medium text-pine-800">{okText}</p>}
    </form>
  );
}
