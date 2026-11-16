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
3. Enter charges, discount, the **Booking deposit received**, the **Balance payment received**, and any refunds already made. For a RM1,400 stay paid as RM300 before arrival and RM1,100 on arrival, enter RM300 as the deposit and RM1,100 as the balance payment. A refundable security deposit is separate.
4. Optionally enter notes or enable **Returning-customer promotions**. Tick any of the 10%, 20%, 30%, 40%, 50% discounts and/or **1 free day**. The free-day offer requires a calendar date from 1 January 2027 onwards and is valid on that date only. Every enabled promotion also includes **Every 3 stays, get 1 free night** and the start date. No promotion is printed when the section is disabled.
5. Preview A4, confirm the entered figures, then **Save & issue receipt**. Only saving assigns a number.
6. **Print / Save PDF**, using A4 paper. Saved receipts can be searched and reopened for reprinting with the original number and details.

The document uses the approved Ignite Living logo and states that no signature is required. All money uses MYR/RM and integer-sen calculations. Receipt numbers follow `ILR-YYYY-NNNNNN`, with the year determined at issue time in Malaysia.

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

## Logo integration — 16 November 2026

The approved orange/blue flame logo is stored unchanged at `assets/brand/ignite-living-logo-v1.png`. Receipt previews and printed copies now use this shared asset. The print button waits for image decoding and reports a load failure without losing the saved receipt. Financial snapshots, numbering and the version-10 backend remain unchanged.

Validation: 56 default tests passed, including delayed/failed logo loads and sign-out during print preparation. The complete receipt rendered on one A4 page with its logo embedded.

## Returning-customer promotion presets — 16 November 2026

The owner can tick 10%, 20%, 30%, 40%, 50% and 1 free day. Multiple selections are retained. The free-day calendar requires a real date on or after **1 January 2027**, and the receipt states that it is valid on that date only. Enabling promotions always adds **Every 3 stays, get 1 free night** and **Valid for stays from 1 Jan 2027 (after Dec 2026)**. Receipt totals are not reduced by these future-stay offers.

The selected offers and exact free-day date are composed into the existing immutable `promotionText` snapshot, within its 200-character limit. The existing version-10 backend persists and reprints them without a redeployment or schema change. Historical receipts retain their original terms. Saved receipts show their stored message; new drafts reset all offer selections. This is a receipt promotion feature: stay counting, entitlement verification and redemption remain manual; no automatic loyalty credits or booking discounts are applied.

Validation: all 60 default tests passed, including all-offer snapshots/printing, invalid and pre-2027 dates, leap-day selection, opt-out, unchanged monetary totals, legacy reprints and draft reset. A worst-case receipt with every offer, all financial rows and maximum-length notes renders on one A4 page. No production receipt or financial record was created for testing.

## Payment labels — 16 November 2026

Renamed “Other stay payments received” to **Balance payment received** in both the form and receipt. The existing `otherPaid` storage field, calculations and receipt numbers are unchanged, so saved receipts remain compatible.

## Final receipt layout and guest review link — 16 November 2026

Every preview and reprint now includes **How was your stay?**, a clickable **Leave a review** link, the printed URL and a local QR asset. Both open `https://living.igniteinnov.com/#leaveReviewHeading`, the existing guest rating/review form. Guests can use their name or post anonymously. No receipt number, name, phone or other customer information is included in the URL or QR. The invitation is independent of any returning-customer promotion.

The form separates total stay charges, payments/refunds and refundable security deposits. Its example makes the RM1,400 = RM300 booking deposit + RM1,100 balance payment workflow explicit. New drafts reset money fields to 0.00. Saved receipts keep their original details and number; the shared presentation adds the review invitation to reprints without changing stored snapshots.

Print preparation waits for both the Ignite Living logo and QR image, refuses an incomplete print if an image cannot load, and permits retry. A4 spacing accommodates all financial rows, all promotion presets and maximum-length customer/property/reference/notes/promotion-heading fields. Print guidance recommends A4, 100% scale and browser headers/footers off.

Validation before publication: **81 automated checks passed**. The actual receipt DOM and all admin styles rendered to one A4 page for both the RM1,400 example and a complete maximum-length sample. PDF links resolved to the correct destination; ZXing decoded the QR from both rendered pages to that same URL. The live destination opened the existing review form with the Mayang Sari property, 1–5 stars and the anonymous option. All issue/print tests used local synthetic records; no production receipt or financial record was created.
