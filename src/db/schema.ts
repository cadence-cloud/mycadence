/**
 * My Cadence data model.
 *
 * Key separations (see docs/ARCHITECTURE.md):
 *  - visits          = appointments that happened (counted for visit totals)
 *  - plan_drafts     = work-in-progress care updates (autosaved, optimistic revision)
 *  - plan_versions   = immutable published plans, numbered per patient
 *  - exercise_assignments = immutable rows created at publish, one per exercise in a version
 * Corrections publish a NEW version that references the version it corrects.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  date,
  uniqueIndex,
  index,
  numeric,
  bigint,
} from "drizzle-orm/pg-core";
import type { PlanContent, PlanChangeSummary, ReviewFlag } from "@/lib/plan-types";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    credentials: text("credentials"), // e.g. "DPT" — display only
    role: text("role", { enum: ["admin", "pt", "patient"] }).notNull(),
    passwordHash: text("password_hash"),
    isDemo: boolean("is_demo").notNull().default(false),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    viaDemoSwitch: boolean("via_demo_switch").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash)],
);

export const patients = pgTable(
  "patients",
  {
    id: id(),
    userId: text("user_id").references(() => users.id), // patient login (nullable until invited)
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    sport: text("sport"), // e.g. "Road running · half marathon"
    timezone: text("timezone").notNull().default("America/New_York"),
    isDemo: boolean("is_demo").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("patients_user_uq").on(t.userId)],
);

export const careAssignments = pgTable(
  "care_assignments",
  {
    id: id(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    staffUserId: text("staff_user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["primary", "covering"] }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id),
  },
  (t) => [index("care_patient_idx").on(t.patientId), index("care_staff_idx").on(t.staffUserId)],
);

/** Goals written in the patient's own words. */
export const goals = pgTable("goals", {
  id: id(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  text: text("text").notNull(),
  targetEvent: text("target_event"),
  targetDate: date("target_date"),
  status: text("status", { enum: ["active", "achieved", "set_aside"] }).notNull().default("active"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const visits = pgTable(
  "visits",
  {
    id: id(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    ptUserId: text("pt_user_id").notNull().references(() => users.id),
    visitDate: date("visit_date").notNull(), // clinic-local (America/New_York) calendar date
    kind: text("kind", { enum: ["evaluation", "follow_up", "virtual"] }).notNull().default("follow_up"),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  // One visit per patient per day prevents accidental duplicate appointments
  // when a PT reopens a visit update. Reversible if same-day double visits are needed.
  (t) => [uniqueIndex("visits_patient_date_uq").on(t.patientId, t.visitDate)],
);

export const exercises = pgTable("exercises", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  bodyRegion: text("body_region"),
  demoMediaId: text("demo_media_id"), // general (non-identifiable) demonstration only
  defaultDosage: jsonb("default_dosage").$type<Record<string, unknown>>(),
  isCustom: boolean("is_custom").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const planTemplates = pgTable("plan_templates", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  content: jsonb("content").$type<PlanContent>().notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const planDrafts = pgTable(
  "plan_drafts",
  {
    id: id(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    visitId: text("visit_id").references(() => visits.id),
    kind: text("kind", { enum: ["visit_update", "correction"] }).notNull().default("visit_update"),
    basePlanVersionId: text("base_plan_version_id"),
    correctionOfVersionId: text("correction_of_version_id"),
    correctionNote: text("correction_note"),
    startedFrom: text("started_from"), // "current_plan" | "template:<id>" | "blank" | "paste"
    content: jsonb("content").$type<PlanContent>().notNull(),
    originalPastedText: text("original_pasted_text"),
    extractionSource: text("extraction_source"), // "rules" | "ai:<model>" | "demo-mock"
    reviewFlags: jsonb("review_flags").$type<ReviewFlag[]>().notNull().default([]),
    revision: integer("revision").notNull().default(1),
    status: text("status", { enum: ["draft", "published", "discarded"] }).notNull().default("draft"),
    authorId: text("author_id").notNull().references(() => users.id),
    lastEditedBy: text("last_edited_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("drafts_patient_idx").on(t.patientId)],
);

export const planVersions = pgTable(
  "plan_versions",
  {
    id: id(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    visitId: text("visit_id").references(() => visits.id),
    draftId: text("draft_id").notNull().references(() => planDrafts.id),
    versionNumber: integer("version_number").notNull(),
    content: jsonb("content").$type<PlanContent>().notNull(), // immutable snapshot
    changeSummary: jsonb("change_summary").$type<PlanChangeSummary>(),
    supersedesVersionId: text("supersedes_version_id"),
    correctionOfVersionId: text("correction_of_version_id"),
    correctionNote: text("correction_note"),
    publishedBy: text("published_by").notNull().references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("versions_draft_uq").on(t.draftId), // a draft can be published once
    uniqueIndex("versions_patient_number_uq").on(t.patientId, t.versionNumber),
  ],
);

export const exerciseAssignments = pgTable(
  "exercise_assignments",
  {
    id: id(),
    planVersionId: text("plan_version_id").notNull().references(() => planVersions.id),
    patientId: text("patient_id").notNull().references(() => patients.id),
    itemKey: text("item_key").notNull(), // stable across versions while the PT keeps the exercise
    exerciseId: text("exercise_id").references(() => exercises.id),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    circuit: text("circuit"),
    dosage: jsonb("dosage").$type<Record<string, unknown>>().notNull(),
    frequency: text("frequency"),
    scheduleDays: jsonb("schedule_days").$type<string[] | null>(),
    cues: text("cues"),
    patientMediaId: text("patient_media_id"),
  },
  (t) => [index("assign_version_idx").on(t.planVersionId)],
);

export const completionEntries = pgTable(
  "completion_entries",
  {
    id: id(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    assignmentId: text("assignment_id").notNull().references(() => exerciseAssignments.id),
    planVersionId: text("plan_version_id").notNull().references(() => planVersions.id),
    sessionDate: date("session_date").notNull(),
    status: text("status", { enum: ["completed", "partial", "skipped"] }).notNull(),
    comment: text("comment"),
    // Prior values when a patient corrects an entry; nothing is silently lost.
    history: jsonb("history").$type<{ status: string; comment: string | null; at: string }[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("completion_assignment_date_uq").on(t.assignmentId, t.sessionDate)],
);

export const checkIns = pgTable(
  "check_ins",
  {
    id: id(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    planVersionId: text("plan_version_id").references(() => planVersions.id),
    activityDate: date("activity_date").notNull(),
    activityType: text("activity_type").notNull(),
    durationMin: integer("duration_min").notNull(),
    distance: numeric("distance"),
    distanceUnit: text("distance_unit", { enum: ["mi", "km"] }),
    duringFeel: text("during_feel").notNull(),
    duringNote: text("during_note"),
    afterSymptoms: text("after_symptoms"),
    nextMorning: text("next_morning"),
    nextMorningAt: timestamp("next_morning_at", { withTimezone: true }),
    question: text("question"),
    reviewStatus: text("review_status", { enum: ["unreviewed", "reviewed"] }).notNull().default("unreviewed"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("checkins_patient_idx").on(t.patientId)],
);

export const measureDefinitions = pgTable("measure_definitions", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  definition: text("definition").notNull(), // consistent measurement definition shown in UI
  source: text("source", { enum: ["patient", "pt"] }).notNull(),
  minValue: numeric("min_value"),
  maxValue: numeric("max_value"),
});

/** Which measures a PT has selected for a patient. */
export const patientMeasures = pgTable(
  "patient_measures",
  {
    id: id(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    definitionId: text("definition_id").notNull().references(() => measureDefinitions.id),
    selectedBy: text("selected_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("patient_measure_uq").on(t.patientId, t.definitionId)],
);

export const measureEntries = pgTable("measure_entries", {
  id: id(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  definitionId: text("definition_id").notNull().references(() => measureDefinitions.id),
  value: numeric("value").notNull(),
  note: text("note"),
  recordedOn: date("recorded_on").notNull(),
  source: text("source", { enum: ["patient", "pt"] }).notNull(),
  enteredBy: text("entered_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const milestones = pgTable("milestones", {
  id: id(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  title: text("title").notNull(),
  planVersionId: text("plan_version_id").references(() => planVersions.id),
  status: text("status", { enum: ["upcoming", "achieved", "replaced"] }).notNull().default("upcoming"),
  achievedOn: date("achieved_on"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const media = pgTable(
  "media",
  {
    id: id(),
    patientId: text("patient_id").references(() => patients.id), // null => general library demo
    visitId: text("visit_id").references(() => visits.id),
    draftId: text("draft_id").references(() => planDrafts.id),
    planItemKey: text("plan_item_key"),
    exerciseName: text("exercise_name"),
    category: text("category", { enum: ["patient_footage", "general_demo", "document", "invoice"] }).notNull(),
    title: text("title").notNull(),
    explanation: text("explanation"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status", { enum: ["pending", "ready", "failed"] }).notNull().default("pending"),
    visibleToPatient: boolean("visible_to_patient").notNull().default(true),
    capturedOn: date("captured_on"),
    uploadedBy: text("uploaded_by").notNull().references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("media_patient_idx").on(t.patientId)],
);

export const messageThreads = pgTable(
  "message_threads",
  {
    id: id(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("thread_patient_uq").on(t.patientId)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: text("thread_id").notNull().references(() => messageThreads.id),
    senderId: text("sender_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("messages_thread_idx").on(t.threadId)],
);

export const messageReads = pgTable(
  "message_reads",
  {
    id: id(),
    threadId: text("thread_id").notNull().references(() => messageThreads.id),
    userId: text("user_id").notNull().references(() => users.id),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("reads_thread_user_uq").on(t.threadId, t.userId)],
);

/** Outbound notifications. Content is always generic — no treatment details. */
export const notificationEvents = pgTable("notification_events", {
  id: id(),
  recipientUserId: text("recipient_user_id").notNull().references(() => users.id),
  channel: text("channel", { enum: ["email", "in_app"] }).notNull(),
  eventType: text("event_type").notNull(), // "plan_published" | "new_message" | ...
  subject: text("subject").notNull(),
  linkPath: text("link_path").notNull(),
  // "simulated" (demo), "not_sent" (no provider configured), "queued", "sent", "failed".
  // Never "delivered": we cannot observe inbox delivery.
  status: text("status", { enum: ["simulated", "not_sent", "queued", "sent", "failed"] }).notNull(),
  createdAt: createdAt(),
});

/** Who did what to which record — deliberately excludes clinical free text. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    patientId: text("patient_id"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_patient_idx").on(t.patientId), index("audit_at_idx").on(t.at)],
);

export const clinicSettings = pgTable("clinic_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
