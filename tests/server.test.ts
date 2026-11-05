import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { canAccessPatient, type AuthUser } from "@/server/authz";
import { createDraft, ensureVisit, publishDraft, saveDraft } from "@/server/plans";
import { addDays, localDate } from "@/lib/time";

process.env.APP_ENV = "demo";
process.env.STORAGE_DIR = path.join(os.tmpdir(), `cadence-test-${Date.now()}`);

let db: Db;
const u = async (email: string): Promise<AuthUser> => {
  const [r] = await db.select().from(s.users).where(eq(s.users.email, email));
  return { id: r.id, name: r.name, email: r.email, role: r.role, credentials: r.credentials, isDemo: true };
};
const patient = async (first: string) => (await db.select().from(s.patients).where(eq(s.patients.firstName, first)))[0];

beforeAll(async () => {
  db = await createDb({ dataDir: "memory://" });
  await seed(db);
}, 60000);

describe("authorization", () => {
  it("PTs only access assigned patients; covering counts", async () => {
    const megan = await u("megan@demo.cadence.test");
    const giana = await u("giana@demo.cadence.test");
    const alex = await patient("Alex");
    const sam = await patient("Sam");
    expect(await canAccessPatient(db, megan, alex.id)).toBe(true);
    expect(await canAccessPatient(db, giana, alex.id)).toBe(false);
    expect(await canAccessPatient(db, giana, sam.id)).toBe(true);
  });
  it("patients only access themselves; admins get no clinical access", async () => {
    const alexUser = await u("alex@demo.cadence.test");
    const admin = await u("michael@demo.cadence.test");
    const alex = await patient("Alex");
    const jordan = await patient("Jordan");
    expect(await canAccessPatient(db, alexUser, alex.id)).toBe(true);
    expect(await canAccessPatient(db, alexUser, jordan.id)).toBe(false);
    expect(await canAccessPatient(db, admin, alex.id, "clinical")).toBe(false);
    expect(await canAccessPatient(db, admin, alex.id, "operational")).toBe(true);
  });
  it("ending an assignment removes access", async () => {
    const giana = await u("giana@demo.cadence.test");
    const sam = await patient("Sam");
    await db.update(s.careAssignments).set({ endedAt: new Date() }).where(eq(s.careAssignments.staffUserId, giana.id));
    expect(await canAccessPatient(db, giana, sam.id)).toBe(false);
  });
});

describe("visit updates", () => {
  it("re-opening a visit date never creates a second visit", async () => {
    const megan = await u("megan@demo.cadence.test");
    const alex = await patient("Alex");
    const before = (await db.select().from(s.visits).where(eq(s.visits.patientId, alex.id))).length;
    const d = addDays(localDate(), -2);
    const a = await ensureVisit(db, megan.id, alex.id, d, megan.id);
    const b = await ensureVisit(db, megan.id, alex.id, d, megan.id);
    expect(a.visit.id).toBe(b.visit.id);
    expect((await db.select().from(s.visits).where(eq(s.visits.patientId, alex.id))).length).toBe(before);
  });

  it("publishing twice returns the same version; stale revisions conflict; history kept", async () => {
    const megan = await u("megan@demo.cadence.test");
    const alex = await patient("Alex");
    const { visit } = await ensureVisit(db, megan.id, alex.id, localDate(), megan.id);
    const draft = await createDraft(db, megan.id, alex.id, visit.id, { kind: "current_plan" });
    // reopening returns the same open draft
    expect((await createDraft(db, megan.id, alex.id, visit.id, { kind: "current_plan" })).id).toBe(draft.id);
    const saved = await saveDraft(db, megan.id, draft.id, draft.revision, { ...draft.content, recap: "Test recap" });
    expect(saved.ok).toBe(true);
    const conflict = await saveDraft(db, megan.id, draft.id, draft.revision, draft.content);
    expect(conflict.ok).toBe(false);
    const rev = saved.ok ? saved.revision : 0;
    const [p1, p2] = await Promise.all([publishDraft(db, megan.id, draft.id, { expectedRevision: rev }), publishDraft(db, megan.id, draft.id, { expectedRevision: rev })]);
    expect(p1.ok && p2.ok).toBe(true);
    if (p1.ok && p2.ok) expect(p1.versionId).toBe(p2.versionId);
    const versions = await db.select().from(s.planVersions).where(eq(s.planVersions.patientId, alex.id));
    expect(versions.map((v) => v.versionNumber).sort()).toEqual([1, 2, 3]);
  });

  it("template edits never reach an existing plan", async () => {
    const megan = await u("megan@demo.cadence.test");
    const priya = await patient("Priya");
    const [t] = await db.select().from(s.planTemplates).limit(1);
    const d = await createDraft(db, megan.id, priya.id, null, { kind: "template", templateId: t.id });
    await db.update(s.planTemplates).set({ content: { ...t.content, items: [] } }).where(eq(s.planTemplates.id, t.id));
    const [again] = await db.select().from(s.planDrafts).where(eq(s.planDrafts.id, d.id));
    expect(again.content.items.length).toBe(t.content.items.length);
  });
});

import { appointments } from "@/db/schema";
import { cancelAppointment, materializeVisits, upsertBooking } from "@/server/scheduling";
import { processInboundEmail } from "@/server/inbound-email";
import { replyAddress, threadReplyToken } from "@/server/email";
import { threadFor } from "@/server/messaging";

describe("scheduling sync", () => {
  it("matches by email, creates a visit when the time passes, and is idempotent", async () => {
    const jordan = await patient("Jordan");
    const before = (await db.select().from(s.visits).where(eq(s.visits.patientId, jordan.id))).length;
    const start = new Date(Date.now() - 30 * 60_000);
    const input = { source: "calendly" as const, externalId: "https://api.calendly.com/x/invitees/T1", status: "scheduled" as const, inviteeName: "Jordan Lee", inviteeEmail: "JORDAN@demo.cadence.test", startsAt: start, hostEmails: ["giana@demo.cadence.test"] };
    const a = await upsertBooking(db, input);
    const b = await upsertBooking(db, input);
    expect(a.id).toBe(b.id);
    await materializeVisits(db);
    const [appt] = await db.select().from(appointments).where(eq(appointments.id, a.id));
    expect(appt.patientId).toBe(jordan.id);
    expect(appt.visitId).toBeTruthy();
    const after = await db.select().from(s.visits).where(eq(s.visits.patientId, jordan.id));
    expect(after.length).toBeLessThanOrEqual(before + 1);
    // no-show removes the empty auto-created visit
    const r = await cancelAppointment(db, null, a.id, "no_show");
    expect(r.ok).toBe(true);
    expect((await db.select().from(s.visits).where(eq(s.visits.id, appt.visitId!))).length).toBe(0);
  });
  it("unknown email waits for an admin", async () => {
    const r = await upsertBooking(db, { source: "calendly", externalId: "U2", status: "scheduled", inviteeName: "New Person", inviteeEmail: "new.person@example.com", startsAt: new Date(Date.now() + 86400_000) });
    const [appt] = await db.select().from(appointments).where(eq(appointments.id, r.id));
    expect(appt.patientId).toBeNull();
  });
});

describe("inbound email", () => {
  it("accepts replies only from the thread's patient or care team", async () => {
    const alex = await patient("Alex");
    const thread = await threadFor(db, alex.id);
    const to = replyAddress(await threadReplyToken(db, thread.id));
    expect((await processInboundEmail(db, { from: "Alex <alex@demo.cadence.test>", to, text: "Works for me.\n\nOn Mon, Cadence wrote:\n> hi" })).ok).toBe(true);
    const last = (await db.select().from(s.messages).where(eq(s.messages.threadId, thread.id))).at(-1)!;
    expect(last.body).toBe("Works for me.");
    expect(last.via).toBe("email");
    expect((await processInboundEmail(db, { from: "jordan@demo.cadence.test", to, text: "hi" })).ok).toBe(false);
  });
});

import { addExercisesToPatient, visibleExercises } from "@/server/library";
describe("libraries", () => {
  it("personal libraries are private; shared is visible to all PTs", async () => {
    const megan = await u("megan@demo.cadence.test");
    const giana = await u("giana@demo.cadence.test");
    const mine = await visibleExercises(db, megan.id);
    const hers = await visibleExercises(db, giana.id);
    expect(mine.some((e) => e.name === "Hip airplane")).toBe(true);
    expect(hers.some((e) => e.name === "Hip airplane")).toBe(false);
    expect(hers.some((e) => e.name === "Toe yoga")).toBe(true);
  });
  it("adds library exercises to the patient's draft without dosage and without duplicates", async () => {
    const megan = await u("megan@demo.cadence.test");
    const giana = await u("giana@demo.cadence.test");
    const sam = await patient("Sam");
    const lib = await visibleExercises(db, megan.id);
    const pick = lib.filter((e) => e.name === "Hip airplane" || e.name === "Clamshells").map((e) => e.id);
    const r1 = await addExercisesToPatient(db, megan.id, sam.id, pick);
    expect(r1.added).toBe(2);
    const r2 = await addExercisesToPatient(db, megan.id, sam.id, pick);
    expect(r2.draftId).toBe(r1.draftId);
    expect(r2.added).toBe(0);
    const [d] = await db.select().from(s.planDrafts).where(eq(s.planDrafts.id, r1.draftId));
    const added = d.content.items.find((i) => i.name === "Hip airplane")!;
    expect(added.dosage).toEqual({});
    // Giana can't add Meg's personal exercise
    const gLib = lib.filter((e) => e.name === "Hip airplane").map((e) => e.id);
    await expect(addExercisesToPatient(db, giana.id, sam.id, gLib)).rejects.toThrow();
  });
});
