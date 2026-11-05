import type { Db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { newId } from "@/lib/ids";

/**
 * Audit trail: actor, action, record ids. Never pass clinical free text
 * (exercise names, recaps, messages, symptoms) in `meta`.
 */
export async function audit(
  db: Db,
  e: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    patientId?: string | null;
    meta?: Record<string, string | number | boolean | null>;
  },
) {
  await db.insert(auditEvents).values({
    id: newId(),
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    patientId: e.patientId ?? null,
    meta: e.meta ?? null,
  });
}
