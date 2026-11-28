# E-invoices (IRN): staging checklist

Run on `https://staging.khatario.com` by the owner, against the Masters India SANDBOX only. Nothing here has been seen in a browser yet, so note anything that looks odd even if it works. "Expected" says what you should see.

## 1. Before you start

1. Plan 1's checklist (`2026-11-27-gsp-connection-eway-bills-staging-checklist.md`) must have passed first. Expected: Masters India shows connected and an e-way bill can be generated.
2. Apply migration `database/migrations/478_einvoice_irn.sql` to the staging database. This needs your approval, and a person must run it (agents never run migrations on staging or production). It must happen BEFORE the new code goes live: the invoice pages read the new columns and fail without them. Expected: the migration finishes with no error.
3. Warning about the migration: it builds a unique index on the `invoices` table with a plain `CREATE UNIQUE INDEX`. While it builds, nobody can save an invoice. On a small staging database that is a moment, but run it at a quiet time, and remember this when it is applied to production.
4. Deploy and restart the app. Expected: the app starts normally. `MASTERSINDIA_BASE_URL` is already set from Plan 1; it must still point at the sandbox.
5. Make sure the staging plan you test with includes both the `e_invoice` and the `eway_bill` features. Expected: the E-invoice box shows on a final invoice (step 3.1).
6. Use the sandbox login from Masters India (the one in your `.env.local` notes). Do not paste it anywhere except the connect page.
7. The sandbox knows two GSTINs for e-invoices. They are in `.env.local` as `MASTERSINDIA_SANDBOX_EINVOICE_GSTIN` (the seller) and `MASTERSINDIA_SANDBOX_EINVOICE_BUYER_GSTIN` (the buyer). Set the staging test business's GSTIN to the seller one and give the test customer the buyer one. Expected: invoices from this business to this customer can be accepted by the portal. Any other GSTIN is rejected (see step 7.3).
8. Every item on the test invoices needs a 6-digit HSN code. The e-invoice portal does not accept a 4-digit code. Step 3.3 uses one item with a 4-digit code on purpose.
9. Have these test documents ready (each e-invoice uses up one document number on the sandbox, so make them all before you start). All are final B2B invoices to the test customer, dated after the start date, unless said otherwise:
   - 1 draft invoice (3.1);
   - 1 invoice dated before the start date (3.2);
   - 1 invoice with an item that has a 4-digit HSN (3.3);
   - 1 invoice to a customer with no GSTIN, so it is B2C (3.6, 4.10);
   - 1 export invoice (4.11);
   - 1 invoice with goods over 50,000 (4.1);
   - 1 for the double click (4.2), 1 for the wrong distance (4.3), 1 for the e-way bill made later (4.4);
   - 1 for the plain cancel (5.5), 1 for cancel then try again (5.8), 1 for the e-way bill and cancel sequence (5.6);
   - 1 e-invoice generated more than 24 hours ago (5.9). If you have none, generate one today and do that step tomorrow;
   - 1 stock transfer between two branches that makes a branch invoice, with an active e-invoice on it (5.4);
   - 1 invoice kept for printing on every template (section 6).

## 2. Set the start date

1. Open Settings → Integrations → "GST e-invoice and e-way bill (Masters India)". Scroll to the "E-invoicing" box. Expected: it lists your GSTIN (and one line per branch GSTIN, if any) with a date field "E-invoicing applies from".
2. For the sandbox GSTIN, pick a date a few days ago and press Save. Expected: "Saved." and the date is still there after you reload.
3. Clear the date and Save again, then open a B2B final invoice. Expected: no E-invoice box. Set the date back to a few days ago before continuing.

## 3. What the invoice page shows

1. Open the draft invoice, then the final B2B invoice dated after the start date (`/invoices/<id>/view`). Expected: the draft has no E-invoice box. The final invoice has a red "E-invoice pending" badge, the line "This invoice is not valid for your customer's tax credit until its e-invoice is generated." and a Generate e-invoice button.
2. Open the invoice dated before the start date. Expected: no E-invoice box at all.
3. Open the invoice with the 4-digit HSN item. Expected: under "Fix these before generating the e-invoice:" a line "Use the 6-digit HSN code for <item name>. E-invoices do not accept shorter codes." with a Fix link, and the Generate button is greyed out.
4. Press the Fix link. Expected: it opens that item. Change its HSN to 6 digits, save, and come back to the invoice. Expected: the problem is gone and Generate works. If the problem is still listed after you fixed the item, the invoice may keep its own copy of the code: note this (not checked).
5. Check the other problems the box can list, if you can set them up cheaply: a customer with no address or PIN code, or no state; each one should show a Fix link to the customer.
6. Open the B2C invoice. Expected: no E-invoice box, and under the e-way bill box there is NO line "E-invoice is on for this plan. Generate it from the invoice once it is final."
7. Open the B2B invoice again before generating. Expected: while it is pending, that "E-invoice is on for this plan" line is shown under the e-way bill box. Once the e-invoice exists (next section) the line is gone.
8. If Masters India is not connected, press Generate. Expected: a message asking you to connect and a Connect Masters India button that opens the connect page. Connect again afterwards.

## 4. Generate

1. Open the invoice with goods over 50,000. Expected: a ticked "Also create the e-way bill" with the transport fields below it. Untick and tick it: the fields hide and show. Leave the distance empty and press Generate. Expected: a message under the distance field, and nothing is sent. Fill a valid distance and vehicle number, then Generate. Expected: a green "E-invoice generated" badge, the IRN (64 characters), Ack No, Ack Date (DD/MM/YYYY) and a QR code. The e-way box now shows a new bill, and `/eway-bills` lists it as generated through the IRN.
2. On another invoice, double click Generate quickly. Expected: only one IRN exists afterwards (the button greys out while it works).
3. On another invoice, tick "Also create the e-way bill" and type a distance the portal will refuse (for example 5000). Expected: the e-invoice is generated, and a warning under it says the e-way bill could not be made. No e-way bill is shown for this invoice. If the portal accepts your distance, note that.
4. On another invoice, generate without the e-way bill. Then open its e-way box and press Generate e-way bill. Expected: the bill is created (it goes through the IRN) and `/eway-bills` shows it as generated through the IRN. The number field in the e-way box is never empty after that.
5. Save the e-way box after a bill was created. Expected: the number stays on the invoice and on its print; it is not blanked.
6. Open `/invoices/<id>/view` again after a reload. Expected: IRN, Ack No, Ack Date and QR are still there.
7. Open the History tab of an e-invoice. Expected: an entry for the e-invoice being generated.
8. Make the portal refuse a generate (for example, give the customer a wrong buyer GSTIN). Expected: a red box with the portal's own words, starting "E-invoice portal:". There is no "Last attempt:" line next to it while the box shows. After a reload, "Last attempt:" shows the stored refusal.
9. Try the same invoice number twice: generate, then in a second browser tab (opened before) press Generate on the same invoice. Expected: a message that the invoice already has an e-invoice; still one IRN.
10. A B2C invoice: Expected, no way to generate (no box).
11. Press Generate for an export invoice (a customer set up as an export customer). Expected: it generates without typing buyer details. If the box lists a problem instead, note the exact wording.

## 5. After generating

1. Open the invoice's detail page (`/invoices/<id>`). Expected: Amend and Cancel Invoice are greyed out. Hover over them (or on a phone press the pencil on the view page): "This invoice has an e-invoice (IRN), so it cannot be changed. Cancel the e-invoice within 24 hours, or issue a credit note."
2. Try to edit the invoice another way (open the edit page from a bookmark, if you have one). Expected: saving is refused with the same message.
3. Record a payment on the invoice. Expected: it works. Payments are not locked.
4. Cancel a stock transfer whose branch invoice has an active e-invoice. Expected: refused with the same lock message.
5. Cancel e-invoice, within 24 hours: press Cancel e-invoice. Expected: a window with a Reason list (Duplicate, Data entry mistake, Order cancelled, Other), a Remarks box (required, up to 100 characters) and the line "After cancelling, this invoice number cannot be used for another e-invoice." Pressing the button with no reason or no remarks shows a message and sends nothing. Choose a reason, add remarks, confirm. Expected: a grey "E-invoice cancelled" badge, "Cancelled on <date>. Reason: ...", no Generate button.
6. On an invoice that has an active e-way bill: press Cancel e-invoice. Expected: it says to cancel the e-way bill first. Cancel the bill on `/eway-bills`, then cancel the e-invoice, then (once the e-invoice is cancelled) the invoice itself can be cancelled.
7. After step 5, Amend and Cancel Invoice: Expected: no longer locked by the e-invoice. (Whether an invoice should be amended after its e-invoice is cancelled is still an open question, see the brief.) Do not generate again.
8. On an invoice whose e-invoice was cancelled, try to generate again by any means (a second tab opened before cancelling). Expected: refused with "The e-invoice for this invoice was cancelled. The portal does not give a new e-invoice on the same invoice number. Make a new invoice instead."
9. Open an e-invoice generated more than 24 hours ago. Expected: no Cancel e-invoice button; a "Check status on the portal" link appears instead. Press it. Expected: either "The portal still shows this e-invoice as active, or it could not be checked.", or, if you cancelled it on the sandbox portal yourself, the badge turns to cancelled.
10. Try to cancel an e-invoice after 24 hours by any other means (for example an old tab with the window open). Expected: "An e-invoice can be cancelled only within 24 hours. Issue a credit note instead."

## 6. Printing

For each of the invoices below, use Print or Download PDF on an invoice with an active e-invoice. Expected on every template: a QR code about 3 cm square, "IRN:" with the whole 64-character number wrapping inside the page, "Ack No:" and "Ack Date:". Check the block is not cut off at a page edge and does not cover other text. Also check that an invoice with no e-invoice looks as before and is still one page.

1. The seven A4 sales templates. Where the block should sit:
   - `gst_standard` (the default): after the items table, just before the HSN summary;
   - `modern`: right after the items table, before the HSN summary and totals;
   - `classic`: after the items table, before the HSN summary;
   - `elegant`: after the items table, before the HSN summary and the totals box;
   - `minimal`: after the items table, before the HSN summary and the totals;
   - `business_pro`: after the items table, before the HSN summary and the total section;
   - `gst_detailed`: after its tax breakdown table, just before the totals grid.
2. Other templates that carry it: `tally_style`, `distributor`, `export_invoice`, the bill of supply templates (composition standard, composition modern, tax exempt), and the thermal ones (`thermal_80mm`, `thermal_58mm`). On thermal paper the IRN is printed in short pieces of 32 characters.
3. Not covered yet: credit note, debit note, delivery challan, work order and the other documents. They do not print the IRN. Do not test them.
4. Cancel the e-invoice and print the same invoice again. Expected: no IRN block, no QR.
5. If you have a Bluetooth printer connected: IRN lines and QR appear on the receipt only while the e-invoice is active.

## 7. Limits and errors

1. If a limited plan exists on staging with a monthly e-invoice cap, put the test business on it and generate until the limit. Expected: the next one is stopped with "You have reached this month's e-invoice limit for your plan. Upgrade your plan to generate more." and the upgrade window opens. On the plans set up today, every plan with the e-invoice feature is unlimited, so skip this unless you set a number first (not checked on staging).
2. Use a plan without the e-invoice feature. Expected: no E-invoice box on the invoice. If it is reached some other way: "E-invoices are not part of your plan. Upgrade your plan to use them."
3. Use a business whose GSTIN is not one of the two sandbox GSTINs. Expected: the portal's own rejection text, starting "E-invoice portal:".
4. Disconnect Masters India, then press Generate. Expected: a message asking you to connect and the Connect Masters India button (see 3.8).

## 8. Scan the QR

1. Print or open the PDF of one e-invoice and scan its QR with the government's e-invoice QR verification app. Expected: it reads the QR and shows the invoice number, date and IRN. The QR holds about a thousand characters, so also check it scans from the printed paper at the normal size, and from the thermal print.
2. Note which template and paper size you scanned. The sandbox QR may not verify in the government app because the sandbox is not the live portal: write down what the app said either way.

## 9. Not confirmed by the sandbox: check before production

The sandbox is not the live portal, so a clean run here does not prove these.

1. A repeated document: the sandbox returns the same IRN with a note instead of refusing. Check what the live portal does (it may refuse with code 2150). The app handles both, but only the sandbox behaviour has been seen.
2. Cancel reasons: the app sends the four reasons; only one was tried on the sandbox. Check all four on the live portal.
3. Whether the e-way bill made with the IRN carries a different ship-to address. The app sends only the distance and the transport details, so it goes to the invoice's own address.
4. Whether the QR scans from paper (step 8).
5. Whether generating again after a cancel is really refused by the live portal (the app refuses it before asking).
6. The sandbox returned some fields empty on a repeat (the PDF link, the request number). Khatario does not need them today.

## 10. Known limits

1. An e-invoice is cancelled only within 24 hours. After that, use a credit note.
2. Credit and debit notes do not get an IRN yet (Plan 3).
3. Khatario does not yet claim the invoice while a request is in flight. A double click is stopped on the screen, but two quick requests from two tabs can both reach the portal, and a monthly limit could be passed by one. The sandbox answers a repeat with the same IRN, so no second IRN appeared in testing. This stays open until before production.
4. The e-way bill box's Save with an empty number can still clear the number on the invoice even while an API-made e-way bill is active. It is the old box's behaviour and has no server check yet, so do not save the box with the number field emptied.
5. These screens were type-checked and their logic tested, but they have not been seen in a browser before this checklist.
6. Pricing and production go-live terms with Masters India are still open.

## If something goes wrong

Write down, before you do anything else:

1. The invoice number.
2. The exact message on the screen (a photo of the screen is fine).
3. The time it happened, so the app's records can be found.
4. What you pressed just before.

Do not press Generate again straight away. Wait a minute, reload the page, and look at whether the badge changed: the portal may have created the e-invoice even though the screen showed an error. If the page still shows "E-invoice pending" after a few minutes, press Generate once more; Khatario looks the invoice up on the portal first and picks up an e-invoice that already exists.
