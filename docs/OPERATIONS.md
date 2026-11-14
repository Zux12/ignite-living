# Ignite Living operations and recovery

This runbook preserves GitHub Pages, the existing Apps Script project, Sheets and private Drive receipts. It does not authorize financial transfers, new retention rules or public sharing. Never include customer records, credentials, bank instructions or private configuration identifiers in this repository.

## Release record

The 14 November 2026 release completed: owner-private spreadsheet backup; three additive headings verified; existing public backend moved from version 5 to version 8 at 21:48 MYT; PR #3 merged as `42572706b02f2ed925e7c1199c949b4e613c2d1f`; Pages run `43601701591` succeeded. Live status, quotation, unauthenticated denial and served-file checks passed. The owner dashboard remains version 7. The procedure below is retained for repeatability and rollback.

## Booking-retry release

The change adds a customer-bound request UUID, payload hash and saved acknowledgement to the booking row. Repeating the same submission returns the original booking reference. A retry with changed dates or occupants is rejected. It does not confirm bookings or change rates, cancellation rules or payments.

1. Confirm that the release branch and the current production files still match the reviewed versions. The patch builder rejects source changes. Preserve existing owner-dashboard code and customer provisioning helpers.
2. In the owner's Drive, create an owner-private, timestamped copy of the production spreadsheet before changing its schema. Keep the original database in place. Preserve the existing Apps Script versions and deployment configurations. Do not export customer data to GitHub or a public report.
3. Add three columns to the right of Bookings' existing 31 columns. Set AF1=`requestId`, AG1=`requestHash`, AH1=`requestResult`. Read those headings back and verify existing headings remain unchanged. Existing bookings retain blank values in these new fields; do not backfill identities or rewrite old rows.
4. Generate the patch with `scripts/build-booking-fix.cjs` from the exact private source snapshot. Update only Code.gs and add BookingRequests.gs to the original production project. Do not install Staging*.gs files, fixture configuration or test handlers there.
5. Publish a new version through the existing public deployment, preserving its URL, execute-as-owner mode and existing audience. Keep the separate owner dashboard deployment and permissions intact. The shared project source includes its current code; do not remove it.
6. Merge the verified frontend change and wait for the GitHub Pages deployment to succeed. Older open pages without a request ID will receive an explicit refresh instruction from the backend. Existing account and booking-management actions retain their API contracts.
7. Read the served frontend and check the public status, one quotation and an unauthenticated denial. A malformed booking submission with no credentials must fail without a row write. Do not create a production test account or booking. Record deployment versions, commit and check outcomes privately.
8. Observe Apps Script executions for errors and investigate any missing-schema or saved-response corruption error. Keep the release as conditional until real-device acceptance and owner policy decisions are completed.

## Rollback

For a code regression, repoint the existing public deployment to the previous known-good version and revert the frontend release commit. Preserve deployment URLs and permissions. Leave the three additive headings and all booking records in place: deleting them could lose retry evidence. The old backend ignores additional headings. Check public status and quotation again.

A code rollback is not a database restore. Do not overwrite production with an older spreadsheet: doing so can erase newer bookings and payment reviews. Stop writes first, take another private snapshot, compare the affected references in the owner interface, and reconcile later transactions before selecting a recovered dataset. Never infer a bank transfer from a spreadsheet status.

## Backup and restoration

The synthetic recovery drill copies all nine tabs, deliberately alters a disposable copy, creates a fresh restoration from the intact backup, compares all cell values, and checks owner-only sharing. A synthetic receipt copy is compared byte for byte. This establishes copy integrity for tested fixtures; it does not establish a running production backup schedule or a guaranteed recovery time.

Production backup scope must include:

- All nine spreadsheet tabs, including Customers and both audit logs; protect these as sensitive data.
- Private receipt files as well as their spreadsheet metadata. A spreadsheet copy alone does not copy its linked Drive files.
- Apps Script source versions, deployment identities/modes, manifest and required services. Preserve configuration and script properties only in an owner-controlled location. Do not put secrets in this repository or execution logs.
- The frontend Git commit and GitHub Pages deployment reference.

Before a restore, freeze booking and owner-review writes through the existing controls, record the cutoff, and retain the current data as a rollback snapshot. Restore into a new owner-private spreadsheet, verify schema, unique references, balances, status transitions and audit links, and resolve changes since the backup. Rebind the script only after reconciliation. Reopen writes and verify without making an artificial real booking. Re-authentication may be required after a script or session change.

The owner must select backup frequency, retention and the person responsible for checking results. No recurring backup or monitoring automation has been installed by this audit.

## Daily owner checks

- Review pending bookings and date conflicts through the owner dashboard. Pending requests do not reserve dates.
- Verify receipts against actual bank records before crediting money. Claims and uploaded images are evidence to review, not automatic payments.
- Review pending stay changes and refunds. `REFUND_COMPLETE` records a transfer the owner has already made; it does not send money.
- Check failed Apps Script executions without copying private input or tokens into public reports.
- Confirm the most recent backup exists and inspect its result. Rehearse recovery periodically with synthetic copies.

## Uncertain writes and uploads

If a guest does not receive a booking acknowledgement, inspect their booking list and request identity before creating a replacement. The retry change allows the same UUID and unchanged payload to retrieve the original acknowledgement after a lost response. Do not generate a fresh UUID just to bypass an uncertain-save warning.

For receipt uncertainty, refresh the booking and proof list first. Use upload ID/hash, booking reference and review status to reconcile. The backend may retain a private uploaded file when the sheet write is uncertain; do not delete it or credit payment solely because the upload returned an error. Check the proof record and private file together. Escalate conflicting duplicate records to the owner and preserve the audit trail.

## Remaining acceptance decisions

- A verified public support and forgotten-password route is needed; the current UI tells customers to contact Ignite Living without supplying a dedicated recovery workflow.
- A privacy notice needs approved operator/contact details, purposes, recipients, retention and request handling. These are owner decisions; no legal-compliance claim is made.
- The existing rental terms identify themselves as preliminary. Obtain approval before changing contractual language.
- Real iOS Safari and Android Chrome checks are still required for date entry, keyboard, scrolling and receipt selection. Desktop and synthetic server tests do not replace them.
