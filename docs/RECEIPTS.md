# Admin receipt generator

16 November 2026. The GitHub admin page now includes a general-purpose receipt editor and saved receipt history. This is separate from uploaded payment proofs and does not change booking, payment-verification or refund records.

## Published release

- Live at https://living.igniteinnov.com/admin.html, reached through the main page's footer Admin login.
- Production public Apps Script deployment updated to **version 10** at 10:13 MYT, keeping its URL, execute-as-owner setting and audience. The separate version-7 owner deployment was not changed. Saved AdminApi, ReceiptModel and IssuedReceipts source matched the reviewed generated files exactly.
- PR #8 merged as `3ca8b79604a24ae3dcb1b019457345a942ec317e`. Follow-up `222ea8919232b48bfbfe266d8d155e3ba84ef957` versions the admin assets so a cached pre-receipt script cannot leave the new tab inactive. Pages runs `43790896130` and `43791238743` both succeeded.
- Real owner Google sign-in succeeded on the published release. The Receipt generator tab opened; its authenticated register read returned zero saved receipts. A local-only sample draft correctly showed RM1,700 stay payments, RM150 security deposit held, RM1,850 net received and no outstanding stay balance. The logo placeholder and no-signature text were visible. No number was assigned.
- Sign-out cleared the sample draft and printable customer data. The admin page was left ready for the owner to sign in. No production receipt, booking, payment or refund record was created or changed during acceptance.

## Owner workflow

1. Open the main page's footer **Admin login**, sign in, and choose **Receipt generator**.
2. Enter customer name, handphone, property/stay description, check-in/check-out dates, payment date, method and optional reference.
3. Enter charges, discount, payments already received and any refunds already made. A booking deposit is part of stay payments. A refundable security deposit is separate.
4. Optionally enter notes or enable a returning-customer promotion. No promotion is printed by default.
5. Preview A4, confirm the entered figures, then **Save & issue receipt**. Only saving assigns a number.
6. **Print / Save PDF**, using A4 paper. Saved receipts can be searched and reopened for reprinting with the original number and details.

The document has a logo placeholder and states that no signature is required. All money uses MYR/RM and integer-sen calculations. Receipt numbers follow `ILR-YYYY-NNNNNN`, with the year determined at issue time in Malaysia.

## Persistence and recovery

- `IssuedReceipts` in the existing private spreadsheet stores five columns: receiptNumber, requestId, savedAt, savedBy and receiptJson. The first real issue creates the sheet. Reading an empty register does not create it.
- Each row stores an immutable versioned snapshot of the entered details, calculated totals, issuer, owner and issue timestamp. Customer text is encoded inside JSON, never inserted as a spreadsheet formula.
- A shared script lock serializes number assignment and row writes. Script Properties `RECEIPT_LAST_<year>` reserve a high-water counter before writing; failed writes can leave gaps, but used/reserved numbers are not reused even if a sheet row is removed.
- A UUID identifies each issue request. Repeating the same UUID and normalized details returns its original receipt. Changing an already-used payload is refused. The browser prevents duplicate clicks and offers **Retry same receipt** after an uncertain response, keeping its original UUID and payload.
- After a lost response, retry the same request or search Saved receipts before creating another receipt for that payment. Reloading clears the in-memory draft/retry state. There is no browser storage of customer details or credentials.
- Saved receipts are read-only in this first version. No edit, delete, void, auto-email or automatic promotional offer is included.
- Preserve both the register and the yearly Script Properties during backup, migration or rollback. Do not reset counters or delete rows to correct a receipt. Rolling back the API/frontend must retain already-issued data.

## Backend installation

The release builder adds `ReceiptModel.gs` (from the same pure calculation model loaded by the browser), `IssuedReceipts.gs`, and the three authenticated AdminApi dispatch methods `rrList`, `rrGet`, `rrIssue`. All storage helpers are private Apps Script functions. Existing owner authorization, Google token verification, session revocation and spreadsheet ownership checks apply to every endpoint.

No new permission scope, hosting service or database is required. Keep the existing public API URL and deployment access settings. The separate legacy owner deployment is preserved.

## Verification

- 54 default tests: 38 existing customer/admin checks, 10 receipt storage/calculation checks and 6 receipt UI checks.
- 10 signature/authentication/API checks against the exact generated backend, including receipt authorization and owner dispatch.
- 12 existing booking and uploaded-proof retry/recovery checks against the generated backend.
- Seven hosted checks in the isolated staging spreadsheet passed: same-number replay, correct monetary buckets, exact snapshot read-back, search, single durable row, persistent counter and unchanged booking data.
- The actual receipt DOM/CSS rendered to one A4 page with all financial rows, maximum-length customer/property/reference/notes/promotion text. This print-engine check complements browser preview checks; physical printer and Safari output remain user acceptance items.
- No test receipt or financial mutation is submitted in production.
