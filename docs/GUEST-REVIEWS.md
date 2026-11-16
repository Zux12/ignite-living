# Guest reviews — 16 November 2026

The public homepage has a Guest reviews section with a 1–5 overall rating, property filter, published-review average and paginated feedback. Guests can use a display name or post anonymously without creating an account. Choosing anonymous clears the name before submission, and the backend also discards it.

In `admin.html`, choose **Guest reviews → Add an existing review**. Select the home, original rating, name/anonymous, original review date and guest's words. Confirm permission to display the genuine feedback, then **Save existing review**. It appears under Pending; use **Publish → Confirm publish** to display it. Entries added this way say **Shared by host**. Do not invent a star rating when the original feedback did not include one.

All submissions start Pending. Only Published entries count toward the average. Hide removes an entry from public display and the average without deleting its record. Moderate consistently regardless of rating: spam, private details and unrelated content may be hidden. Existing reviews cannot be edited in this first version; a mistaken entry can be hidden and entered again accurately. No sample reviews are populated in production.

## Backend

`backend/GuestReviews.gs` adds private helpers with two public POST actions (`reviews.list`, `reviews.submit`) and three owner-only admin methods (`grList`, `grAdd`, `grModerate`). The existing Google owner-session verification and origin policy remain in force for administration. No additional Google consent scope, new client, deployment URL or sharing permission is required.

A private `GuestReviews` sheet is created on the first valid submission, using `reviewId, requestId, createdAt, updatedAt, reviewJson` columns. JSON stores the review, status, revision, source and moderation history. Public output uses an explicit field allowlist; owner email, consent, request IDs and audit history never leave it. Script locking, immutable UUID retry identity and revision checks protect writes. Text is stored inside JSON and displayed with DOM textContent. Pending/hidden records are excluded server-side.

Public submissions enforce 1–5 integer ratings, allowed properties, length limits, consent and a honeypot. Shared durable budgets are 40 new guest submissions/hour and 200/day; they are not per-person/IP limits. Imported host entries require existing owner authorization. Original review dates cannot be in the future. No verified-booking claim is made; moderation is required before any publication.

The guarded builder `scripts/build-guest-reviews.cjs SOURCE OUTPUT` prepares a patch from the verified version-10 project snapshot. It adds GuestReviews.gs, updates AdminApi.gs and inserts one review route in ManageStay.gs. Private project source/configuration is intentionally excluded from git. Other booking, receipt, payment and account modules are preserved. Never install staging test drivers in production.

Public API deployment: **version 11**, released 16 November 2026 at 12:45 MYT, using the existing URL and execution/access settings. The separate version-7 deployment was not changed.

## Verification

- 77 regular offline/frontend tests passed, including 17 new review storage/UI checks.
- 11 owner API/authentication tests passed against the prepared project, including all new review methods.
- 12 existing booking/retry/payment-proof recovery tests passed against the same project.
- Eight hosted checks passed in the isolated staging spreadsheet: real save, durable retry, anonymous admin output, erased anonymous name/server-set source, publication/average, public-field privacy, hide and unchanged booking records.
- Hosted synthetic records remained in staging and ended Hidden. Production acceptance uses read-only lists and unsubmitted form drafts.

Rollback: restore public Apps Script version 10 and revert the review frontend commit together. Preserve the GuestReviews register and existing version-7 legacy owner deployment; never delete records during rollback.

## Live acceptance

Frontend commit `04e30ec1219fa2bb59078b4af0f4a32317a2c391` deployed successfully through Pages run `43806185645`. The live homepage loaded its empty published-review list successfully, property filtering worked, and selecting anonymous removed the display-name field. Draft input was cleared without submission. Existing Google owner sign-in succeeded; the Guest reviews workspace loaded its Pending list (zero records), original-date field and entry form. Star selection, anonymous selection and Clear form worked. No production guest review, booking or payment was submitted. Desktop Chrome was visually inspected; physical phone/Safari checks were not performed. A [live admin screenshot](verification/guest-reviews-admin-2026-11-16.jpg) records the new workspace.
