# My Cadence

A mobile-first web app for **Cadence Physical Therapy**. PTs publish post-visit updates (exercises, running guidance, media, next milestone) faster than writing the current email. Patients get one place to see their plan, log how it went, check in after runs, and message their care team.

It complements WebPT today. Bookings sync from Calendly, and notifications go out by email. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the plan to replace the rest of the stack (intake, superbills, booking and, eventually, WebPT).

> **Status: development build with fictional data only.** Do not enter real patient information. See [`docs/LAUNCH_READINESS.md`](docs/LAUNCH_READINESS.md) for what has to be verified first.

## Quick start

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run setup
```

```bash
npm run dev
```

Open http://localhost:3000/demo and pick an account. Every demo account uses the password `cadence-demo`.

Stop the dev server before running `npm run setup` / `npm run db:reset` again: the embedded demo database allows one process at a time.

| Try this | As |
|---|---|
| Alex Morgan → **Create visit update** → *Paste existing instructions* → **Insert sample email (demo)** → review flags → publish | Dr. Meg (PT) |
| See the published plan, log exercises, add a run check-in, message the PT | Alex Morgan (patient) |
| "Today's plan" (a PT set a day-by-day schedule) vs "Current plan" (no schedule) | Sam Rivera vs Alex Morgan |
| Covering PT access (Sam), and no access to Alex (direct URL → 404) | Dr. Giana (PT) |
| Staff, care teams, **Integrations** (simulate a Calendly booking or an email reply, link unmatched bookings), audit log | Michael Pappalardo (admin) |
| Upcoming / Recently seen / All patients (60+ fictional patients) | Dr. Meg (PT) |

## Stack and why

| Concern | Choice | Reason |
|---|---|---|
| App | **Next.js 15 (App Router) + TypeScript** | One codebase for server-rendered pages, server actions and API routes; server-side authorization lives next to the data access. Mobile web, no native apps. |
| Database | **PostgreSQL via Drizzle ORM**, SQL migrations in `drizzle/` | Relational model with real constraints (unique publish per draft, one visit per patient per day). Locally it runs on **PGlite** (Postgres compiled to WASM) so the demo needs no database server. Set `DATABASE_URL` and the same migrations run on any Postgres. |
| Files | `StorageProvider` interface, local private-disk adapter | Files are never in `/public`. Every read goes through an authorized route. An S3-compatible adapter is the next step before real use. |
| Styling | Tailwind CSS v4 | Brand tokens from Cadence Brand Guidelines 2026 in `src/app/globals.css`. |
| Tests | Vitest | Parser rules, plan diffing, authorization, publish safeguards. |

No hosting provider has been chosen. Which vendors are acceptable for patient data is a decision to make with the checklist in `docs/LAUNCH_READINESS.md`, after checking each vendor's current documentation and agreements.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run setup` / `npm run db:reset` | Delete `.data/`, apply migrations, seed fictional demo data |
| `npm run db:generate` | Create a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (uses `DATABASE_URL` when set) |
| `npm test` | Unit and integration tests (in-memory Postgres) |
| `npm run typecheck`, `npm run build` | Type check / production build |

## Configuration (`.env.local`)

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `demo` | `demo` enables the demo banner, role switcher, fictional seed and simulated notifications. `live` disables all of them, rejects demo accounts at sign-in, and requires `DATABASE_URL` + `SESSION_SECRET`. |
| `DATABASE_URL` | empty | Empty = embedded PGlite in `.data/pglite` (demo only). |
| `STORAGE_DIR` | `./.data/uploads` | Private upload directory. |
| `EXTRACTION_PROVIDER` | `rules` | `rules` = deterministic parser, no AI, no network. `anthropic` = optional AI extraction (see below). |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | empty / `claude-sonnet-5-5` | Only used when `EXTRACTION_PROVIDER=anthropic`. |
| `APP_URL` | `http://localhost:3000` | Used in email links and shown webhook URLs. |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | empty | Enables `/api/integrations/calendly` (invitee.created / invitee.canceled). |
| `EMAIL_PROVIDER`, `SMTP_URL`, `EMAIL_FROM` | empty | `smtp` sends real (generic) notification emails. Demo mode never sends. |
| `EMAIL_REPLY_DOMAIN`, `INBOUND_EMAIL_SECRET` | empty | Replies to notification emails land in the patient's message thread via `/api/integrations/email/inbound`. |
| `AI_PHI_APPROVED` | `false` | AI extraction is refused in `live` unless this is `true`, which should only be set after the vendor and data handling are approved for patient information. |

## Where things are

```
src/db/schema.ts             data model (see docs/ARCHITECTURE.md)
src/db/seed.ts               fictional demo data (refuses to run unless APP_ENV=demo)
src/server/authz.ts          patient-level authorization rules
src/server/plans.ts          drafts → immutable published versions, corrections, publish safeguards
src/lib/extract/rules.ts     "paste existing instructions" parser
src/server/extraction/       provider interface + optional AI provider with post-validation
src/server/storage.ts        private storage interface; src/app/api/media/* authorized upload/stream
src/server/notify.ts         generic notifications (simulated / not_sent; never "delivered")
src/app/pt/                  PT workspace; update/[draftId]/editor.tsx is the visit-update editor
src/app/me/                  patient app
src/app/admin/               admin
docs/                        architecture notes and launch-readiness checklist
```

## Design notes

- Colors follow the Cadence Brand Guidelines 2026: black and white first, Meyer's Navy (#005596) for primary buttons and links, Rain Water (#ADC9E3) for highlights, Slate Blue (#6B8EAD) for secondary UI. Navigation is black with a white logo.
- The logo is an SVG approximation of the mark in the guidelines (three overlapping circles + "cadence."), always black or white. Swap in the official SVG when available.
- Body text uses Montserrat (brand body face). Headlines should use Kollektif, which is not bundled yet; until the font file is added, headings fall back to Montserrat.
- PT screens favor speed: a dashboard with explicit review states (unread, unreviewed, draft), and an editor that autosaves with conflict detection.
- Patient screens favor clarity: one plan, plain dosage, "Not specified — ask your PT" instead of guessed values, no scores or streaks.
