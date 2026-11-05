# Replacing the stack: is it possible?

**Short answer: yes.** For a cash-based practice with no insurance billing, replacing Calendly, Monday intake forms, WebPT, patient email and Google Drive with one system is realistic. The hardest part is WebPT. Clinical documentation carries the most legal and record-keeping weight, so it should come last, after the other pieces have proven themselves with real use.

The plan below gets there in stages. Each stage stands on its own, so you can stop at any point and keep using the remaining tools.

| Today | Replaced by | Difficulty | Notes |
|---|---|---|---|
| Google Doc strength circuits | Plans with grouped circuits | **Done** | Circuits live in the plan. Pasted emails that say "see your strength circuits" keep the current circuit. |
| Emailing patients | Messages + generic email notifications + reply-by-email | **Done (needs an email provider)** | Needs an email provider that will sign a BAA. |
| Manually logging sessions | Calendly → visits automatically | **Done (needs your Calendly key)** | Calendly stays the booking tool for now. |
| Google Drive for files | Private photos, videos and documents per patient and visit | **Done (needs production storage)** | Move to HIPAA-eligible object storage before real patients. |
| Monday intake forms | In-app intake + consent forms | Medium | Form builder (or fixed forms), e-signature of consent/financial policy, answers attached to the patient record. Triggered automatically by a new booking. |
| Invoices / superbills | Superbill generator | Medium | Cash practices give patients a superbill to submit for out-of-network reimbursement. Needs: practice name, address, NPI (individual + group), tax ID, provider signature, ICD-10 diagnosis codes, CPT codes with units and charges per date of service, amount paid. A PDF is generated per visit or date range. |
| Calendly | Built-in booking | Medium–hard | Availability rules, visit types, buffers, reminders, reschedule/cancel links, payment at booking (optional), two-way Google Calendar sync so PTs still see appointments on their phones. Replace Calendly only after intake is in-app. |
| Payments (if desired) | Card on file / pay at booking | Medium | Use a payment processor; card data never touches this app. Payment processing has its own HIPAA carve-outs, but confirm with counsel. |
| WebPT (clinical notes) | Built-in documentation | **Hard** | See below. |

## What replacing WebPT really takes

A documentation system isn't just notes. Before trusting it with the legal medical record you need:

- **Evaluation, daily note, progress note and discharge templates**, matching how Dr. Meg and Dr. Giana document today.
- **Signing and locking:** notes are signed, then locked. Changes after signing are addenda with their own timestamp and author, never silent edits. (The plan-version model here already works this way and is a good base.)
- **Record retention and export:** New Jersey requires physical therapy records to be kept for a set number of years, longer for minors. Confirm the exact periods with counsel. Patients have a right to a copy of their records, so you need a full chart export (PDF).
- **Plan of care** and, where required, physician referral or direct-access rules for New Jersey PT practice.
- **Data migration** of existing WebPT records (export from WebPT, import or archive).
- **Audit trail, backups and access controls** at a level you would defend in an audit or a dispute.

None of this is out of reach. It's the stage where mistakes cost the most, so build it after the patient-facing pieces are in daily use.

## Suggested order

1. **Now:** run the current app with fictional data. Connect Calendly and an email provider in a test environment.
2. **Real-patient pilot:** finish `docs/LAUNCH_READINESS.md` (hosting with a BAA, staff two-factor sign-in, invite/reset emails, production file storage). Start with a few patients.
3. **Intake and consent** inside the app, triggered by the first booking. Retire Monday forms.
4. **Superbills** from visit data. Retire separately made invoices.
5. **Built-in booking** with Google Calendar sync. Retire Calendly.
6. **Clinical documentation.** Retire WebPT after a period of running both side by side.

## HIPAA notes for every stage

- Each vendor that touches patient information (hosting, database, file storage, email, SMS, payments, error tracking, AI) needs a signed BAA, or must be kept from receiving PHI. Check each vendor's **current** terms. Calendly's HIPAA status should be confirmed directly with Calendly before booking data (names, emails, times) counts as protected.
- Superbills contain diagnosis codes and must only be available to the patient and staff, through the same private, authorized file access the app already uses.
- Keep notifications generic (they already are).
