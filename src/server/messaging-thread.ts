import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { messageThreads } from "@/db/schema";
import { newId } from "@/lib/ids";

export async function threadFor(db: Db, patientId: string) {
  const [t] = await db.select().from(messageThreads).where(eq(messageThreads.patientId, patientId)).limit(1);
  if (t) return t;
  await db.insert(messageThreads).values({ id: newId(), patientId }).onConflictDoNothing();
  const [t2] = await db.select().from(messageThreads).where(eq(messageThreads.patientId, patientId)).limit(1);
  return t2;
}
