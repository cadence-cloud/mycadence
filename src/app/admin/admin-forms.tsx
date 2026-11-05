"use client";
import { useActionState } from "react";

type R = { error?: string; ok?: boolean; tempPassword?: string };

/** Form wrapper that shows a one-time temporary password when an action returns one. */
export function AdminForm({ action, children, className = "space-y-3", okText = "Saved." }: { action: (p: unknown, f: FormData) => Promise<R>; children: React.ReactNode; className?: string; okText?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {state?.error && <p role="alert" className="text-sm font-medium text-red-800">{state.error}</p>}
      {state?.ok && !state.tempPassword && <p role="status" className="text-sm font-medium text-pine-800">{okText}</p>}
      {state?.tempPassword && (
        <div role="status" className="rounded-xl border border-lime-300 bg-lime-200/40 p-3 text-sm">
          <p className="font-semibold">{okText} Temporary password (shown once):</p>
          <code className="mt-1 block select-all rounded bg-white px-2 py-1 text-base">{state.tempPassword}</code>
          <p className="mt-1 text-muted">Share it through a secure channel. Production needs an invite / reset-link flow instead (see launch checklist).</p>
        </div>
      )}
    </form>
  );
}
