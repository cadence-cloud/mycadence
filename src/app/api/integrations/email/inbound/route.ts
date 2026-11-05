/**
 * Inbound email webhook. Point your email provider's inbound/parse webhook here:
 *   https://<your-domain>/api/integrations/email/inbound
 * Authenticate with INBOUND_EMAIL_SECRET as the `x-cadence-inbound-secret` header,
 * or as the password in HTTP Basic auth (for providers that only support URL credentials).
 *
 * Accepts JSON ({from,to,text} or Postmark-style {From,To,TextBody,StrippedTextReply})
 * and form posts (SendGrid/Mailgun-style: from, to|recipient, text|stripped-text|body-plain).
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { processInboundEmail } from "@/server/inbound-email";

function authorized(req: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return false;
  let given = req.headers.get("x-cadence-inbound-secret") ?? "";
  const auth = req.headers.get("authorization");
  if (!given && auth?.startsWith("Basic ")) given = Buffer.from(auth.slice(6), "base64").toString().split(":").slice(1).join(":");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.INBOUND_EMAIL_SECRET) return NextResponse.json({ error: "Inbound email is not configured" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ct = req.headers.get("content-type") ?? "";
  let from = "", to = "", text = "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    from = j.from ?? j.From ?? "";
    to = j.to ?? j.To ?? j.OriginalRecipient ?? "";
    text = j.StrippedTextReply || j.text || j.TextBody || "";
  } else {
    const f = await req.formData();
    const g = (k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
    from = g("from") || g("sender");
    to = g("to") || g("recipient");
    text = g("stripped-text") || g("text") || g("body-plain");
  }
  const db = await getDb();
  const r = await processInboundEmail(db, { from, to, text });
  // Always 200 for handled-but-rejected mail so providers don't retry forever.
  return NextResponse.json(r.ok ? { ok: true } : { ok: false, reason: r.reason });
}
