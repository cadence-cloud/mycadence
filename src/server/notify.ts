/**
 * Notification events. Wording is always generic and links require sign-in.
 * No treatment details in subjects, previews, URLs, or logs.
 *
 * Status is honest: "simulated" (demo), "sent" (the email provider accepted it),
 * "failed", "not_sent" (no provider configured), or "throttled" (a notice for the
 * same thing went out in the last 15 minutes). Never "delivered".
 */
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notificationEvents, patients, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { GENERIC_SUBJECT, emailMode, inboundEnabled, replyAddress, sendEmail, threadReplyToken } from "./email";
import { threadFor } from "./messaging-thread";

export { GENERIC_SUBJECT };
const THROTTLE_MIN = 15;

export async function notifyUser(db: Db, userId: string, eventType: string, linkPath: string, opts: { patientId?: string } = {}) {
  const [u] = await db.select({ email: users.email, notifyByEmail: users.notifyByEmail, deactivatedAt: users.deactivatedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.deactivatedAt) return;
  const mode = emailMode();
  const recent = await db
    .select({ id: notificationEvents.id })
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.recipientUserId, userId),
        eq(notificationEvents.linkPath, linkPath),
        inArray(notificationEvents.status, ["sent", "simulated"]),
        gt(notificationEvents.createdAt, new Date(Date.now() - THROTTLE_MIN * 60_000)),
      ),
    )
    .orderBy(desc(notificationEvents.createdAt))
    .limit(1);
  const id = newId();
  const base = { id, recipientUserId: userId, channel: "email" as const, eventType, subject: GENERIC_SUBJECT, linkPath };
  if (!u.notifyByEmail) return;
  if (recent.length) {
    await db.insert(notificationEvents).values({ ...base, status: "throttled" });
    return;
  }
  if (mode === "simulated") {
    await db.insert(notificationEvents).values({ ...base, status: "simulated" });
    return;
  }
  if (mode === "none") {
    await db.insert(notificationEvents).values({ ...base, status: "not_sent" });
    return;
  }
  let replyTo: string | null = null;
  if (opts.patientId && inboundEnabled()) {
    const thread = await threadFor(db, opts.patientId);
    replyTo = replyAddress(await threadReplyToken(db, thread.id));
  }
  try {
    await sendEmail(u.email, { linkPath, replyTo });
    await db.insert(notificationEvents).values({ ...base, status: "sent" });
  } catch (e) {
    // Error class only; never the message body.
    await db.insert(notificationEvents).values({ ...base, status: "failed", error: (e as Error).name?.slice(0, 100) ?? "error" });
  }
}

export async function notifyPatient(db: Db, patientId: string, eventType: string) {
  const [p] = await db.select({ userId: patients.userId }).from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!p?.userId) return;
  const link = eventType === "new_message" ? "/me/messages" : "/me";
  await notifyUser(db, p.userId, eventType, link, { patientId });
}
