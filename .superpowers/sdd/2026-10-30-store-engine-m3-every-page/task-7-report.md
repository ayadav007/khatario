# Task 7 report

Implemented seven sections (collection-list, logo-list, video, faq, newsletter, countdown, spacer): schemas, server components, small client components (EngineCountdown, EngineNewsletterForm, EngineVideoCover, EngineCollectionList in EngineViews), CSS in EngineShell THEME_RULES, registry entries, Contact starter gets an faq (3 questions).
- `videoEmbedUrl` in lib/store/engine/shared.ts; `countdownParts` in sections/countdown-logic.ts.
- D19: validator did not restrict topics but required name/phone/topic list. `validateEnquiry` now short-circuits `topic === 'newsletter'` (after honeypot): email required+valid, name 'Newsletter subscriber', no phone, fixed message. The route accepts newsletter even if the contact form is disabled (body parsed before the enabled check). Other topics unchanged.
- collection `category` setting has no default (sanitizer rejects '' for category type).
- registry.test count 20 -> 27.

## TDD
RED: `npx jest tests/lib/store/engine/new-sections.test.ts tests/lib/store/enquiry.test.ts` -> 2 suites failed (missing exports/schemas; newsletter rejected for missing name). GREEN: `npx jest tests/lib/store` -> 76 suites, 708 tests pass. `npx tsc --noEmit` clean.

## Browser check (:3015, ganesh, test DB)
Appended one of each to live home, store_engine on. curl 200: all sections rendered (collection tiles incl. custom title, unknown category skipped, /catalog/<id> hrefs; logos; youtube-nocookie iframe; faq details with script stripped; newsletter form; spacer 80px/16px). Countdown verified in browser pane: ticks each second. POST newsletter -> {"success":true}, store_enquiries row topic newsletter, name 'Newsletter subscriber', email only; invalid email -> 400 "Enter a valid email". Row deleted, home restored, store_engine back to false.

## Concerns
- Countdown renders nothing in SSR HTML (client clock), appears after mount.
- Collection tiles use server-rendered href without preview params; click goes through useCatalogNav (keeps them).
- Newsletter shares the enquiries rate limit (3 per 10 min per visitor).

## Fix round 1
Issue: video iframes had no sandbox. Added `EMBED_SANDBOX` ('allow-scripts allow-same-origin allow-presentation', same as html.ts) to lib/store/engine/shared.ts; used on the iframe in Video.tsx (keeps loading=lazy) and EngineVideoCover.tsx (click-to-play, now also loading=lazy). No allow-popups added.
Covering test: new-sections.test.ts "video embed sandbox" (constant equals what sanitizeCustomHtml forces; both component sources use it). `npx jest tests/lib/store`: 76 suites, 709 tests pass; tsc clean.
Not done: live browser play-after-click check (TSX is not renderable in jest; no browser check run this round).
