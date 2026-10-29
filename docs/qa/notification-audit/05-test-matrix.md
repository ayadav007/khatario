# Notification audit, Phase 5: delivery and action matrix

Date: 2026-10-29. Statuses follow `docs/qa/README.md`: **PASS**, **FAIL**, **BLOCKED**, **NOT TESTED**. "N/A" is used only where the brief's case assumes an OS push integration that does not exist; each such row says what was verified instead.

Devices: Android 15 emulator `khatario_pixel` (Pixel 7 profile) with the Capacitor debug APK (`com.khatario.app` 1.3.0, server `https://staging.khatario.com`) and the Flutter owner release APK (`com.khatario.phone` 1.0.0). No account was signed in on the device and nothing was sent to a real customer or owner.

Web in-app stream cases were executed in Jest against the real stream code (`tests/lib/notifications/stream/hub.test.ts` with an in-memory source and fake Redis; `tests/db/notification-stream.db.test.ts` against `kh_phase2_test`). A signed-in browser pass on a local test server was **BLOCKED** in this session: the folder already had five dev servers from other chats (the limit), and reading the local test password from `.env` was refused by the permission classifier. Command and expected result are given so it can be run later.

| # | Case | Preconditions | Steps | Expected | Actual | Status | Evidence | Defect / remediation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | App open in the foreground (web / Capacitor WebView) | Signed in, stream open | Insert a row for the business; wait for the next heartbeat | Bell count increments without reload within 25 s; hinted types within ~50 ms | Jest: broadcast row with no hint delivered on the 25 s heartbeat (fix N-01); hinted row delivered after 100 ms; DB suite: own and broadcast rows, out-of-order commits, resync all delivered | PASS (Jest) / BLOCKED (browser) | `hub.test.ts` "delivers a row inserted without a hint ..."; `notification-stream.db.test.ts` | N-01 fixed |
| 2 | App in the background | Capacitor shell backgrounded | — | Nothing is shown (no OS notification); on resume the stream reconnects and the list is re-read | Code-level: `lifecycle.ts` handles `resume`/`visible` → `wake()`; unit `stream-integration.test.ts` covers the wake path | PASS (unit, wake path) / N/A (OS display) | `tests/lib/notifications/client/stream-integration.test.ts` | Missing feature: FCM |
| 3 | App removed from recents | — | — | Nothing can be delivered until reopened | Verified absent: no channel, no receiver, `Notification` undefined in WebView | N/A (verified absent) | `04-android-ux.md` | Missing feature |
| 4 | Process terminated by Android | — | — | same as 3 | same | N/A | same | same |
| 5 | Device restarted | — | — | No boot receiver exists; nothing resumes | Manifest has no receiver (verified) | N/A | `AndroidManifest.xml` | same |
| 6 | Notifications permitted | — | — | `POST_NOTIFICATIONS` would be granted | Permission is not declared in either APK (`dumpsys package`) | N/A (verified absent) | `04-android-ux.md` | same |
| 7 | Notifications denied | — | — | — | Not declared, cannot be denied | N/A | same | same |
| 8 | Re-enabled after denial | — | — | — | same | N/A | same | same |
| 9 | Sound enabled | — | — | Channel with sound | No channel exists (`dumpsys notification`: 0 channels for both packages) | N/A | same | same |
| 10 | Sound disabled at channel level | — | — | — | same | N/A | same | same |
| 11 | Silent / DND | — | — | — | same | N/A | same | same |
| 12 | Wi-Fi | Emulator on Wi-Fi | Launch the shell | Loads the staging login over the WebView | Loaded (`evidence/emu-capacitor-launch.png`) | PASS (app load only) | screenshot, logcat `KhatarioWebView` | — |
| 13 | Mobile data | — | — | — | Not switched on the emulator | NOT TESTED | — | — |
| 14 | Temporary network loss and recovery (web stream) | Stream open | Go offline, come back | Stream killed on `offline`, reconnects on `online` with the stored cursor and replays rows committed meanwhile | Unit: offline/online lifecycle, backoff with jitter, Retry-After on 429/503, `Last-Event-ID` resume; DB: resume after cursor replays rows | PASS (Jest) | `stream-integration.test.ts`, `hub.test.ts`, `notification-stream.db.test.ts` | — |
| 15 | Invalid or expired FCM token | — | — | — | No tokens exist. Admin Web Push deletes 404/410 endpoints (code-level, untested) | N/A / NOT TESTED (admin) | `lib/platform-push.ts` | — |
| 16 | Two devices (tabs) registered to one user | Two streams for the same user | Insert a per-user row | Both streams receive it; a third business's stream does not | Unit: hint fan-out reaches both of Alice's streams in BIZ and not her stream in BIZ2; DB: scoping by business and user | PASS (Jest) | `hub.test.ts` "fans a hint out ..." | — |
| 17 | Log out, log in as another account | Session change | Switch session key | Store reset, cursor per session, old events dropped; revoked session gets `auth` event and 401 | Unit: session switch; route tests: revoked → 401 `SESSION_REVOKED` | PASS (Jest) | `stream-integration.test.ts`, `notification-routes-auth.test.ts` | — |
| 18 | Switch business | Same user, other business | — | Stream for the new business only; 403 `CROSS_TENANT_DENIED` for a business the user is not in | Route tests: membership via `users.business_id` or `user_businesses`; DB test: other business's rows not listed | PASS (Jest + DB) | `notification-access.db.test.ts` | — |
| 19 | Tap while the app is closed | — | — | — | No notification can exist while closed | N/A | — | Missing feature |
| 20 | Repeated events / duplicate delivery | Same todo claimed by two sweeps and a BullMQ job; stream overlap window | Run concurrently | One notification per recipient; stream never sends a seq twice; re-fire gets a new seq and a new popup | DB: todo-reminder-sweep (two sweeps + job), notifications-seq (re-fire); unit: window de-dup, heartbeat does not resend | PASS (Jest + DB) | `todo-reminder-sweep.db.test.ts`, `notifications-seq.db.test.ts`, `hub.test.ts` | Low-stock overlap stays open (N-04) |
| 21 | Tap routing (in-app) | Bell row for each kind | Click | Opens the record | Unit: 13 mappings including the 8 added; `quantity_request` stays null (no page) | PASS (Jest) / BLOCKED (browser click) | `notification-href.test.ts` | N-02 fixed |

## How to run the blocked browser pass later

1. Start `khatario-hub-testdb-3015` from `.claude/launch.json` (or any config on `kh_phase2_test`) when a server slot is free.
2. Sign in as the local test user (`LOCAL_TEST_PHONE` / `LOCAL_TEST_PASSWORD` in `.env`, Map Test Shop) and keep the dashboard open.
3. On `kh_phase2_test`: `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id) VALUES ('<Map Test Shop id>', 'general', 'Audit test', 'heartbeat delivery', 'supply_order', NULL);`
4. Expected: the bell badge increments within 25 s with no reload and no Redis hint; the row appears in the panel. Then insert `type='invoice_viewed', reference_type='invoices', reference_id=<an invoice id>`; expected: the row is clickable and opens `/invoices/<id>`.
5. Delete the two rows afterwards.
