# Backlog

Features that are designed or requested but deliberately parked. Move an item out of here when work starts.

## Demo booking: meeting invite and confirmation

**Status:** parked (Oct 2026). Design agreed, nothing built.

**Problem**

- Booking a demo (AI assistant widget or `/book-demo`) creates a `demo_bookings` row, but no meeting link is created.
- `/book-demo` says a confirmation email is sent. Nobody receives one.

**Agreed approach**

1. **Google Meet via the Google Calendar API** from a dedicated free Gmail account (for example `khatario.demos@gmail.com`).
   - Create a calendar event with `conferenceData.createRequest` (Meet link) and `sendUpdates=all`, so Google emails the customer a real calendar invite with reminders.
   - Free Gmail limits: one-to-one calls up to 24 hours, calls with 3 or more people capped at 60 minutes. Fine for demos.
   - One-time OAuth consent to get a refresh token. Store it only in server env (`GOOGLE_DEMO_CALENDAR_*`), never in git.
   - If `help@khatario.com` later moves to Google Workspace, switch to a service account with domain-wide delegation.
2. **Jitsi fallback.** If the Google call fails, generate `https://meet.jit.si/Khatario-DEMO-<id>-<random>` so a booking never fails. Note that meet.jit.si makes the first participant sign in.
3. **Delivery channels**
   - Google calendar invite email (automatic with option 1).
   - Show the link and an "Add to calendar" (.ics) button on the confirmation screen in the widget and on `/book-demo`.
   - WhatsApp "demo confirmed" template with date, time and link. Needs Meta approval; the OTP template cannot carry the link.
4. Save the meeting link, provider and calendar event id on `demo_bookings`. Cancel or reschedule should update the calendar event.

**Depends on**

- Migration `303` (demo booking `lead_source` fix) being deployed first.

## Assistant Phase 2

Not started. See the RAG assistant plan.
