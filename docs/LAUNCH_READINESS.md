# Real-patient launch readiness

My Cadence is a **functional development system that uses synthetic data**. It is **not** "HIPAA compliant." Authentication, encryption, or a vendor that offers a BAA do not make it so on their own. Before any real patient information is entered, each item below needs an owner, a decision, and evidence. Items marked **Built** have a starting implementation that still needs review. Items marked **Open** have not been done.

## 1. Hosting and service providers — Open
- [ ] Choose hosting, managed Postgres, object storage, email/SMS and (if used) AI vendors. Check each vendor's **current** documentation for HIPAA eligibility. Eligibility often depends on plan tier and on which specific services are used.
- [ ] Execute Business Associate Agreements with every vendor that stores, processes or transmits PHI (hosting, database, storage, backups, email, logging/monitoring, error tracking, AI). Keep copies.
- [ ] Confirm data residency, backup location, retention, and deletion terms.
- [ ] Error tracking and analytics must not receive PHI. Review or disable them.
- [ ] Complete a documented HIPAA risk analysis (Security Rule §164.308(a)(1)) and policies covering workforce access, training, incident response and breach notification. Consider review by a HIPAA-experienced attorney or consultant.

## 2. Authentication and account recovery — Partly built
- **Built:** scrypt password hashes; random 256-bit session tokens stored only as SHA-256 hashes; HttpOnly, SameSite=Lax cookies (Secure in production); 12 h staff / 14 d patient sessions; sign-out deletes the session; deactivating staff ends all their sessions; generic sign-in errors; failed sign-ins audited.
- [ ] Replace admin-generated temporary passwords with **single-use, expiring invite and password-reset links** sent through an approved email provider.
- [ ] Rate-limit sign-in and lock out repeated failures. Not yet implemented.
- [ ] Password policy (length, breached-password check).
- [ ] Consider a managed identity provider instead of in-app passwords. Re-evaluate after choosing hosting.
- [ ] Session idle timeout for staff on shared clinic devices.
- [ ] CSRF review: server actions use Next.js origin checks and the JSON API relies on SameSite cookies. Confirm this holds for the deployed domain setup.

## 3. Staff MFA — Open
- [ ] Require MFA (TOTP or WebAuthn) for every PT and admin account before launch. Not implemented.
- [ ] Recovery procedure for lost MFA devices that doesn't bypass identity verification.

## 4. Server-enforced roles and patient isolation — Built, needs review
- **Built:** every page, server action and API route checks role and patient-level access in `src/server/authz.ts`. PTs need an active care assignment. Patients see only their own published data. Admins get no clinical access. Unauthorized patient URLs return 404. Integration tests cover PT, covering PT, ended assignment, patient and admin cases (`tests/server.test.ts`).
- [ ] Independent code review and penetration test focused on IDOR (object ID guessing) on every route.
- [ ] Decide whether owners need clinical access as admins (currently they don't). If so, add an explicit, audited grant rather than broadening the admin role.
- [ ] Break-glass access procedure, if needed, with audit.
- [ ] The demo role switcher is disabled server-side when `APP_ENV=live`, and demo accounts can't sign in to live. Verify the live deployment never runs with `APP_ENV=demo` (deployment check).

## 5. Private file access and expiration — Partly built
- **Built:** files are stored outside the web root; every request goes through a session- and authorization-checked route; `Cache-Control: private, no-store`; generic download filenames; soft delete; atomic uploads (no partial file marked ready); type and size validation on client and server.
- [ ] Move to private object storage with server-side encryption, no public bucket access, and **short-lived signed URLs** (minutes) issued only after the same authorization check.
- [ ] Content sniffing and malware scanning for uploads. HEIC/MOV transcoding so files play everywhere.
- [ ] Strip EXIF/GPS metadata from photos.
- [ ] Clean up abandoned `pending`/`failed` uploads on a schedule.
- [ ] Retention and deletion policy for media and invoices.
- [ ] Linking a Google Doc does **not** change its sharing settings. Train staff to set Doc sharing appropriately, or move strength circuits into the app.

## 6. Encryption and secrets — Open
- [ ] TLS everywhere (HSTS); encryption at rest for database, storage and backups (vendor-managed keys at minimum).
- [ ] Secrets (`DATABASE_URL`, `SESSION_SECRET`, API keys) in a secrets manager, never in the repo. Rotation procedure.
- [ ] Production `next.config.ts` security headers reviewed; add a Content-Security-Policy.

## 7. Audit logging without unnecessary clinical content — Built, needs review
- **Built:** `audit_events` records actor, action, record IDs, patient ID, timestamps, and counts/enums only. No message bodies, exercise names, symptoms or pasted text. Media views, publishes, corrections, check-in reviews, assignment changes and sign-ins are logged.
- [ ] Make audit logs append-only (database permissions) and retained per policy (commonly 6 years for HIPAA documentation).
- [ ] Configure hosting and request logs so URLs, query strings and bodies don't capture PHI. App URLs contain only opaque IDs, but verify proxies and error tools.
- [ ] A process for reviewing audit logs.

## 8. Notifications — Partly built
- **Built:** generic subject "You have a new update from Cadence" and a link that requires sign-in. No treatment details in subjects, previews or URLs. Statuses are honest (`simulated`, `not_sent`, `queued`, `sent`, `failed`; never "delivered").
- [ ] Integrate an approved email/SMS provider (with BAA if it touches PHI, including recipient email addresses linked to a clinic), unsubscribe handling, and bounce tracking.
- [ ] Patient consent and communication preferences.

## 9. Messaging operations — Partly built
- **Built:** per-patient thread visible only to the patient and active care team; unread tracking; configurable response expectation and urgent-care guidance shown to patients.
- [ ] Coverage process when the primary PT is away (who triages the covering queue).
- [ ] Clinic sign-off on the urgent-care wording.
- [ ] Decide whether messages become part of the medical record (and how they reach WebPT).

## 10. AI extraction — Gated
- **Built:** off by default; deterministic parser works without AI. AI is refused in `live` unless `AI_PHI_APPROVED=true`. Output is validated against the pasted text and always requires PT review. AI never publishes, prescribes, diagnoses, clears a runner, or changes dosage.
- [ ] Vendor BAA and zero-retention / no-training terms confirmed before enabling with PHI.
- [ ] Prompt and output evaluation on de-identified real emails before relying on it.

## 11. Data lifecycle and operations — Open
- [ ] Backups with tested restore; point-in-time recovery.
- [ ] Patient data export and account closure/deletion procedures (respecting record retention).
- [ ] Uptime monitoring and alerting without PHI.
- [ ] Accessibility review (WCAG 2.2 AA) with real assistive technology.
- [ ] Load test media uploads on mobile networks.

## 12. Clinical and product sign-off — Open
- [ ] PTs validate the "paste existing instructions" output on a sample of real (de-identified) emails.
- [ ] Measure definitions in `measure_definitions` approved by the clinical team.
- [ ] Patient-facing copy reviewed (no implied clearance, predictions or urgency scoring).
- [ ] Clarify the relationship to WebPT documentation. There is no automatic sync.
- [ ] Billing: invoices are attachments only. No billing or payment processing is in scope.
