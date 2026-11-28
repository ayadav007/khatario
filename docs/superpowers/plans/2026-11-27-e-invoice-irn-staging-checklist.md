# E-invoices (IRN): staging checklist

Run on `https://staging.khatario.com` by the owner, against the Masters India SANDBOX only. Nothing here has been seen in a browser yet, so note anything that looks odd even if it works. "Expected" says what you should see.

## 1. Before you start

1. Plan 1's checklist (`2026-11-27-gsp-connection-eway-bills-staging-checklist.md`) must have passed first. Expected: Masters India shows connected and an e-way bill can be generated.
2. Apply migration `database/migrations/478_einvoice_irn.sql` to the staging database. This needs your approval, and a person must run it (agents never run migrations on staging or production). It must happen BEFORE the new code goes live: the invoice pages read the new columns and fail without them. Expected: the migration finishes with no error.
3. Warning about the migration: it builds a unique index on the `invoices` table with a plain `CREATE UNIQUE INDEX`. While it builds, nobody can save an invoice. On a small staging database that is a moment, but run it at a quiet time, and remember this when it is applied to production.
4. Deploy and restart the app. Expected: the app starts normally. `MASTERSINDIA_BASE_URL` is already set from Plan 1; it must still point at the sandbox.
5. Make sure the staging plan you test with includes both the `e_invoice` and the `eway_bill` features. The monthly e-invoice count is unlimited on every plan, so it does not matter when the feature was switched on. Expected: the E-invoice box shows on a final invoice (step 3.1).
6. Use the sandbox login from Masters India (the one in your `.env.local` notes). Do not paste it anywhere except the connect page.
7. The sandbox knows two GSTINs for e-invoices. They are in `.env.local` as `MASTERSINDIA_SANDBOX_EINVOICE_GSTIN` (the seller) and `MASTERSINDIA_SANDBOX_EINVOICE_BUYER_GSTIN` (the buyer). Set the staging test business's GSTIN to the seller one and give the test customer the buyer one. Expected: invoices from this business to this customer can be accepted by the portal. Any other GSTIN is rejected (see step 7.3).
8. The addresses must match those GSTINs. The two sandbox GSTINs are in state 09 (Uttar Pradesh) and state 05 (Uttarakhand); the first two digits of each GSTIN tell you which is which. Give the business address a PIN code from the seller GSTIN's state, and the test customer a PIN code from the buyer GSTIN's state. A PIN code from another state is refused by the portal.
9. Every item on the test invoices needs a 6-digit HSN code. The e-invoice portal does not accept a 4-digit code. Steps 3.3 and 3.4 use one item with a 4-digit code on purpose.
10. Have these test documents ready (each e-invoice uses up one document number on the sandbox, so make them all before you start). All are final B2B invoices to the test customer, dated after the start date, unless said otherwise:
    - 1 draft invoice (3.1);
    - 1 invoice dated before the start date (3.2);
    - 1 invoice with an item that has a 4-digit HSN (3.3, 3.4);
    - 1 invoice with a freight charge whose SAC code has 4 digits, for example 9965 (3.5);
    - 1 invoice to a customer with no GSTIN, so it is B2C (3.7, 4.10);
    - 1 invoice made by converting a sales order or an estimate for the test customer, then finalised (3.9);
    - 1 invoice in a foreign currency, for example USD (3.10);
    - 1 export invoice (4.11);
    - 1 invoice with goods over 50,000 (4.1);
    - 1 for the double click (4.2), 1 for the wrong distance (4.3), 1 for the e-way bill made later (4.4), 1 for the portal refusal (4.8);
    - 1 goods invoice whose shipping address is typed on the invoice and is not saved on the customer (4.12);
    - 1 for the plain cancel (5.5), 1 for cancel then try again (5.8), 1 for the e-way bill and cancel sequence (5.6);
    - 1 e-invoice generated more than 24 hours ago (5.9). If you have none, generate one today and do that step tomorrow;
    - 1 stock transfer between two branches that makes a branch invoice, with an active e-invoice on it (5.4);
    - 1 online store order from a customer whose record carries the buyer sandbox GSTIN, confirmed so its invoice is made (5.11);
    - 1 invoice kept for printing on every template (section 6).

## 2. Set the start date

1. Open Settings → Integrations → "GST e-invoice and e-way bill (Masters India)". Scroll to the "E-invoicing" box. Expected: it lists your GSTIN (and one line per branch GSTIN, if any) with a date field "E-invoicing applies from".
2. For the sandbox GSTIN, pick a date a few days ago and press Save. Expected: "Saved." and the date is still there after you reload.
3. Clear the date and Save again, then open a B2B final invoice. Expected: no E-invoice box. Set the date back to a few days ago before continuing.

## 3. What the invoice page shows

1. Open the draft invoice, then the final B2B invoice dated after the start date (`/invoices/<id>/view`). Expected: the draft has no E-invoice box. The final invoice has a red "E-invoice pending" badge, the line "This invoice is not valid for your customer's tax credit until its e-invoice is generated." and a Generate e-invoice button.
2. Open the invoice dated before the start date. Expected: no E-invoice box at all.
3. Open the invoice with the 4-digit HSN item. Expected: under "Fix these before generating the e-invoice:" a line "Use the 6-digit HSN code for <item name>. E-invoices do not accept shorter codes." with a Fix link, and the Generate button is greyed out.
4. Press the Fix link. Expected: it opens that item. Change its HSN to 6 digits, save, and come back to the invoice. Expected: the problem is gone and Generate works. Generate the e-invoice. Expected: after it is generated, the invoice and its print show the new 6-digit HSN on that line.
5. Open the invoice with the freight charge that has a 4-digit SAC code. Expected: the line "The charge "Freight" on this invoice needs a 6-digit SAC code. It cannot be changed on a final invoice. Cancel this invoice and make a new one." with no Fix link. If the invoice editor did not let you save a 4-digit SAC on the charge, note that and skip this step.
6. Check the other problems the box can list, if you can set them up cheaply: a customer with no address, no city or no PIN code. Expected: each one shows a Fix link to the customer, and after you fix the customer and come back the problem is gone. A customer with no state shows no problem: the state is taken from the customer's GSTIN.
7. Open the B2C invoice. Expected: no E-invoice box, and under the e-way bill box there is NO line "E-invoice is on for this plan. Generate it from the invoice once it is final."
8. Open the B2B invoice again before generating. Expected: while it is pending, that "E-invoice is on for this plan" line is shown under the e-way bill box. Once the e-invoice exists (next section) the line is gone.
9. Open the invoice made from a sales order or estimate. Expected: the E-invoice box shows "E-invoice pending", the same as an invoice made in the invoice editor. Generate it. Expected: green "E-invoice generated".
10. Open the foreign currency invoice. Expected: the line "This invoice is in USD. E-invoices for foreign currency invoices are not supported yet." with no Fix link, and Generate is greyed out.
11. If Masters India is not connected, press Generate. Expected: a message asking you to connect and a Connect Masters India button that opens the connect page. Connect again afterwards.

## 4. Generate

1. Open the invoice with goods over 50,000. Expected: a ticked "Also create the e-way bill" with the transport fields below it. Untick and tick it: the fields hide and show. Leave the distance empty and press Generate. Expected: a message under the distance field, and nothing is sent. Fill a valid distance and vehicle number, then Generate. Expected: a green "E-invoice generated" badge, the IRN (64 characters), Ack No, Ack Date (DD/MM/YYYY) and a QR code. The e-way box now shows the new bill number, and `/eway-bills` lists the bill as active with its actions (Print, Cancel and the others).
2. On another invoice, double click Generate quickly. Expected: only one IRN exists afterwards (the button greys out while it works).
3. On another invoice, tick "Also create the e-way bill" and type a distance between 0 and 4000 that is plainly wrong for the two PIN codes (for example 3900 for two places a few km apart). A distance above 4000 is refused by the form before anything is sent. Expected: the e-invoice is generated either way. The portal may refuse the distance or accept it. If it refuses, a warning under the e-invoice says the e-way bill was not made, and no e-way bill is shown for this invoice. Write down which one happened and the exact warning text.
4. On another invoice, generate without the e-way bill. Then open its e-way box and press Generate e-way bill. Expected: the bill is created (it goes through the IRN), the e-way box shows the new bill number, and `/eway-bills` lists the bill as active with its actions. The number field in the e-way box is never empty after that.
5. Save the e-way box after a bill was created. Expected: the number stays on the invoice and on its print; it is not blanked.
6. Open `/invoices/<id>/view` again after a reload. Expected: IRN, Ack No, Ack Date and QR are still there.
7. Open the History tab of an e-invoice. Expected: an entry for the e-invoice being generated.
8. Make the portal refuse a generate. A change to the customer's GSTIN does not do it: the invoice keeps its own copy of the GSTIN from when it was made. Instead, open Business settings and change the business PIN code to one from a different state (for example 110001, Delhi), then press Generate on the invoice kept for this step. Expected: a red box with the portal's own words, starting "E-invoice portal:". There is no "Last attempt:" line next to it while the box shows. After a reload, "Last attempt:" shows the stored refusal. Put the business PIN code back afterwards. If the portal accepts the wrong PIN code, note that.
9. Try the same invoice number twice: open an invoice in two browser tabs, generate in the first tab, then press Generate from the second tab that still shows the old screen. Expected: a message that the invoice already has an e-invoice; still one IRN.
10. A B2C invoice: Expected, no way to generate (no box).
11. Press Generate for an export invoice (a customer set up as an export customer). Expected: it generates without typing buyer details. If the box lists a problem instead, note the exact wording.
12. Open the goods invoice whose shipping address is not saved on the customer. Expected: the E-invoice box shows "The goods go to an address that is not saved on the customer. Enter where they go." and the fields Ship-to GSTIN (optional), Ship-to city, Ship-to PIN code and Ship-to state. Press Generate with them empty. Expected: "Enter the ship-to city, PIN code and state together" under the city, and nothing is sent. Fill a city, a 6-digit PIN code and the state (with or without "Also create the e-way bill"), then Generate. Expected: green "E-invoice generated". If you also made the e-way bill, it is listed on `/eway-bills` as active; open it on the e-way bill portal and check it goes to the PIN code you typed.

## 5. After generating

1. Open the invoice's detail page (`/invoices/<id>`). Expected: Amend and Cancel Invoice are greyed out. Hover over them: "This invoice has an e-invoice (IRN), so it cannot be changed. Cancel the e-invoice within 24 hours, or issue a credit note." On a phone, the Edit pencil on the view page is greyed out and pressing it does nothing.
2. Try to edit the invoice another way (open the edit page from a bookmark, if you have one). Expected: saving is refused with the same message.
3. Record a payment on the invoice. Expected: it works. Payments are not locked.
4. Cancel a stock transfer whose branch invoice has an active e-invoice. Expected: refused with the same lock message.
5. Cancel e-invoice, within 24 hours: press Cancel e-invoice. Expected: a window with a Reason list (Duplicate, Data entry mistake, Order cancelled, Other), a Remarks box (required, up to 100 characters) and the line "After cancelling, this invoice number cannot be used for another e-invoice." Pressing the button with no reason or no remarks shows a message and sends nothing. Choose a reason, add remarks, confirm. Expected: a grey "E-invoice cancelled" badge, "Cancelled on <date>. Reason: ...", no Generate button.
6. On an invoice that has an active e-way bill: press Cancel e-invoice. Expected: it says to cancel the e-way bill first. Cancel the bill on `/eway-bills`, then cancel the e-invoice, then (once the e-invoice is cancelled) the invoice itself can be cancelled.
7. After step 5, Amend and Cancel Invoice: Expected: no longer locked by the e-invoice. (Whether an invoice should be amended after its e-invoice is cancelled is still an open question, see the brief.) Do not generate again.
8. On an invoice whose e-invoice was cancelled, try to generate again by any means (a second tab opened before cancelling). Expected: refused with "The e-invoice for this invoice was cancelled. The portal does not give a new e-invoice on the same invoice number. Make a new invoice instead."
9. Open an e-invoice generated more than 24 hours ago. Expected: no Cancel e-invoice button; a "Check status on the portal" link appears instead. Press it. Expected: either "The portal still shows this e-invoice as active, or it could not be checked.", or, if you cancelled it on the sandbox portal yourself, the badge turns to cancelled.
10. Try to cancel an e-invoice after 24 hours by any other means (for example an old tab with the window open). Expected: "An e-invoice can be cancelled only within 24 hours. Issue a credit note instead."
11. Generate the e-invoice of the confirmed online store order's invoice, then cancel the order from the orders screen. Expected: refused with the same lock message; the order stays confirmed and its invoice stays final.

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
2. Other templates that carry it: `tally_style`, `distributor`, `export_invoice`, and the thermal ones (`thermal_80mm`, `thermal_58mm`). On thermal paper the IRN is printed in short pieces of 32 characters.
3. Not covered yet: credit note, debit note, delivery challan, work order, custom and designer templates, and the other documents. They do not print the IRN. Do not test them.
4. Cancel the e-invoice and print the same invoice again. Expected: no IRN block, no QR.
5. If you have a Bluetooth printer connected: IRN lines and QR appear on the receipt only while the e-invoice is active.

## 7. Limits and errors

1. Every plan has an unlimited monthly e-invoice count today; the e-invoice feature on the plan is what turns e-invoices on. If you want to see the limit message, set a number for the test plan first. Expected at the limit: "You have reached this month's e-invoice limit for your plan. Upgrade your plan to generate more." and the upgrade window opens. Skip this unless you set a number (not checked on staging).
2. Use a plan without the e-invoice feature. Expected: no E-invoice box on the invoice. If it is reached some other way: "E-invoices are not part of your plan. Upgrade your plan to use them."
3. Use a business whose GSTIN is not one of the two sandbox GSTINs. Expected: the portal's own rejection text, starting "E-invoice portal:".
4. Disconnect Masters India, then press Generate. Expected: a message asking you to connect and the Connect Masters India button (see 3.11).

## 8. Scan the QR

1. Print or open the PDF of one e-invoice and scan its QR with the government's e-invoice QR verification app. Expected: it reads the QR and shows the invoice number, date and IRN. The QR holds about a thousand characters, so also check it scans from the printed paper at the normal size, and from the thermal print.
2. Note which template and paper size you scanned. The sandbox QR may not verify in the government app because the sandbox is not the live portal: write down what the app said either way.

## 9. Not confirmed by the sandbox: check before production

The sandbox is not the live portal, so a clean run here does not prove these.

1. A repeated document: the sandbox returns the same IRN with a note instead of refusing. Check what the live portal does (it may refuse with code 2150). The app handles both, but only the sandbox behaviour has been seen.
2. Cancel reasons: the app sends the four reasons; only one was tried on the sandbox. Check all four on the live portal.
3. Whether the QR scans from paper (step 8).
4. Whether generating again after a cancel is really refused by the live portal (the app refuses it before asking).
5. The sandbox returned some fields empty on a repeat (the PDF link, the request number). Khatario does not need them today.
6. Large quantities with GST-inclusive prices, and service lines with no quantity, have not been sent to the sandbox. Watch for a refusal about the unit price or the total.

## 10. Known limits

1. An e-invoice is cancelled only within 24 hours. After that, use a credit note.
2. Credit and debit notes do not get an IRN yet (Plan 3).
3. Khatario does not yet claim the invoice while a request is in flight. A double click is stopped on the screen, but two quick requests from two tabs can both reach the portal, and a monthly limit could be passed by one. The sandbox answers a repeat with the same IRN, so no second IRN appeared in testing. This stays open until before production.
4. If Generate gets no answer, the invoice shows nothing new. Do not cancel or amend the invoice then; reload, and press Generate once more first (see "If something goes wrong").
5. The e-way bill box's Save with an empty number can still clear the number on the invoice even while an API-made e-way bill is active. It is the old box's behaviour and has no server check yet, so do not save the box with the number field emptied.
6. The buyer's name and address on the e-invoice come from the customer record, not from a billing name changed on the invoice.
7. These screens were type-checked and their logic tested, but they have not been seen in a browser before this checklist.
8. Pricing and production go-live terms with Masters India are still open.

## If something goes wrong

Write down, before you do anything else:

1. The invoice number.
2. The exact message on the screen (a photo of the screen is fine).
3. The time it happened, so the app's records can be found.
4. What you pressed just before.

Do not press Generate again straight away. Wait a minute, reload the page, and look at whether the badge changed: the portal may have created the e-invoice even though the screen showed an error. If the page still shows "E-invoice pending" after a few minutes, press Generate once more; Khatario looks the invoice up on the portal first and picks up an e-invoice that already exists.
