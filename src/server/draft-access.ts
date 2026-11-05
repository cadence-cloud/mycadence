import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { planDrafts } from "@/db/schema";
import { requireApiUser } from "./session";
import { canAccessPatient } from "./authz";

/** Loads a draft only if the current user is a PT on that patient's active care team. */
export async function draftForPt(draftId: string) {
  const user = await requireApiUser(["pt"]);
  if (!user) return null;
  const db = await getDb();
  const [d] = await db.select().from(planDrafts).where(eq(planDrafts.id, draftId)).limit(1);
  if (!d || !(await canAccessPatient(db, user, d.patientId))) return null;
  return { user, db, draft: d };
}
