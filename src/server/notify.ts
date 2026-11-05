/**
 * Notification events. Wording is always generic and links require sign-in.
 * No treatment details in subjects, previews, URLs, or logs.
 *
 * Delivery status is honest:
 *  - demo: "simulated" (shown in the demo outbox, nothing leaves the server)
 *  - live without a configured provider: "not_sent"
 * We never record "delivered" — inbox delivery cannot be observed.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notificationEvents, patients } from "@/db/schema";
import { newId } from "@/lib/ids";
import { isDemo } from "@/lib/env";

export const GENERIC_SUBJECT = "You have a new update from Cadence";

function status() {
  if (isDemo()) return "simulated" as const;
  return process.env.EMAIL_PROVIDER ? ("queued" as const) : ("not_sent" as const);
}

export async function notifyUser(db: Db, userId: string, eventType: string, linkPath: string) {
  await db.insert(notificationEvents).values({ id: newId(), recipientUserId: userId, channel: "email", eventType, subject: GENERIC_SUBJECT, linkPath, status: status() });
}

export async function notifyPatient(db: Db, patientId: string, eventType: string) {
  const [p] = await db.select({ userId: patients.userId }).from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!p?.userId) return;
  const link = eventType === "new_message" ? "/me/messages" : "/me";
  await notifyUser(db, p.userId, eventType, link);
}
