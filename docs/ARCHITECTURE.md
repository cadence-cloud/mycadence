# Architecture

## Core concepts kept separate

| Concept | Table | Notes |
|---|---|---|
| **Appointment** (a booking) | `appointments` | Synced from Calendly webhooks. Matched to patients by email and to PTs by host email. Unmatched bookings wait in Admin → Integrations. |
| **Visit** (an appointment that happened) | `visits` | Created automatically when a booked appointment's start time passes (`source = booking`), or by a PT for an unbooked visit. Unique on (patient, date), so re-opening an update or a duplicate booking never inflates visit counts. "Didn't happen" removes an empty auto-created visit. |
| **Draft** (work in progress) | `plan_drafts` | Autosaved. `revision` is an optimistic-lock counter: a save only applies if the client saw the latest revision, otherwise it returns 409 and the editor stops autosaving and asks the PT to reload. One open visit-update draft per visit. |
| **Published version** (what the patient follows) | `plan_versions` | Immutable JSON snapshot plus a `change_summary`. `version_number` is unique per patient; `draft_id` is unique, so a double-click or retry returns the existing version instead of a duplicate. Publishing checks that no newer version appeared since the draft started (`stale_base`) and asks the PT to confirm. |
| **Correction** | `plan_drafts.kind = 'correction'` → new `plan_versions` row with `correction_of_version_id` + required note | The corrected version stays in history, labeled "Corrected in vN". Patients see the note. |
| **Exercise assignment** | `exercise_assignments` | Created at publish, one row per exercise per version. `item_key` stays stable while the PT keeps an exercise across versions. |
| **Completion entry** | `completion_entries` | Unique on (assignment, date): per-day, not a permanent checkbox. Points at the assignment *and* version it was logged against. Corrections push the previous value into `history`. New entries are only allowed against the current version. |

## Dosage and frequency are never invented

`Dosage` fields are all optional. The UI and patient view show only fields the PT set, and show "Not specified — ask your PT" otherwise. `reviewChecks()` (`src/lib/plan-logic.ts`) flags missing frequency and dosage on every draft, however it was created. Publishing requires the PT to confirm they reviewed the preview; it does not require filling every blank, because "not decided yet" is a legitimate clinical choice.

"Today's plan" is shown only when at least one exercise has a structured `scheduleDays`. Free-text frequency ("3x/week") keeps the "Current plan" label.

## Paste existing instructions

1. The PT pastes text into a draft. `POST /api/drafts/:id/extract` runs the configured provider.
2. **Rules provider (default):** deterministic. Bullets become exercises; `3 × 12`, `5 × 20-second holds`, `3 × 1 minute`, `each side`, `each direction` are structured; leftover phrases become cues or verbatim dosage notes. "New additions" sentences mark matching exercises as new. Running sentences go to running guidance **verbatim**. Conditional sentences ("If feeling good, …") are flagged for review. "At the next session …" goes to *reassess next visit*. Running frequency ("every other day") is never copied onto exercises.
3. **AI provider (optional):** behind `ExtractionProvider`, server-side only. Refused in `live` unless `AI_PHI_APPROVED=true`. Its output is checked against the source: numbers or frequencies not in the pasted text are removed and flagged, and conditional sentences must survive verbatim. If the call fails, the rules provider is used and the PT is told.
4. Extracted exercises are matched to the current plan by library ID or normalized name, so unchanged exercises keep their identity and "What changed" is accurate.
5. The original text is stored on the draft and shown beside the patient preview during review. The extraction source (`rules` or `ai:<model>`) is shown, so the PT can tell real AI extraction from the rule-based parser. The demo's "Insert sample email" button only fills the textarea; extraction itself is always real.

## Authorization

`src/server/authz.ts` is the single source of truth, called by every page, server action and API route:

- **Patient:** only their own patient record; only published versions and media marked visible to the patient.
- **PT:** patients with an active care assignment (primary or covering). Ending an assignment removes access immediately.
- **Admin:** operational data (names, care teams, settings, audit metadata, notification outbox). No plans, messages, check-ins or media.

Unauthorized patient URLs return 404 so they don't confirm that a patient exists. Media is streamed only through `/api/media/:id` with a session check on every request, `Cache-Control: private, no-store`, range support for video, and a generic filename.

## Media uploads

Two-step: `POST /api/media` validates type, size, patient, visit and draft, then reserves a `pending` row. `PUT /api/media/:id/content` streams the bytes to a temp file, checks the byte count, and renames atomically before marking the row `ready`. Failed uploads are marked `failed` and can be retried with the same row. Cancel calls `DELETE`, which soft-deletes. Pending and failed files are never shown. Patient footage (`patient_footage`) and general demonstrations (`general_demo`, no patient) are separate categories, and only general demos can be attached to library exercises.

## Integrations

- **Calendly → appointments → visits:** `src/server/scheduling.ts`, webhook at `/api/integrations/calendly`. A booked PT who isn't on the patient's care team is added as covering, so they can document the visit (audited).
- **Email:** `src/server/email.ts` (SMTP via nodemailer; simulated in demo). Inbound replies: `src/server/inbound-email.ts`, webhook at `/api/integrations/email/inbound`.
- Google Calendar isn't integrated directly: Calendly is the source of truth and already writes to Google Calendar. If booking moves in-house later, two-way Google Calendar sync becomes part of that work (see `docs/ROADMAP.md`).

## Messaging and notifications

One thread per patient. Patient messages notify only the active care team. Every notification row uses the subject "You have a new update from Cadence" and a link that requires sign-in, with no treatment details. Status is `simulated` (demo), `not_sent` (no provider configured), `queued`, `sent` or `failed`. Never "delivered". Seeded demo messages are labeled "Simulated (demo)".

## Audit

`audit_events` records actor, action, record type/ID and patient ID, plus counts or enums in `meta`. Clinical free text (exercise names, recaps, messages, symptoms, pasted email) is deliberately excluded. Media views and sign-ins (including failures) are logged.

## Time

Calendar dates (`visit_date`, `session_date`, `activity_date`, `recorded_on`) are stored as `date` in clinic-local time (America/New_York) via `localDate()`. Instants are `timestamptz` and displayed in America/New_York with the zone abbreviation.
