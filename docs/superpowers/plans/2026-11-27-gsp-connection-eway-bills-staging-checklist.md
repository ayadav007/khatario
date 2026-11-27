# Masters India e-way bills: staging checklist

Run on `https://staging.khatario.com` by the owner, against the Masters India SANDBOX only. Nothing here has been seen in a browser yet, so note anything that looks odd even if it works. "Expected" says what you should see.

## 1. Before you start

1. Apply migration `database/migrations/477_eway_bills_gsp.sql` to the staging database. This needs your approval and must happen BEFORE the new code goes live: even a hand-typed e-way bill now writes the new columns and fails without it. Expected: the migration finishes with no error.
2. Add `MASTERSINDIA_BASE_URL=https://sandb-api.mastersindia.co/api/v1` to staging's `.env.production`, then deploy and restart the app. Expected: the app starts normally. Never put the sandbox address on production; production needs the production address from Masters India (not issued yet) and fails every call with "not set up on this server" if it is missing.
3. Make sure the staging plan you test with includes the `eway_bill` feature. Expected: Generate e-way bill is visible on a final invoice.
4. Use the sandbox login from Masters India (the one in your `.env.local` notes). Do not paste it anywhere except the connect page.
5. The sandbox knows two GSTINs for e-way bills: `05AAABB0639G1Z8` and `05AAABC0181E1ZE`. Set the staging test business's GSTIN to one of them and give the test customer the other. Expected: invoices from this business to this customer can be accepted by the portal. Any other GSTIN is rejected (see step 6.3).
6. Have these test documents ready: a final invoice over 50,000, a final invoice under 50,000, a draft invoice, a sent delivery challan, a second final invoice to ship to an address that is not the customer's saved one.

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
10. Generate with distance 0. Expected: accepted, and the portal's own distance is used.
11. "Download portal file instead" shows only once a valid distance is typed. Expected: it downloads a JSON file.

## 4. After generating

1. Look at the invoice and the challan that now have a bill. Expected: the e-way bill number, its validity date and a Print link are shown; Print opens the portal's PDF in a new tab. The Generate button is gone, and does not flash on briefly while the page loads.
2. Open the e-way bills page (`/eway-bills`). Expected: the row shows Print, Cancel, Change vehicle, Extend and Close as they apply.
3. Click Generate fast twice, then try again on the same document from a second tab. Expected: only one bill exists afterwards; the second try shows a message and the form keeps what you typed.

## 5. Actions

1. Cancel a bill within 24 hours of generating it, pick a reason. Expected: the row shows cancelled; open that invoice and Generate is offered again.
2. Change vehicle on a road bill: place and state are needed, and a vehicle number. Expected: the row updates. On a rail, air or ship bill a transport document is needed instead of a vehicle number. The button is not offered on an expired row.
3. Extend: only possible in the 8 hours before or after the bill expires, so this needs a bill close to its expiry (a short-distance bill expires after a day). It asks for place, state, PIN code, distance left and a reason. Expected: the validity date moves out. Outside that window you should get a clear message.
4. Close a bill: remarks are needed. Expected: the row shows closed.
5. A hand-typed bill (recorded with a number from the portal) has no action buttons in the register, and still saves as before.
6. A bill past its validity that was never closed: open its invoice. Expected: the bill line shows, with a note "This e-way bill has expired. Extend it within 8 hours of expiry from the e-way bills page, or close it there." and a link; no Generate button. Close is still offered on its row.

## 6. Limits and errors

1. On a plan limited to 10 e-way bills a month, generate bills until the limit. Expected: the eleventh is stopped with the plain limit message.
2. Disconnect Masters India, then press Generate. Expected: a message asking you to connect, with a Connect Masters India button that opens the connect page; typed values are still there when you come back.
3. Use a business whose GSTIN is not in the Masters India account. Expected: the portal's rejection, with the GSTIN named.

## 7. Not confirmed by the sandbox: check before production

The sandbox accepts many spellings that the live portal may not, so a clean run here does not prove these.

1. Cancel reasons other than "Others" (Duplicate, Order Cancelled, Data Entry Mistake): they were never accepted on a fresh bill in the sandbox.
2. The vehicle type for over-dimensional cargo: the app sends `ODC`; the sandbox accepted both `ODC` and `Over Dimensional Cargo`.
3. Change vehicle (Part B): the app sends the data source and the mode as text; the sandbox test sent them differently. Confirm a change vehicle works with a real mode.
4. A repeated document number: the sandbox returns the existing bill instead of a rejection, and the app treats that as success. Check that the production portal does the same, or that a rejection is handled cleanly.
5. Extend was never exercised against the sandbox at all.

## 8. Known limits

1. A cancelled bill's number stays printed on the invoice or challan until you clear it by hand.
2. A double click on an action can send two requests to the portal; the second is refused with a clear message.
3. These screens were type-checked and their logic tested, but they have not been seen in a browser before this checklist. Hand-typed bills cannot be cancelled or extended from the register.
4. Pricing and production go-live terms with Masters India are still open.
