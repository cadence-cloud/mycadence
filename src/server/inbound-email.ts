/**
 * Inbound email replies -> message thread.
 * The reply address carries an opaque thread token; the sender's address must
 * belong to that thread's patient or an active care-team member. Anything else
 * is rejected and logged without content.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrationEvents, messageThreads, patients, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { addressOf, replyTokenFrom, stripQuoted } from "@/lib/email-reply";
import { careTeam } from "./authz";
import { sendMessage } from "./messaging";

export type InboundResult = { ok: true; messageId: string } | { ok: false; reason: string };

export async function processInboundEmail(db: Db, mail: { from: string; to: string; text: string }): Promise<InboundResult> {
  const log = (outcome: "processed" | "rejected" | "ignored", key: string, detail: string) =>
    db.insert(integrationEvents).values({ id: newId(), source: "email", eventType: "inbound_reply", eventKey: key, outcome, detail });
  const token = replyTokenFrom(mail.to);
  if (!token) {
    await log("ignored", "-", "no reply token in recipient");
    return { ok: false, reason: "No reply address token." };
  }
  const [thread] = await db.select().from(messageThreads).where(eq(messageThreads.replyToken, token)).limit(1);
  if (!thread) {
    await log("rejected", token.slice(0, 6), "unknown token");
    return { ok: false, reason: "Unknown reply address." };
  }
  const from = addressOf(mail.from);
  const [p] = await db.select({ userId: patients.userId }).from(patients).where(eq(patients.id, thread.patientId)).limit(1);
  let sender: { id: string; role: string } | null = null;
  if (p?.userId) {
    const [pu] = await db.select({ id: users.id, role: users.role }).from(users).where(and(eq(users.id, p.userId), sql`lower(${users.email}) = ${from}`, isNull(users.deactivatedAt))).limit(1);
    if (pu) sender = pu;
  }
  if (!sender) {
    const staff = (await careTeam(db, thread.patientId)).find((t) => t.email.toLowerCase() === from);
    if (staff) sender = { id: staff.userId, role: "pt" };
  }
  if (!sender) {
    await log("rejected", token.slice(0, 6), "sender not on this thread");
    return { ok: false, reason: "Sender isn't part of this conversation." };
  }
  const body = stripQuoted(mail.text);
  if (!body) {
    await log("ignored", token.slice(0, 6), "empty after removing quoted text");
    return { ok: false, reason: "The reply was empty." };
  }
  const messageId = await sendMessage(db, sender, thread.patientId, body.slice(0, 5000), { via: "email" });
  await log("processed", token.slice(0, 6), "added to thread");
  return { ok: true, messageId };
}
