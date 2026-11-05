import { shownName } from "@/server/names";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { messageReads, messageThreads, messages, patients, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { audit } from "./audit";
import { careTeam } from "./authz";
import { notifyPatient, notifyUser } from "./notify";
import { threadFor } from "./messaging-thread";

export { threadFor };

export async function listMessages(db: Db, threadId: string) {
  return db
    .select({ id: messages.id, body: messages.body, createdAt: messages.createdAt, simulated: messages.simulated, senderId: messages.senderId, senderName: shownName, via: messages.via, senderRole: users.role, senderCredentials: users.credentials })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);
}

export async function markRead(db: Db, threadId: string, userId: string) {
  const now = new Date();
  await db
    .insert(messageReads)
    .values({ id: newId(), threadId, userId, lastReadAt: now })
    .onConflictDoUpdate({ target: [messageReads.threadId, messageReads.userId], set: { lastReadAt: now } });
}

/**
 * Send a message in a patient's thread. Caller must have authorized the sender
 * for this patient. Notifications go ONLY to the patient or their active care team.
 */
export async function sendMessage(db: Db, sender: { id: string; role: string }, patientId: string, body: string, opts: { simulated?: boolean; via?: "app" | "email" } = {}) {
  const text = body.trim();
  if (!text) throw new Error("Message is empty");
  if (text.length > 5000) throw new Error("Message is too long (5,000 characters max)");
  const thread = await threadFor(db, patientId);
  const id = newId();
  await db.insert(messages).values({ id, threadId: thread.id, senderId: sender.id, body: text, simulated: !!opts.simulated, via: opts.via ?? "app" });
  await markRead(db, thread.id, sender.id);
  await audit(db, { actorId: sender.id, action: "message.send", entityType: "message", entityId: id, patientId, meta: { via: opts.via ?? "app" } });
  if (sender.role === "patient") {
    for (const m of await careTeam(db, patientId)) await notifyUser(db, m.userId, "new_message", `/pt/patients/${patientId}?tab=messages`, { patientId });
  } else {
    await notifyPatient(db, patientId, "new_message");
  }
  return id;
}

/** Unread counts per patient thread for one user (messages from others after last read). */
export async function unreadByPatient(db: Db, userId: string, patientIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!patientIds.length) return out;
  const rows = await db
    .select({ patientId: messageThreads.patientId, n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
    .leftJoin(messageReads, and(eq(messageReads.threadId, messageThreads.id), eq(messageReads.userId, userId)))
    .where(and(inArray(messageThreads.patientId, patientIds), ne(messages.senderId, userId), sql`(${messageReads.lastReadAt} is null or ${messages.createdAt} > ${messageReads.lastReadAt})`))
    .groupBy(messageThreads.patientId);
  for (const r of rows) out.set(r.patientId, r.n);
  return out;
}

export async function latestPatientMessages(db: Db, userId: string, patientIds: string[], limit = 8) {
  if (!patientIds.length) return [];
  return db
    .select({ id: messages.id, patientId: messageThreads.patientId, firstName: patients.firstName, lastName: patients.lastName, createdAt: messages.createdAt, lastReadAt: messageReads.lastReadAt })
    .from(messages)
    .innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
    .innerJoin(patients, eq(patients.id, messageThreads.patientId))
    .innerJoin(users, eq(users.id, messages.senderId))
    .leftJoin(messageReads, and(eq(messageReads.threadId, messageThreads.id), eq(messageReads.userId, userId)))
    .where(and(inArray(messageThreads.patientId, patientIds), eq(users.role, "patient")))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}
