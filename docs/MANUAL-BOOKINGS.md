# Admin calendar and manual reservations

Open `admin.html`, sign in as the owner, then select **Calendar & manual booking**.

1. Choose the property and month. Reserved nights, active blocked dates and pending requests have separate labels. Pending requests do not reserve nights.
2. Select check-in and check-out on the calendar, or enter the dates. Check-out is exclusive, so back-to-back stays are allowed.
3. Enter guest name, handphone and guest count. Email and notes are optional.
4. Check dates and review the current price, including an eligible dated promotion.
5. Confirm and save. A confirmed reservation is added to the existing Bookings table and the same dates become unavailable to online bookings.

Payments are separate: manual creation records UNPAID, paid amount zero and the full outstanding balance. It does not create a customer account, issue a receipt, accept guest terms or send a message. Upcoming unpaid manual bookings can be cancelled from the calendar after confirming that no money was collected. Cancellation is refused if payment proofs, refunds or stay requests exist. Paid bookings require the existing review/refund process.

Implementation: `backend/ManualBookings.gs` plus four owner-only routes in `AdminApi.gs`: mbList, mbQuote, mbCreate, mbCancel. Keep the current Code.gs and other backend files unchanged. Update the existing public deployment to a new version; retain its URL, execution account and access settings, and leave the separate legacy owner deployment unchanged.

Creation and cancellation use the same project script lock as guest bookings and owner confirmations. Save checks availability and quoted price again under the lock. A UUID and canonical request hash are stored in the same row; lost-response retries recover the original result before rechecking prices/dates. Cancelled reservations remain in the sheet and preserve that identity. The frontend freezes an uncertain save and retries the identical request. Customer text uses textContent in the UI and is escaped against Sheets formulas.

Verification on 19 November 2026: isolated synthetic backend and UI tests, including the current live availability code; desktop and 390px mobile preview. No test booking was added to the production sheet. Preview fixtures are excluded from publication.

Release: public Apps Script deployment updated to version 13 on 19 November 2026; URL and access settings retained. All 107 automated checks passed with the live source integration enabled.
