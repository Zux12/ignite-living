# Admin calendar and manual reservations

Open `admin.html`, sign in as the owner, then select **Calendar & manual booking**.

1. Choose the property and month. Reserved dates, active blocked dates and pending requests have separate labels. Pending requests do not reserve nights.
2. Select check-in and check-out on the calendar, or enter the dates. Check-out is reserved too: a 25–27 stay blocks 25, 26 and 27. Pricing still uses two nights. Another stay can start on 28.
3. Enter guest name, handphone and guest count. Email and notes are optional.
4. Check dates and review the current price, including an eligible dated promotion.
5. Confirm and save. A confirmed reservation is added to the existing Bookings table and the same dates become unavailable to online bookings.

Payments are separate: manual creation records UNPAID, paid amount zero and the full outstanding balance. It does not create a customer account, issue a receipt, accept guest terms or send a message. Upcoming unpaid manual bookings can be cancelled from the calendar after confirming that no money was collected. Cancellation is refused if payment proofs, refunds or stay requests exist. Paid bookings require the existing review/refund process.

Implementation: `backend/ManualBookings.gs` plus owner-only routes in `AdminApi.gs`: mbList, mbQuote, mbCreate, mbCancel, mbOpenEdit, mbPreviewEdit and mbSaveEdit. Apply `backend/patches/checkout-day.diff` to the reviewed current private Code.gs; it delegates overlap checks to mbDatesOverlap_. Keep other backend files unchanged. Update the existing public deployment to a new version; retain its URL, execution account and access settings, and leave the separate legacy owner deployment unchanged.

Creation and cancellation use the same project script lock as guest bookings and owner confirmations. Save checks availability and quoted price again under the lock. A UUID and canonical request hash are stored in the same row; lost-response retries recover the original result before rechecking prices/dates. Cancelled reservations remain in the sheet and preserve that identity. The frontend freezes an uncertain save and retries the identical request. Customer text uses textContent in the UI and is escaped against Sheets formulas.

Verification on 19 November 2026: isolated synthetic backend and UI tests, including the current live availability code; desktop and 390px mobile preview. No test booking was added to the production sheet. Preview fixtures are excluded from publication.

Release: public Apps Script deployment updated to version 13 on 19 November 2026; URL and access settings retained. All 107 automated checks passed with the live source integration enabled.

Cancellation correction, 19 November 2026: manual reservations with legacy dated references (`IL-MANUAL-YYYYMMDD-NNN`) now pass the same cancellation checks as UUID references. Calendar eligibility and server validation share one reference check. Cancellation progress, failures and success are displayed beside the form, with an explicit scroll into view. Added regression coverage for legacy references, failed responses, required confirmation and payment protections. All 110 automated checks passed; no production booking was cancelled during verification.

The existing public Apps Script deployment was updated to version 14 with the cancellation correction; deployment URL and access settings were retained.

## Amend an existing stay

Choose **Edit booking** beside an upcoming confirmed stay. The pre-filled form supports guest name, handphone, email, dates and guest count. Existing notes are read-only history; an optional amendment note is appended when saved. Review the changes, tick confirmation, then save. The agreed rental total, deposit, recorded payments, customer ownership, original request identity and issued receipts remain unchanged. There is no automatic repricing.

The backend verifies owner access on open, preview and save. It checks a full booking snapshot, rechecks changed dates under the shared lock, excludes the current booking from conflicts, and refuses date changes while a stay request is pending. Booking changes and an ADMIN_AMEND entry in StayRequestLog are written in one atomic Sheets batch. A unique amendment ID and canonical payload hash allow safe retries after a lost response. Earlier adjacent reservations remain visible; contact-only corrections are allowed without moving those historical dates.

Checkout occupancy applies to both ends of a requested stay. Active BlockedDates keep their existing exclusive end date, but a booking cannot check out on the first blocked day. Monthly lists include stays that check out on the first day of the displayed month.

Verification, 19 November 2026: all 116 automated checks passed with current private Code.gs integration enabled. Tests cover boundaries, month transitions, no extra billed night, self-exclusion, concurrency snapshots, pending requests, owner-only operations, payment preservation, audit writes and duplicate-safe retries. Desktop and 390px mobile layout checked with synthetic data. No production reservation details were changed during testing.

Released to the existing public Apps Script deployment as version 15 on 19 November 2026 at 19:51 Malaysia time. Deployment URL, owner execution and access settings retained.
