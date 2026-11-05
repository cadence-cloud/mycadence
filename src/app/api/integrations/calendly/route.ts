/**
 * Calendly webhook receiver (invitee.created / invitee.canceled).
 *
 * Set up: create a webhook subscription in Calendly pointing at
 *   https://<your-domain>/api/integrations/calendly
 * with a signing key, and put that key in CALENDLY_WEBHOOK_SIGNING_KEY.
 * Requests without a valid, recent signature are rejected.
 */
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { integrationEvents } from "@/db/schema";
import { newId } from "@/lib/ids";
import { upsertBooking } from "@/server/scheduling";

const TOLERANCE_SEC = 5 * 60;

function verify(raw: string, header: string | null, key: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!parts.t || !parts.v1 || !Number.isFinite(t)) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SEC) return false;
  const expected = createHmac("sha256", key).update(`${parts.t}.${raw}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface CalendlyPayload {
  event?: string;
  payload?: {
    uri?: string;
    email?: string;
    name?: string;
    status?: string;
    scheduled_event?: { name?: string; start_time?: string; end_time?: string; event_memberships?: { user_email?: string }[] };
  };
}

export async function POST(req: Request) {
  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  const db = await getDb();
  const log = (eventType: string, eventKey: string, outcome: "processed" | "ignored" | "rejected" | "error", detail?: string) =>
    db.insert(integrationEvents).values({ id: newId(), source: "calendly", eventType, eventKey, outcome, detail: detail ?? null });

  if (!key) return NextResponse.json({ error: "Calendly integration is not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verify(raw, req.headers.get("calendly-webhook-signature"), key)) {
    await log("unknown", "-", "rejected", "bad or missing signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let body: CalendlyPayload;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const type = body.event ?? "unknown";
  const p = body.payload;
  const ev = p?.scheduled_event;
  if ((type !== "invitee.created" && type !== "invitee.canceled") || !p?.uri || !p.email || !ev?.start_time) {
    await log(type, p?.uri ?? "-", "ignored", "unsupported event or missing fields");
    return NextResponse.json({ ok: true, ignored: true });
  }
  try {
    await upsertBooking(db, {
      source: "calendly",
      externalId: p.uri,
      status: type === "invitee.canceled" ? "canceled" : "scheduled",
      inviteeName: p.name ?? p.email,
      inviteeEmail: p.email,
      eventName: ev.name ?? null,
      startsAt: new Date(ev.start_time),
      endsAt: ev.end_time ? new Date(ev.end_time) : null,
      hostEmails: (ev.event_memberships ?? []).map((m) => m.user_email).filter((e): e is string => !!e),
    });
    await log(type, p.uri, "processed");
    return NextResponse.json({ ok: true });
  } catch {
    await log(type, p.uri, "error", "processing failed");
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
