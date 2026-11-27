# Masters India e-way bills: staging checklist

Run on `https://staging.khatario.com` by the owner, against the Masters India SANDBOX only. Nothing here has been seen in a browser yet, so note anything that looks odd even if it works. "Expected" says what you should see.

## 1. Before you start

1. Apply migration `database/migrations/477_eway_bills_gsp.sql` to the staging database. This needs your approval and must happen BEFORE the new code goes live: even a hand-typed e-way bill now writes the new columns and fails without it. Expected: the migration finishes with no error.
2. Add `MASTERSINDIA_BASE_URL=https://sandb-api.mastersindia.co/api/v1` to staging's `.env.production`, then deploy and restart the app. Expected: the app starts normally. Never put the sandbox address on production; production needs the production address from Masters India (not issued yet) and fails every call with "not set up on this server" if it is missing.
3. Make sure the staging plan you test with includes the `eway_bill` feature. Expected: Generate e-way bill is visible on a final invoice.
4. Use the sandbox login from Masters India (the one in your `.env.local` notes). Do not paste it anywhere except the connect page.
5. The sandbox knows two GSTINs for e-way bills: `05AAABB0639G1Z8` and `05AAABC0181E1ZE`. Set the staging test business's GSTIN to one of them and give the test customer the other. Expected: invoices from this business to this customer can be accepted by the portal. Any other GSTIN is rejected (see step 6.3).
6. Have these test documents ready (each bill uses up one document, so make them all before you start):
   - 8 ordinary final invoices: one over 50,000 (3.1 to 3.3), one under 50,000 (3.1), one each for 3.4 (Part A only), 3.6 (rail), 3.10 (distance 0), 5.2 (rail change of vehicle), 5.3 (extend) and 5.4 (close);
   - 1 final invoice whose number is longer than 16 characters (3.7);
   - 1 final invoice shipped to the customer's saved shipping address, which differs from the billing address (3.8);
   - 1 final invoice with a typed shipping address that is not saved on the customer (3.9);
   - 1 draft invoice (3.1, no Generate button);
   - 1 sent delivery challan (3.5).
   The bill from 3.3 is reused for 4.1 to 4.3 and cancelled in 5.1.

## 2. Connect

1. Open Settings → Integrations → "GST e-invoice and e-way bill (Masters India)". Expected: the page opens and shows it is not connected.
2. Enter the sandbox username with a WRONG password and save. Expected: a clear refusal and the page still shows not connected. Reload to check nothing was saved.
3. Enter the right sandbox login and save. Expected: the page shows connected.

## 3. Generate

1. Open the final invoice over 50,000. Expected: a line about the 50,000 limit, a Generate e-way bill button, and a link "Generated it on the portal? Enter the number" under it. Under 50,000 the line is not shown. On the draft invoice there is no Generate button.
2. Click Generate with an empty distance, vehicle `KA1234`, and a 10-character transporter GSTIN, one at a time. Expected: each shows its own message under its field and your typed values stay.
3. By road, valid vehicle number, valid distance. Expected: a message with the new e-way bill number; the page reloads showing it.
4. On another final invoice, choose road, leave the vehicle empty and enter a transporter GSTIN (Part A only). Expected: the bill is generated.
5. Open the sent delivery challan and generate from there. Expected: the Generate button is only there once the challan is Sent or Delivered; the bill is generated and shown on the challan.
6. On another final invoice choose Rail, enter a transport document number and date, no vehicle. Expected: the bill is generated. Rail, air and ship need the document number and date; leaving them empty shows a message on each.
7. Try an invoice whose number is longer than 16 characters. Expected: refused with the 16-character limit named.
8. On the invoice with a shipping address different from the billing address (Bill To Ship To), generate and open the portal print. Expected: transaction type 2.
9. On the invoice whose typed shipping address is not the customer's saved one, press Generate. Expected: a message asking for ship-to city, PIN code and state, and three extra fields. Fill only the city: "Enter the ship-to city, PIN code and state together". PIN `5700`: "Enter a 6-digit PIN code". Fill all three: the bill is generated.
10. Generate with distance 0. Expected: accepted.
11. "Download portal file instead" shows only once a valid distance is typed. Expected: it downloads a JSON file.

## 4. After generating

1. Look at the invoice and the challan that now have a bill. Expected: the e-way bill number, its validity date and a Print link are shown; Print opens the portal's PDF in a new tab. The Generate button is gone, and does not flash on briefly while the page loads.
2. Open the e-way bills page (`/eway-bills`). Expected: the row shows Print, Cancel, Change vehicle, Extend and Close as they apply.
3. Click Generate fast twice, then try again on the same document from a second tab. Expected: only one bill exists afterwards; the second try shows a message and the form keeps what you typed.

## 5. Actions

1. Cancel a bill within 24 hours of generating it, pick a reason. Expected: the row shows cancelled, and the e-way bill number is gone from the invoice's own e-way bill field and its print. Open that invoice: Generate is offered again, and generating again works and gives a NEW e-way bill number (the sandbox allows a new bill on a cancelled document number).
2. Change vehicle on a road bill: place and state are needed, and a vehicle number. Expected: the row updates. The button is not offered on an expired row.
   Rail case: on the bill from the rail invoice (3.6, or any bill), open Change vehicle and choose Rail. Expected: the vehicle number field goes away and "Transport document number" and "Transport document date" show instead, next to the reason, place, state and remarks. Leave the document number empty: "Enter the transport document number and date". Fill both and save: the change is saved with no error (before this fix it said the change was made on the portal but not saved).
3. Extend: offered only while the register allows it (from 8 hours before the bill expires to 8 hours after), so this needs a bill close to its expiry. It asks for place, state, PIN code, distance left and a reason. For rail, air or ship it also asks for the transport document number and date. With "Where the goods are" set to in transit or in a warehouse, the vehicle number is optional. Expected: the validity date moves out. Outside that window you should get a clear message.
4. Close a bill: remarks are needed. Expected: the row shows closed.
5. A hand-typed bill (recorded with a number from the portal) has no action buttons in the register, and still saves as before.
6. A bill past its validity that was never closed: open its invoice. Expected: the bill line shows, with a note "This e-way bill has expired. Extend it within 8 hours of expiry from the e-way bills page, or close it there." and a link; no Generate button. Close is still offered on its row.

## 6. Limits and errors

1. If a limited plan is available on staging (the Growth plan allows 10 e-way bills a month), put the test business on it and generate bills until the limit. Expected: the eleventh is stopped with the plain limit message. Skip this step if no limited plan is set up.
2. Disconnect Masters India, then press Generate. Expected: a message asking you to connect, with a Connect Masters India button that opens the connect page; typed values are still there when you come back.
3. Use a business whose GSTIN is not in the Masters India account. Expected: the portal's own rejection text, followed by "(GSTIN ...)" naming your GSTIN; Khatario adds the GSTIN part, not the portal.

## 7. Not confirmed by the sandbox: check before production

The sandbox accepts many spellings that the live portal may not, so a clean run here does not prove these.

1. Cancel reasons other than "Others" (Duplicate, Order Cancelled, Data Entry Mistake): they were never accepted on a fresh bill in the sandbox.
2. The vehicle type for over-dimensional cargo: the app sends `ODC`; the sandbox accepted both `ODC` and `Over Dimensional Cargo`.
3. Change vehicle (Part B): the app sends the data source and the mode as text; the sandbox test sent them differently. Confirm a change vehicle works with a real mode.
4. A repeated document number: the sandbox returns the existing bill instead of a rejection, and the app treats that as success. Check whether the live portal rejects it (NIC 604) or returns the existing bill. The app handles both, but only the sandbox behaviour has been seen.
5. Extend was never exercised against the sandbox at all.
6. Whether the live portal lets a cancelled document number get a new e-way bill. The sandbox gives a new number (probe of 2026-11-27); if the live portal refuses, Generate after a cancel will show the portal's message.

## 8. Known limits

1. Cancelling a bill clears its number from the invoice or challan's own e-way bill field. A different number typed there by hand is left alone.
2. A double click on an action button can send two requests to the portal. For cancel and close the second is refused by the portal. For extend the second may be accepted, extending the bill twice, so do not double click Extend. This stays open until before production.
3. These screens were type-checked and their logic tested, but they have not been seen in a browser before this checklist. Hand-typed bills cannot be cancelled or extended from the register.
4. Pricing and production go-live terms with Masters India are still open.
