/**
 * Demo seed — FICTIONAL people and clinical content only.
 * Refuses to run unless APP_ENV=demo. Staff names are the real Cadence team
 * (as provided) attached to fictional demo accounts.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "./client";
import * as s from "./schema";
import { newId } from "@/lib/ids";
import { addDays, clinicDateTime, localDate } from "@/lib/time";
import { hashPassword } from "@/server/passwords";
import { createDraft, ensureVisit, publishDraft, saveDraft } from "@/server/plans";
import { sendMessage, threadFor, markRead } from "@/server/messaging";
import type { PlanContent, PlanItem } from "@/lib/plan-types";
import { placeholderPng, demoInvoicePdf } from "./demo-files";

export const DEMO_PASSWORD = "cadence-demo";

async function main() {
  if ((process.env.APP_ENV ?? "demo") !== "demo") throw new Error("Refusing to seed: APP_ENV is not 'demo'.");
  if (process.env.DATABASE_URL && process.env.ALLOW_DEMO_SEED_ON_DATABASE_URL !== "true") throw new Error("Refusing to seed a DATABASE_URL database without ALLOW_DEMO_SEED_ON_DATABASE_URL=true.");
  const db = await createDb({ migrate: true });
  const existing = await db.select().from(s.users).limit(1);
  if (existing.length) {
    console.log("Database already seeded. Run `npm run db:reset` to start over.");
    process.exit(0);
  }
  await seed(db);
  console.log(`Seeded demo data. Demo password for every account: ${DEMO_PASSWORD}`);
  process.exit(0);
}

export async function seed(db: Db) {
  const today = localDate();
  const d = (n: number) => addDays(today, n);
  const pw = await hashPassword(DEMO_PASSWORD);

  // ---- Staff -------------------------------------------------------------
  const mkUser = async (name: string, email: string, role: "admin" | "pt" | "patient", credentials: string | null = null, displayName: string | null = null) => {
    const id = newId();
    await db.insert(s.users).values({ id, name, displayName, email, role, credentials, passwordHash: pw, isDemo: true });
    return id;
  };
  const michael = await mkUser("Michael Pappalardo", "michael@demo.cadence.test", "admin");
  const megan = await mkUser("Megan Pappalardo", "megan@demo.cadence.test", "pt", "DPT", "Dr. Meg");
  const giana = await mkUser("Giana", "giana@demo.cadence.test", "pt", "DPT", "Dr. Giana");

  // ---- Measures -----------------------------------------------------------
  const defs = {
    run: newId(),
    confidence: newId(),
    heelRaise: newId(),
    balance: newId(),
  };
  await db.insert(s.measureDefinitions).values([
    { id: defs.run, key: "run_tolerated", name: "Running duration tolerated", unit: "min", source: "pt", definition: "Longest continuous run in the past week that stayed within the symptom limits agreed with your PT. Recorded by your PT at a visit.", minValue: "0", maxValue: "600" },
    { id: defs.confidence, key: "run_confidence", name: "Running confidence", unit: "0–10", source: "patient", definition: "How confident you feel doing your current running plan. 0 = not at all confident, 10 = completely confident. Self-reported.", minValue: "0", maxValue: "10" },
    { id: defs.heelRaise, key: "sl_heel_raise", name: "Single-leg heel raises", unit: "reps", source: "pt", definition: "Consecutive full-range single-leg heel raises on the affected side before fatigue or form loss. Tested in clinic.", minValue: "0", maxValue: "100" },
    { id: defs.balance, key: "sl_balance", name: "Single-leg balance", unit: "sec", source: "pt", definition: "Eyes-open single-leg stance on a firm surface, affected side, best of three attempts. Tested in clinic.", minValue: "0", maxValue: "300" },
  ]);

  // ---- Exercise library ----------------------------------------------------
  const lib: Record<string, string> = {};
  const libRows: [string, string, string][] = [
    ["Toe yoga", "Alternate lifting the big toe while the small toes stay down, then the reverse.", "Foot"],
    ["Arch domes", "Shorten the foot by lifting the arch without curling the toes.", "Foot"],
    ["Heel raises with toes out and in", "Double-leg heel raises with feet turned out, then turned in.", "Calf"],
    ["Single-leg heel raise with twist", "Single-leg heel raise, rotating slightly at the top.", "Calf"],
    ["Relevé walks", "Walk on the balls of the feet with heels high.", "Calf"],
    ["Rows", "Band or cable row.", "Upper body"],
    ["Side-lying hip routine", "Series of side-lying hip strengthening movements.", "Hip"],
    ["Single-leg bridge", "Bridge on one leg, hips level.", "Hip"],
    ["Clamshells", "Side-lying, knees bent, open the top knee.", "Hip"],
    ["Copenhagen plank", "Side plank with the top leg supported on a bench.", "Hip"],
    ["Step-downs", "Slow lowering from a step, knee tracking over the foot.", "Knee"],
    ["Split squat", "Stationary lunge position, lower straight down.", "Knee"],
    ["Wall sit", "Back against wall, knees bent.", "Knee"],
    ["Single-leg Romanian deadlift", "Hinge on one leg with a long spine.", "Hip"],
    ["Ankle alphabet", "Trace letters with the foot to move the ankle in all directions.", "Ankle"],
    ["Single-leg balance", "Stand on one leg; progress surface or eyes as directed.", "Ankle"],
    ["Banded ankle eversion", "Turn the foot outward against a band.", "Ankle"],
    ["Pogo hops", "Small, quick, stiff-ankle hops.", "Plyometric"],
    ["Dead bug", "On back, extend opposite arm and leg while keeping the low back steady.", "Core"],
    ["Side plank", "Forearm side plank, body in a straight line.", "Core"],
  ];
  for (const [name, description, region] of libRows) {
    const id = newId();
    lib[name] = id;
    await db.insert(s.exercises).values({ id, name, description, bodyRegion: region, createdBy: megan });
  }
  const item = (name: string, extra: Partial<PlanItem> = {}): PlanItem => ({
    key: newId(),
    exerciseId: lib[name] ?? null,
    name,
    description: libRows.find((r) => r[0] === name)?.[1] ?? null,
    dosage: {},
    frequency: null,
    scheduleDays: null,
    cues: null,
    circuit: null,
    patientMediaId: null,
    isNew: false,
    ...extra,
  });

  // ---- Templates ------------------------------------------------------------
  const tplContent = (items: PlanItem[]): PlanContent => ({ recap: "", runningGuidance: "", nextMilestone: "", reassessNext: "", links: [], items });
  await db.insert(s.planTemplates).values([
    {
      id: newId(),
      name: "Foot & calf foundation",
      description: "Starting point for plantar fascia and foot-intrinsic work.",
      createdBy: megan,
      content: tplContent([
        item("Toe yoga", { dosage: { sets: 3, durationSec: 60 } }),
        item("Arch domes", { dosage: { sets: 5, holdSec: 20 } }),
        item("Relevé walks", { dosage: { sets: 3, reps: 12, repsUnit: "steps", note: "each direction" } }),
        item("Heel raises with toes out and in", { dosage: { sets: 3, reps: 12 } }),
      ]),
    },
    {
      id: newId(),
      name: "Hip stability circuit",
      description: "Circuit for runners with hip drop or knee pain.",
      createdBy: giana,
      content: tplContent([
        item("Clamshells", { circuit: "Circuit A", dosage: { sets: 2, reps: 15, perSide: true } }),
        item("Single-leg bridge", { circuit: "Circuit A", dosage: { sets: 3, reps: 10, perSide: true } }),
        item("Side plank", { circuit: "Circuit A", dosage: { sets: 3, holdSec: 30, perSide: true } }),
        item("Step-downs", { circuit: "Circuit B", dosage: { sets: 3, reps: 8, perSide: true } }),
      ]),
    },
  ]);

  // ---- Patients --------------------------------------------------------------
  const mkPatient = async (first: string, last: string, sport: string, team: [string, "primary" | "covering"][]) => {
    const userId = await mkUser(`${first} ${last}`, `${first.toLowerCase()}@demo.cadence.test`, "patient");
    const id = newId();
    await db.insert(s.patients).values({ id, userId, firstName: first, lastName: last, email: `${first.toLowerCase()}@demo.cadence.test`, sport, isDemo: true });
    for (const [staff, role] of team) await db.insert(s.careAssignments).values({ id: newId(), patientId: id, staffUserId: staff, role, createdBy: michael, startedAt: new Date(Date.now() - 40 * 86400_000) });
    await threadFor(db, id);
    return { id, userId };
  };
  const alex = await mkPatient("Alex", "Morgan", "Road running · half marathon", [[megan, "primary"]]);
  const jordan = await mkPatient("Jordan", "Lee", "Marathon", [[giana, "primary"]]);
  const sam = await mkPatient("Sam", "Rivera", "Trail ultramarathon", [[megan, "primary"], [giana, "covering"]]);
  const taylor = await mkPatient("Taylor", "Brooks", "High school cross country", [[giana, "primary"]]);
  const priya = await mkPatient("Priya", "Shah", "Triathlon", [[megan, "primary"]]);

  const goal = (patientId: string, by: string, text: string, targetEvent: string | null, targetDate: string | null) => db.insert(s.goals).values({ id: newId(), patientId, text, targetEvent, targetDate, createdBy: by });
  await goal(alex.id, alex.userId, "Run my spring half marathon without arch pain the next morning.", "Spring half marathon", d(160));
  await goal(alex.id, alex.userId, "Get back to running with my Saturday group.", null, null);
  await goal(jordan.id, jordan.userId, "Train through a full marathon block without my knee flaring up on long runs.", "Fall marathon", d(300));
  await goal(sam.id, sam.userId, "Trust my ankle on technical downhill trail again.", "50K trail race", d(220));
  await goal(taylor.id, taylor.userId, "Be ready for winter track practice.", null, null);
  await goal(priya.id, priya.userId, "Run off the bike without hip tightness.", "Olympic-distance triathlon", d(240));

  // Helper: publish a visit update through the real service so history is realistic.
  const publish = async (actor: string, patientId: string, visitDate: string, content: PlanContent) => {
    const { visit } = await ensureVisit(db, actor, patientId, visitDate, actor);
    const draft = await createDraft(db, actor, patientId, visit.id, { kind: "blank" });
    const saved = await saveDraft(db, actor, draft.id, draft.revision, content);
    if (!saved.ok) throw new Error("seed save failed");
    const res = await publishDraft(db, actor, draft.id, { expectedRevision: saved.revision });
    if (!res.ok) throw new Error("seed publish failed: " + JSON.stringify(res));
    // Back-date published time to the visit date (noon ET) for a believable timeline.
    await db.update(s.planVersions).set({ publishedAt: new Date(`${visitDate}T16:00:00Z`) }).where(eq(s.planVersions.id, res.versionId));
    return { visitId: visit.id, versionId: res.versionId };
  };

  // ---- Alex Morgan (Megan) — foot/arch, no structured schedule -> "Current plan"
  const toe = item("Toe yoga", { dosage: { sets: 3, durationSec: 60 } });
  const dome = item("Arch domes", { dosage: { sets: 5, holdSec: 20 }, cues: "In single-leg stand." });
  const releve = item("Relevé walks", { dosage: { sets: 3, reps: 12, repsUnit: "steps", note: "each direction" } });
  const hip = item("Side-lying hip routine");
  const v1 = await publish(megan, alex.id, d(-23), {
    recap: "Great to meet you, Alex. Your arch and heel symptoms look load-related, and your foot strength is the main thing we're building first.",
    items: [toe, { ...dome, cues: "Start seated, then standing." }, hip],
    runningGuidance: "Hold running for now. Walk or bike on any day you'd normally run.",
    nextMilestone: "Ten minutes of walk-run intervals with no arch pain the next morning.",
    reassessNext: "Recheck single-leg heel raises and balance.",
    links: [],
  });
  // A visit with no plan change: counted as a visit, no new plan version.
  await ensureVisit(db, megan, alex.id, d(-16), megan);
  const rows = item("Rows", { dosage: { sets: 3, reps: 15 }, cues: "Squeeze shoulder blades back and together.", isNew: true });
  // Strength circuits live in the plan (this replaces the old Google Doc).
  const circuit = [
    item("Single-leg Romanian deadlift", { circuit: "Strength circuit", dosage: { sets: 3, reps: 8, perSide: true }, frequency: "2x/week", isNew: true }),
    item("Split squat", { circuit: "Strength circuit", dosage: { sets: 3, reps: 10, perSide: true }, frequency: "2x/week", isNew: true }),
    item("Side plank", { circuit: "Strength circuit", dosage: { sets: 3, holdSec: 30, perSide: true }, frequency: "2x/week", isNew: true }),
  ];
  const v2 = await publish(megan, alex.id, d(-9), {
    recap: "Arch domes look much better in standing. We added relevé walks and rows, and you're cleared by me to start easy runs as below.",
    items: [toe, dome, { ...releve, isNew: true }, rows, hip, ...circuit],
    runningGuidance: "Run every other day, 15–20 minutes at an easy pace. Strength training or cross-training on the other days.",
    nextMilestone: "Run 20 minutes continuously with no arch pain the next morning.",
    reassessNext: "Recheck heel raises and how the easy runs are feeling.",
    links: [],
  });
  // Most recent visit (2 days ago) exists but its update hasn't been written yet —
  // the demo "Paste existing instructions" flow uses the sample email here.
  await ensureVisit(db, megan, alex.id, d(-2), megan);

  // Completion entries on v2
  const v2Assign = await db.select().from(s.exerciseAssignments).where(eq(s.exerciseAssignments.planVersionId, v2.versionId));
  const statuses = ["completed", "completed", "partial", "completed", "skipped", "completed"] as const;
  for (let i = 0; i < 6; i++) {
    for (const a of v2Assign.slice(0, 4)) {
      const st = a.name === "Rows" && i === 2 ? "skipped" : statuses[i];
      await db.insert(s.completionEntries).values({ id: newId(), patientId: alex.id, assignmentId: a.id, planVersionId: v2.versionId, sessionDate: d(-8 + i), status: st, comment: st === "partial" && a.name === "Arch domes" ? "Lost the arch on the last two holds." : null });
    }
  }
  const ci = (v: Partial<typeof s.checkIns.$inferInsert> & { patientId: string; activityDate: string; activityType: string; durationMin: number; duringFeel: string }) => db.insert(s.checkIns).values({ id: newId(), ...v });
  await ci({ patientId: alex.id, planVersionId: v2.versionId, activityDate: d(-7), activityType: "Run", durationMin: 15, distance: "1.6", distanceUnit: "mi", duringFeel: "Felt good", afterSymptoms: "Nothing notable", nextMorning: "A little arch stiffness for the first few steps, gone in a minute.", nextMorningAt: new Date(Date.now() - 6 * 86400_000), reviewStatus: "reviewed", reviewedBy: megan, reviewedAt: new Date(Date.now() - 6 * 86400_000) });
  await ci({ patientId: alex.id, planVersionId: v2.versionId, activityDate: d(-5), activityType: "Run", durationMin: 18, distance: "2", distanceUnit: "mi", duringFeel: "Some discomfort", duringNote: "Arch ache around minute 12, stayed mild.", afterSymptoms: "Mild ache in the arch", nextMorning: "Felt normal.", nextMorningAt: new Date(Date.now() - 4 * 86400_000) });
  await ci({ patientId: alex.id, planVersionId: v2.versionId, activityDate: d(-1), activityType: "Run", durationMin: 20, duringFeel: "Felt good", afterSymptoms: "Nothing notable", question: "Is it OK to run on grass instead of the road for these?" });

  const me = (patientId: string, def: string, value: string, recordedOn: string, source: "pt" | "patient", by: string, note: string | null = null) => db.insert(s.measureEntries).values({ id: newId(), patientId, definitionId: def, value, recordedOn, source, enteredBy: by, note });
  for (const def of [defs.run, defs.confidence, defs.heelRaise, defs.balance]) await db.insert(s.patientMeasures).values({ id: newId(), patientId: alex.id, definitionId: def, selectedBy: megan });
  await me(alex.id, defs.heelRaise, "9", d(-23), "pt", megan, "Affected side (left).");
  await me(alex.id, defs.heelRaise, "14", d(-9), "pt", megan);
  await me(alex.id, defs.balance, "18", d(-23), "pt", megan);
  await me(alex.id, defs.balance, "31", d(-9), "pt", megan);
  await me(alex.id, defs.run, "0", d(-23), "pt", megan, "Not running yet.");
  await me(alex.id, defs.run, "15", d(-9), "pt", megan, "Walk-run progressed to continuous.");
  await me(alex.id, defs.confidence, "4", d(-20), "patient", alex.userId);
  await me(alex.id, defs.confidence, "6", d(-6), "patient", alex.userId);
  await me(alex.id, defs.confidence, "7", d(-1), "patient", alex.userId);

  // Messages (seeded = simulated)
  const thread = await threadFor(db, alex.id);
  await sendMessage(db, { id: megan, role: "pt" }, alex.id, "Hi Alex — your updated plan is posted. Relevé walks, rows and your strength circuit are new this week. Reply here with any questions.", { simulated: true });
  await db.update(s.messages).set({ createdAt: new Date(Date.now() - 9 * 86400_000) }).where(eq(s.messages.threadId, thread.id));
  await sendMessage(db, { id: alex.userId, role: "patient" }, alex.id, "Thanks! Quick one — for relevé walks, is 12 steps each direction forward and back, or side to side?", { simulated: true });
  await db.update(s.messages).set({ createdAt: new Date(Date.now() - 1 * 86400_000) }).where(eq(s.messages.body, "Thanks! Quick one — for relevé walks, is 12 steps each direction forward and back, or side to side?"));
  await markRead(db, thread.id, alex.userId);

  // Media for Alex (placeholders; marked as demo in title/explanation)
  const storeDir = path.resolve(process.env.STORAGE_DIR || "./.data/uploads");
  const putFile = (key: string, buf: Buffer) => {
    fs.mkdirSync(path.dirname(path.join(storeDir, key)), { recursive: true });
    fs.writeFileSync(path.join(storeDir, key), buf, { mode: 0o600 });
  };
  const addMedia = async (v: { patientId: string | null; visitId: string | null; category: "patient_footage" | "general_demo" | "document" | "invoice"; title: string; explanation?: string; mime: string; buf: Buffer; capturedOn?: string; exerciseName?: string; by: string }) => {
    const id = newId();
    const key = `${v.patientId ?? "library"}/${id}`;
    putFile(key, v.buf);
    await db.insert(s.media).values({ id, patientId: v.patientId, visitId: v.visitId, category: v.category, title: v.title, explanation: v.explanation ?? null, mimeType: v.mime, sizeBytes: v.buf.length, storageKey: key, status: "ready", capturedOn: v.capturedOn ?? null, exerciseName: v.exerciseName ?? null, uploadedBy: v.by });
    return id;
  };
  await addMedia({ patientId: alex.id, visitId: v1.visitId, category: "patient_footage", title: "Single-leg stance — first visit", explanation: "Demo placeholder image. Notice the arch collapsing as you tire.", mime: "image/png", buf: placeholderPng(1), capturedOn: d(-23), exerciseName: "Arch domes", by: megan });
  await addMedia({ patientId: alex.id, visitId: v2.visitId, category: "patient_footage", title: "Single-leg stance — two weeks later", explanation: "Demo placeholder image. Arch is holding much longer.", mime: "image/png", buf: placeholderPng(4), capturedOn: d(-9), exerciseName: "Arch domes", by: megan });
  await addMedia({ patientId: alex.id, visitId: v1.visitId, category: "invoice", title: "Invoice — evaluation", mime: "application/pdf", buf: demoInvoicePdf(["Patient: Alex Morgan (fictional)", `Date of service: ${d(-23)}`, "Physical therapy evaluation", "This document is demo data and not a real bill."]), by: megan });
  await addMedia({ patientId: alex.id, visitId: v2.visitId, category: "invoice", title: "Invoice — follow-up visit", mime: "application/pdf", buf: demoInvoicePdf(["Patient: Alex Morgan (fictional)", `Date of service: ${d(-9)}`, "Physical therapy follow-up", "This document is demo data and not a real bill."]), by: megan });
  await addMedia({ patientId: null, visitId: null, category: "general_demo", title: "Toe yoga — general demonstration", explanation: "Library demonstration (no patient). Demo placeholder.", mime: "image/png", buf: placeholderPng(7), by: megan });

  // ---- Jordan Lee (Giana) — knee; written frequency, open draft --------------
  const jv1 = await publish(giana, jordan.id, d(-12), {
    recap: "Your knee pain is behaving like it's load-related. We're building hip and quad strength while keeping long runs shorter for now.",
    items: [
      item("Clamshells", { circuit: "Hip circuit", dosage: { sets: 2, reps: 15, perSide: true }, frequency: "daily" }),
      item("Single-leg bridge", { circuit: "Hip circuit", dosage: { sets: 3, reps: 10, perSide: true }, frequency: "daily" }),
      item("Step-downs", { dosage: { sets: 3, reps: 8, perSide: true }, frequency: "3x/week", cues: "Slow on the way down; knee stays over your second toe." }),
      item("Wall sit", { dosage: { sets: 3, holdSec: 45 }, frequency: "3x/week" }),
    ],
    runningGuidance: "Keep weekday runs as planned. Cap your long run at 10 miles until we reassess. If your knee is sore during a run, shorten it and note it in a check-in.",
    nextMilestone: "Complete a 10-mile long run with knee pain no higher than mild.",
    reassessNext: "Step-down quality and long-run response.",
    links: [],
  });
  await ci({ patientId: jordan.id, planVersionId: jv1.versionId, activityDate: d(-3), activityType: "Long run", durationMin: 92, distance: "10", distanceUnit: "mi", duringFeel: "Some discomfort", duringNote: "Knee ache from mile 8.", afterSymptoms: "Sore going down stairs that evening", nextMorning: "Better, slight ache on stairs." });
  await sendMessage(db, { id: jordan.userId, role: "patient" }, jordan.id, "Should I still do step-downs the day after a long run?", { simulated: true });
  const { visit: jVisit } = await ensureVisit(db, giana, jordan.id, d(-1), giana);
  const jDraft = await createDraft(db, giana, jordan.id, jVisit.id, { kind: "current_plan" });
  const jc = { ...jDraft.content, recap: "Step-downs look cleaner. " };
  await saveDraft(db, giana, jDraft.id, jDraft.revision, jc);
  await me(jordan.id, defs.run, "80", d(-12), "pt", giana);
  for (const def of [defs.run, defs.confidence]) await db.insert(s.patientMeasures).values({ id: newId(), patientId: jordan.id, definitionId: def, selectedBy: giana });

  // ---- Sam Rivera (Megan primary, Giana covering) — structured schedule ------
  const sv1 = await publish(megan, sam.id, d(-6), {
    recap: "Ankle range is back. Now it's about balance and strength on uneven ground before we take you back to technical trail.",
    items: [
      item("Single-leg balance", { dosage: { sets: 3, durationSec: 45, perSide: true }, scheduleDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], cues: "Eyes open on firm ground; switch to a pillow when this is easy." }),
      item("Banded ankle eversion", { dosage: { sets: 3, reps: 15, resistance: "Medium band" }, scheduleDays: ["mon", "wed", "fri"] }),
      item("Single-leg heel raise with twist", { dosage: { sets: 3, reps: 10 }, scheduleDays: ["mon", "wed", "fri"] }),
      item("Pogo hops", { dosage: { sets: 3, durationSec: 20, restSec: 60 }, scheduleDays: ["tue", "sat"], cues: "Quiet, quick contacts. Stop if your ankle feels unstable." }),
    ],
    runningGuidance: "Road or smooth trail only this week, up to 45 minutes easy. No technical downhill yet.",
    nextMilestone: "45 minutes on smooth trail with no ankle swelling the next morning.",
    reassessNext: "Hop testing and balance on foam.",
    links: [],
  });
  await ci({ patientId: sam.id, planVersionId: sv1.versionId, activityDate: d(-2), activityType: "Trail run", durationMin: 40, distance: "6.5", distanceUnit: "km", duringFeel: "Felt good", afterSymptoms: "Nothing notable" });
  for (const def of [defs.balance, defs.confidence]) await db.insert(s.patientMeasures).values({ id: newId(), patientId: sam.id, definitionId: def, selectedBy: megan });
  await me(sam.id, defs.balance, "22", d(-6), "pt", megan);

  // ---- Priya Shah (Megan) — one visit, plan published; Taylor — no visits yet
  await publish(megan, priya.id, d(-4), {
    recap: "Hip flexor tightness after bike-to-run transitions. Starting with hip strength and a gentler brick progression.",
    items: [item("Copenhagen plank", { dosage: { sets: 3, holdSec: 20, perSide: true }, frequency: "3x/week" }), item("Single-leg Romanian deadlift", { dosage: { sets: 3, reps: 8, perSide: true }, frequency: "3x/week" })],
    runningGuidance: "Keep brick runs to 10 minutes off the bike this week.",
    nextMilestone: "A 20-minute brick run without hip tightness.",
    reassessNext: "Hip extension range and brick-run response.",
    links: [],
  });

  // ---- Bookings (simulated Calendly) ----------------------------------------
  // Past visits came from bookings; upcoming ones show on the PT dashboard.
  const allVisits = await db.select().from(s.visits);
  for (const v of allVisits) {
    const [p] = await db.select().from(s.patients).where(eq(s.patients.id, v.patientId));
    const apptId = newId();
    await db.insert(s.appointments).values({ id: apptId, source: "calendly", externalId: `demo-${apptId}`, patientId: v.patientId, ptUserId: v.ptUserId, inviteeName: `${p.firstName} ${p.lastName}`, inviteeEmail: p.email!, eventName: "Follow-up visit (60 min)", startsAt: clinicDateTime(v.visitDate, "08:00"), status: "scheduled", visitId: v.id, simulated: true });
    await db.update(s.visits).set({ source: "booking", appointmentId: apptId }).where(eq(s.visits.id, v.id));
  }
  const book = async (patientEmail: string, name: string, ptId: string, day: number, hhmm: string, eventName = "Follow-up visit (60 min)") => {
    const [p] = await db.select().from(s.patients).where(eq(s.patients.email, patientEmail));
    const id = newId();
    await db.insert(s.appointments).values({ id, source: "calendly", externalId: `demo-${id}`, patientId: p?.id ?? null, ptUserId: ptId, inviteeName: name, inviteeEmail: patientEmail, eventName, startsAt: clinicDateTime(d(day), hhmm), status: "scheduled", simulated: true });
  };
  await book("alex@demo.cadence.test", "Alex Morgan", megan, 3, "07:30");
  await book("sam@demo.cadence.test", "Sam Rivera", megan, 1, "12:00");
  await book("jordan@demo.cadence.test", "Jordan Lee", giana, 2, "17:30");
  await book("priya@demo.cadence.test", "Priya Shah", megan, 5, "09:00");
  await book("taylor@demo.cadence.test", "Taylor Brooks", giana, 1, "15:30", "Initial evaluation (75 min)");
  // A booking whose email doesn't match any patient yet: waits in the admin queue.
  await book("chris.patel@demo.cadence.test", "Chris Patel", megan, 2, "08:00", "Initial evaluation (75 min)");
  // Booked earlier today, start time already passed: becomes a visit automatically on next load.
  {
    const id = newId();
    await db.insert(s.appointments).values({ id, source: "calendly", externalId: `demo-${id}`, patientId: priya.id, ptUserId: megan, inviteeName: "Priya Shah", inviteeEmail: "priya@demo.cadence.test", eventName: "Follow-up visit (60 min)", startsAt: new Date(Date.now() - 90 * 60_000), status: "scheduled", simulated: true });
  }

  // ---- A realistic roster: ~50 more fictional patients ------------------------
  const FIRST = ["Avery", "Blake", "Casey", "Dana", "Elliot", "Frankie", "Gray", "Harper", "Indy", "Jamie", "Kai", "Logan", "Morgan", "Noel", "Oakley", "Parker", "Quinn", "Reese", "Skyler", "Tatum", "Umi", "Val", "Wren", "Xen", "Yael", "Zion"];
  const LAST = ["Abbott", "Bishop", "Castillo", "Donovan", "Ellis", "Fischer", "Garza", "Hayes", "Ingram", "Jensen", "Kim", "Lambert", "Mendez", "Nolan", "Ortiz", "Pierce", "Quintero", "Rhodes", "Santos", "Tran"];
  const SPORTS = ["Road running · marathon", "Road running · 10K", "Trail running", "Triathlon", "Track · 1500m", "Ultramarathon", "Masters running", "Cross country"];
  for (let i = 0; i < 52; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const email = `${first}.${last}.${i}@demo.cadence.test`.toLowerCase();
    const pt = i % 3 === 0 ? giana : megan;
    const userId = newId();
    const pid = newId();
    await db.insert(s.users).values({ id: userId, name: `${first} ${last}`, email, role: "patient", passwordHash: pw, isDemo: true });
    await db.insert(s.patients).values({ id: pid, userId, firstName: first, lastName: last, email, sport: SPORTS[i % SPORTS.length], isDemo: true });
    await db.insert(s.careAssignments).values({ id: newId(), patientId: pid, staffUserId: pt, role: "primary", createdBy: michael, startedAt: new Date(Date.now() - 200 * 86400_000) });
    if (i % 5 === 0) await db.insert(s.careAssignments).values({ id: newId(), patientId: pid, staffUserId: pt === megan ? giana : megan, role: "covering", createdBy: michael });
    await threadFor(db, pid);
    // 1–3 past visits spread over the last ~4 months; some patients are inactive.
    const nVisits = 1 + (i % 3);
    for (let k = 0; k < nVisits; k++) {
      const day = -((i * 5 + k * 13) % 120) - 1;
      const vid = newId();
      const apptId = newId();
      const ok = await db.insert(s.visits).values({ id: vid, patientId: pid, ptUserId: pt, visitDate: d(day), source: "booking", appointmentId: apptId, createdBy: pt }).onConflictDoNothing().returning();
      if (!ok.length) continue;
      await db.insert(s.appointments).values({ id: apptId, source: "calendly", externalId: `demo-${apptId}`, patientId: pid, ptUserId: pt, inviteeName: `${first} ${last}`, inviteeEmail: email, eventName: "Follow-up visit (60 min)", startsAt: clinicDateTime(d(day), "10:00"), status: "scheduled", visitId: vid, simulated: true });
    }
    if (i % 4 === 0) await book(email, `${first} ${last}`, pt, 1 + (i % 6), ["07:00", "09:30", "11:00", "13:30", "16:00", "18:00"][i % 6]);
  }
}

if (process.argv[1]?.endsWith("seed.ts")) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
