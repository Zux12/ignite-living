# Promotional stay prices

In `admin.html`, open **Promotional prices**, choose an available property, enable the offer, enter its title, first and last promotional night, and the package prices. Review the preview, tick the confirmation and save. Untick Enable and save to turn an offer off.

The main page displays the standard price crossed out beside the lower promotional price and the promotional stay dates. Package details show one-, two- and three-night totals and the rate for extra nights. The card always shows the one-night total first, followed by the two- and three-night totals and extra-night rate. A one-night price is crossed out only when that specific rate is discounted.

Dates mean **stay nights**, not a booking deadline. The entire stay must fit within the period; check-out can be the day after the last promotional night. Future stay offers can be advertised immediately. The offer expires automatically after its last night in Asia/Kuala_Lumpur. Normal prices, the deposit and cleaning fee remain unchanged. Existing bookings keep their agreed totals. This is separate from returning-customer vouchers printed on receipts.

## Implementation and release

- `backend/PromotionalPricing.gs`: owner-authenticated settings, versioned Script Properties, validated rates/dates, safe public projection and integer-sen promotional calculations.
- `backend/AdminApi.gs`: `ppList` and `ppSave` through the existing verified owner session.
- `scripts/build-promotional-pricing.cjs PRIVATE_BACKUP PRIVATE_RELEASE`: applies exact-hash guarded changes to the current production `Code.gs`. Private source/configuration stays outside the repository.
- `Code.gs` patches: public `action=pricing`, shared availability/quote calculation, and price-consent validation at booking submission. Retry replay remains before pricing checks. Saved acknowledgements retain their original agreed totals.
- `assets/admin/promotions.js`: preview, explicit save, optimistic revision check and immutable retry after a lost save response.
- `assets/promotions.js`: public package/card pricing, Malaysian-date expiry and quote savings. The initial HTML and booking panel show Loading prices until current rates arrive. An initial fetch failure shows a retry control instead of static or invented prices. Booking prices are always validated by the backend.

Only available properties can have offers. All rates must be positive, at most the corresponding standard price, with at least one actual reduction. One-, two- and three-night totals cannot be below the unchanged deposit, and package totals cannot decrease as nights increase. Expired or incompatible offers are not advertised. No customer information, editor identity or request hashes are included in public pricing.

Validation: `npm test`; include the generated private source integration check with `PROMOTION_RELEASE_DIR=PRIVATE_RELEASE npm test`. Synthetic UI tests do not create production bookings, receipts or offers. No promotion is activated by this release.

Deploy `Code.gs`, `AdminApi.gs` and `PromotionalPricing.gs` together to a new version of the existing public Apps Script deployment; preserve its URL and access settings and the separate owner-dashboard deployment. Publish GitHub Pages after the backend read-only checks pass. For rollback, restore the previous Apps Script deployment version and previous frontend commit together. Do not delete saved promotions or alter historical booking totals during rollback.

## Verification — 18 November 2026

- Apps Script public deployment updated from version 11 to version 12; existing deployment URL, owner execution and Anyone access preserved. Separate owner deployment untouched. All three edited source files matched the prepared release; reloaded editor confirmed Saved to Drive.
- Read-only live checks: service connected and bookings enabled; pricing returns IL001 only with original rates and no active promotion; two-night February quote remains RM1,800 with RM500 deposit / RM1,300 balance and a price-consent key.
- 92 checks passed, including generated production-source integration, offer boundaries, expiry, money arithmetic, stale-price rejection, owner-save retries and existing booking/receipt/review regressions.
- Browser-tested sample admin save and preview. Verified 390px layout without horizontal overflow after correcting grid minimum widths. No production promotion or booking was created.
- The accompanying screenshot uses clearly labelled sample rates in an isolated preview.

### Explicit one-night totals

The homepage and admin preview now keep the one-night total visible even when only a longer package is discounted. Two- and three-night totals and extra-night rates appear alongside it. No backend rates or saved promotions changed. Validated with 93 passing checks and desktop / 390px browser previews; `one-night-price-preview.jpg` uses labelled sample rates only.

### No original-price flash on initial load

Removed the hardcoded standard amounts from the homepage and modal pricing placeholder. Both show Loading prices until a complete current API response arrives. Initial failures and incomplete responses show Retry prices; they never revert to a static rate. Existing current-data refresh and Malaysian expiry handling remain in place. The current card layout is reserved during loading to avoid showing the former arrangement first. No backend settings or rates were changed.

Validation: 95 tests passed, including delayed initial responses, failed/incomplete responses, and retry recovery. Browser fixture confirmed Loading prices → the sample promotion directly. `price-loading-fixed.jpg` records the isolated delayed-response preview.
