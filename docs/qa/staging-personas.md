# Staging QA personas

Test accounts on `https://staging.khatario.com` only. Every number below is in staging `QA_TEST_PHONES`, so its signup OTP is shown on screen and no WhatsApp message is ever sent to it (`lib/qa-test-phones.ts`). Passwords are in the local `.env` under `QA_STAGING_PASSWORD` (one shared password for every QA persona). Never use these numbers or names on production.

Every QA business name starts with `QA ` so the rows can be found and removed later.

Reserved range: `9000011001`–`9000011060`.

| Phone | Persona | Business | Role | Status |
| --- | --- | --- | --- | --- |
| 9000011001 | Retailer A owner | QA Retailer Andheri (Maharashtra, regular GST, kirana) | Primary admin | CREATED 2026-10-27 (browser signup) |
| 9000011002 | Retailer B owner | QA Retailer Bengaluru (Karnataka, regular GST) | Primary admin | CREATED 2026-10-27 (signup API) |
| 9000011003 | Wholesaler owner | QA Wholesale Bhiwandi (Maharashtra, regular GST) | Primary admin | CREATED 2026-10-27 (signup API) |
| 9000011004 | Composition dealer | QA Composition Pune (Maharashtra, composition) | Primary admin | CREATED 2026-10-27 (signup API) |
| 9000011005 | Unregistered shop | QA Unregistered Nashik (no GSTIN) | Primary admin | CREATED 2026-10-27 (signup API) |
| 9000011011 | Accountant | QA Wholesale Bhiwandi | Staff | CREATED 2026-10-27 (UI, Accountant role, EMP001) |
| 9000011012 | Cashier | QA Wholesale Bhiwandi | Staff | CREATED 2026-10-27 (API, Sales role, EMP002) |
| 9000011013 | Manager | QA Wholesale Bhiwandi | Staff | CREATED 2026-10-27 (API, Inventory Manager role, EMP003) |
| 9000011014 | Read-only | QA Wholesale Bhiwandi | Staff | CREATED 2026-10-27 (API, custom role "QA Read only", EMP004) |
| 9000011021–9000011028 | Employees | QA Wholesale Bhiwandi | HR employee | CREATED 2026-10-27 (API, attendance only, EMP005–EMP012) |
| 9000011031 | Store customer | — | Storefront buyer | NOT CREATED as a storefront account. Used as the phone of the walk-in customer records at the composition and unregistered shops. |
| 9000011041–9000011043 | Plan personas (free, trial, paid) | QA Plan Free / Trial / Paid | Primary admin | NOT CREATED |

Business settings set on 2026-10-27 (Retailer A through Settings → Business profile in the browser, the others through `PATCH /api/business/[id]` with the owner's own login, `tmp-qa/staging-persona-profiles.mjs`). The GSTINs are made up with a valid checksum.

| Business | GST type | GSTIN | State |
| --- | --- | --- | --- |
| QA Retailer Andheri | regular | 27AQAPA1001A1Z7 | Maharashtra (27), Mumbai 400058 |
| QA Retailer Bengaluru | regular | 29AQAPB1002B1ZZ | Karnataka (29), Bengaluru 560001 |
| QA Wholesale Bhiwandi | regular | 27AQAPW1003W1ZA | Maharashtra (27), Bhiwandi 421302 |
| QA Composition Pune | composition | 27AQAPC1004C1ZY | Maharashtra (27), Pune 411005 |
| QA Unregistered Nashik | unregistered | — | Maharashtra (27), Nashik 422005 |

Remaining numbers are spare.
