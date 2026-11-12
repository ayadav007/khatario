# Courier plugins Phase 1: staging checklist

Run on `https://staging.khatario.com` by the owner, after migration 476 is applied (owner approval) and the code is deployed. Order: migration first, then code, then re-run the migration's copy `INSERT ... ON CONFLICT DO NOTHING` once (step 15). Nothing here has been seen in a browser yet.

1. A business that had Shiprocket before the deploy shows "Connected" on the Shiprocket card, without re-entering anything.
2. Settings → Integrations → Shipping shows Shiprocket plus five "Coming soon" cards.
3. Overview, Setup and FAQ tabs read correctly on a phone and in dark mode.
4. A wrong password shows the rejection message and the card stays as it was.
5. The correct API user saves and shows "Connected".
6. Changing only the email with the password left blank saves.
7. Generate a webhook token, paste it into Shiprocket, save; a tracking update on a test parcel moves the order.
8. Book one parcel from Orders; print its label; generate a manifest.
9. Start a return pickup on a delivered order.
10. Online-store settings: the Shiprocket form is gone; the "Delivered by" dropdown offers Shiprocket.
11. Disconnect with a parcel in transit is refused with a count.
12. After the parcel is delivered, Disconnect works; the card shows "Connect"; "Delivered by" is back to "Own staff"; booking from Orders says to connect Shiprocket under Integrations.
13. Phone app: Settings shows the Shiprocket status correctly and saving the API user there still works.
14. A staff user without settings-update permission sees the plugin page but no form.
15. Re-run the copy `INSERT` from migration 476; nothing changes.
