/**
 * Outbound email. Content is always generic: no treatment details in subject,
 * body, or URL — just "You have a new update from Cadence" and a sign-in link.
 *
 * Providers:
 *  - demo:  nothing is sent; rows are marked "simulated"
 *  - smtp:  any SMTP service (EMAIL_PROVIDER=smtp, SMTP_URL, EMAIL_FROM).
 *           Use a provider that will sign a BAA before real patients (see launch checklist).
 *  - none:  rows are recorded as "not_sent"
 *
 * Inbound replies: when EMAIL_REPLY_DOMAIN is set, the Reply-To address is
 * reply+<thread token>@<domain>, and the provider forwards replies to
 * /api/integrations/email/inbound, which adds them to the patient's thread.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { messageThreads } from "@/db/schema";
import { isDemo } from "@/lib/env";

export const GENERIC_SUBJECT = "You have a new update from Cadence";

export type EmailMode = "simulated" | "smtp" | "none";

export function emailMode(): EmailMode {
  if (isDemo()) return "simulated";
  if (process.env.EMAIL_PROVIDER === "smtp" && process.env.SMTP_URL && process.env.EMAIL_FROM) return "smtp";
  return "none";
}

export function inboundEnabled() {
  if (isDemo()) return true; // simulated in the demo
  return !!process.env.EMAIL_REPLY_DOMAIN && !!process.env.INBOUND_EMAIL_SECRET;
}

export function replyAddress(token: string) {
  const domain = process.env.EMAIL_REPLY_DOMAIN || "reply.example.invalid";
  return `reply+${token}@${domain}`;
}

export async function threadReplyToken(db: Db, threadId: string): Promise<string> {
  const [t] = await db.select({ token: messageThreads.replyToken }).from(messageThreads).where(eq(messageThreads.id, threadId)).limit(1);
  if (t?.token) return t.token;
  const token = randomBytes(12).toString("hex"); // 24 lowercase hex chars: safe in an email local part
  await db.update(messageThreads).set({ replyToken: token }).where(eq(messageThreads.id, threadId));
  return token;
}

export function buildEmail(opts: { linkPath: string; replyable: boolean }) {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const lines = [
    "You have a new update from Cadence.",
    "",
    `Sign in to view it: ${base}${opts.linkPath}`,
    "",
    ...(opts.replyable ? ["You can reply to this email to send a message to your care team. Your reply is added to your secure message thread in My Cadence.", ""] : []),
    "For your privacy, this email doesn't include details.",
    "",
    "Cadence Physical Therapy",
  ];
  return { subject: GENERIC_SUBJECT, text: lines.join("\n") };
}

let transport: { sendMail: (o: Record<string, unknown>) => Promise<unknown> } | null = null;
export async function sendEmail(to: string, opts: { linkPath: string; replyTo?: string | null }): Promise<void> {
  if (emailMode() !== "smtp") return;
  if (!transport) {
    const nodemailer = await import("nodemailer");
    transport = nodemailer.createTransport(process.env.SMTP_URL!);
  }
  const { subject, text } = buildEmail({ linkPath: opts.linkPath, replyable: !!opts.replyTo });
  await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, text, ...(opts.replyTo ? { replyTo: opts.replyTo } : {}) });
}
