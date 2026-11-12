# Courier plugins Phase 1: staging checklist

Run on `https://staging.khatario.com` by the owner, after migration 476 is applied (owner approval) and the code is deployed. Order: migration first, then code, then, once the new code is live (`pm2 reload`), run `node scripts/run-migration.js database/scripts/476-post-deploy-shiprocket-sync.sql` once against the staging database (step 15; see Migration 476 in `docs/SERVER_INFRASTRUCTURE.md`). Nothing here has been seen in a browser yet.

1. A business that had Shiprocket before the deploy shows "Connected" on the Shiprocket card, without re-entering anything.
2. Settings → Integrations → Shipping shows Shiprocket plus five "Coming soon" cards.
3. Overview, Setup and FAQ tabs read correctly on a phone and in dark mode.
4. A wrong password shows the rejection message and the card stays as it was.
5. The correct API user saves and shows "Connected".
6. Changing only the email with the password left blank sends the new email with the stored password to Shiprocket for a check. Expect the rejection message unless the new email is a real API user with that same password; the stored email stays as it was when it is rejected.
7. Generate a webhook token, paste it into Shiprocket, save; a tracking update on a test parcel moves the order.
8. Book one parcel from Orders; print its label; generate a manifest.
9. Start a return pickup on a delivered order.
10. Online-store settings: the Shiprocket form is gone; the "Delivered by" dropdown offers Shiprocket.
11. Disconnect with a parcel in transit is refused with a count.
12. After the parcel is delivered, Disconnect works; the card shows "Connect"; "Delivered by" is back to "Own staff"; booking from Orders says to connect Shiprocket under Integrations.
13. Phone app: Settings shows the Shiprocket status correctly and saving the API user there still works.
14. A staff user without settings-update permission sees the plugin page but no form and no "Connect" button in the header.
15. Run `database/scripts/476-post-deploy-shiprocket-sync.sql` once after `pm2 reload`, then once more; the second run changes nothing, and step 1's business still shows "Connected".
16. Generate a token, open Setup, come back to Settings: the token is still there.
17. Phone app, on a business with no Shiprocket connection: Orders & delivery → Delivery partner → Shiprocket shows "Add your Shiprocket API user first: Settings → Integrations → Shiprocket on the website, or Online store → Shiprocket in the app." and the switch goes back to Own staff. The login is added in the Shiprocket section of the app's "Online store" screen; on Orders & delivery today only the "Delivery zones" row opens that screen while no connection exists, so note whether that path is easy to find.
