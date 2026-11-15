# GitHub-hosted owner dashboard

Updated 16 November 2026. **Backend released; frontend publication and browser acceptance pending.** The production public API is version 9; the separate owner dashboard remains version 7. Seventeen hosted staging checks passed. Production authorization and the owner-access check succeeded, and the new backend was deployed at 00:11 MYT. Do not treat the migration as accepted until real browser checks pass.

## Intended result

The owner opens `https://living.igniteinnov.com/admin.html`. GitHub Pages serves the entire interface from `admin.html`, `assets/admin/admin.css` and `assets/admin/admin.js`. Layout, navigation, filters and review screens can be changed in GitHub without editing Apps Script HTML. The page is not an iframe or redirect wrapper.

Apps Script supplies authenticated JSON and retains the existing booking decisions, payment verification, stay requests, locks, snapshot checks and audit history. Google Sheets and private Drive receipts remain in place. No new paid hosting or database is introduced. Adding a new data operation may still require a backend API change; purely visual changes do not.

## Existing Google client and activation status

Reuse the owner's existing **Ignite Admin Portal** Cloud project and **Ignite Admin Web** OAuth client (Web application, created 27 October 2026). The owner supplied its full Client ID in a Cloud Console screenshot and confirmed saving the additional JavaScript origin on 15 November. No replacement client or project is needed.

- Preserve the existing `https://igniteinnov.com` origin, branding, audience and redirect settings. The additional origin is exactly `https://living.igniteinnov.com`, without a path or trailing slash. The GIS popup callback does not need an additional redirect URI.
- This browser sign-in needs identity only (`openid`, email/profile); do not add unrelated Drive/Sheets scopes to the website client. No client secret or password is required for this implementation.
- The owner Apps Script session is accessible. All eight live source modules were copied to a private pre-change checkpoint; the seven runtime modules match the reviewed release, and the existing Customers provisioning module is preserved as well. The release builder ran against that fresh source and the nine signature/authentication checks passed again.
- The isolated staging source was backed up, then updated with the admin modules and a synthetic-only hosted check driver. The owner approved staging authorization; Google displayed external-service access as the additional grant. All 17 hosted checks passed at 23:52 MYT on 15 November. No production records were touched, and private staging deployment access was not widened.
- Production contains the exact verified AdminApi.gs and VendorForge.gs modules plus the two reviewed ManageStay.gs/PaymentReview.gs patches. All four saved files were compared exactly with the generated release. The other six original modules are preserved. ADMIN_GOOGLE_CLIENT_ID is saved using the existing web client and ADMIN_ENABLED=true; ADMIN_GOOGLE_SUB is left absent until the first real verified login. These changes were released as version 9 through the existing public API deployment, preserving its URL, execute-as-owner mode and Anyone audience. The separate version-7 owner deployment was not modified.
- The owner explicitly approved the production unverified-app warning and requested permissions. Google showed only external-service access as an additional grant; existing access was retained. The six project scopes are script.scriptapp, spreadsheets, drive, script.external_request, script.container.ui and userinfo.email. Drive/Sheets permissions are account-wide. Production checkOwnerDashboardAccess completed successfully at 00:09 MYT on 16 November and reported that no records changed.
- The staging driver uses an expiring synthetic RSA-signed fixture, temporarily substitutes a synthetic public key, and restores its prior admin properties and sessions in `finally`. It must never be copied into production. Regenerate an expired fixture before rerunning. Production files contain no such test hook.

Reference: [Google Sign in with Google setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Security boundary

- The anonymous page contains no booking data. Bootstrap returns only a client ID and a five-minute, one-use login challenge. Origin input is a routing check, not an authentication mechanism.
- GIS obtains a Google ID token bound to the random challenge nonce. Apps Script verifies the RS256 signature against Google's public keys using pinned `node-forge` 1.4.3, then checks issuer, exact client audience/presenter, issue/expiry time, nonce, verified owner email and Google subject. It never uses Google's debug `tokeninfo` endpoint for production verification.
- The first cryptographically verified owner login pins the immutable subject in private Script Properties after checking spreadsheet ownership. Later logins must match. The owner address comes from the existing private OwnerDashboard source.
- The API creates an opaque, short-lived, revocable server session, capped by Google token expiry and one hour. The browser holds it only in memory; no credentials or records are stored in localStorage/sessionStorage. Logout, expiry and page navigation clear private UI.
- A strict method whitelist exposes only the seven existing owner operations. Review tokens are additionally bound to the authenticated session and operation; existing stale-record/lock/confirmation checks still run. No unauthenticated request can enter an owner handler.
- `prOwner_` accepts a verified request-local API principal only inside the authenticated dispatch. Its normal active-Google-user and spreadsheet-owner checks are retained for the old dashboard and spreadsheet menus.
- Receipt links remain private Drive links. The frontend rejects other protocols/hosts, uses text nodes for customer values and provides an admin-specific CSP. Responses and credentials use POST bodies, never URL query parameters.
- `ADMIN_ENABLED=false` stops the new API without affecting the old dashboard or customer website. Cache eviction causes re-authentication, never permission fallback.

## Prepared implementation and tests

```sh
npm ci
npm test
node scripts/build-admin-api.cjs /private/reviewed-v8-source /private/admin-source
ADMIN_BACKEND_SOURCE_DIR=/private/admin-source node --test tests/admin-api.test.cjs
PATCHED_BACKEND_SOURCE_DIR=/private/admin-source node --test tests/booking-retries.test.cjs tests/receipt-recovery.test.cjs
```

The builder refuses unreviewed ManageStay/PaymentReview source hashes, leaves the source unchanged, writes generated files to a separate private directory and preserves the other modules. It adds an `admin.*` POST route, a request-local owner identity hook, `AdminApi.gs` and generated `VendorForge.gs`. The complete private project source and its configuration identifiers are not committed. `npm audit` reported no known dependency vulnerabilities at preparation time.

Current verification: **59 checks pass**: 38 frontend tests (29 customer + 9 admin), 9 new authentication/API checks and 12 existing booking/receipt backend checks against the generated output. New auth tests use actual RSA signatures from synthetic keys and the same Forge bundle used in Apps Script, with synthetic Google/Cache/Sheets services. They are not hosted Google OAuth, CORS, consent or Apps Script execution results. Real signed-in browser validation and visual inspection of the new page are pending.

Separately, **17 hosted Apps Script staging checks passed**: existing client configuration; live Google key retrieval; Forge execution; anonymous and incorrect-origin denial; nonce creation; malformed credentials; real RS256 signature validation and tamper rejection; short-lived owner sessions; nonce replay prevention; operation allowlisting; isolated fixture reads; request-local principal cleanup; unbound-save rejection before mutation; logout invalidation; and availability of the existing owner handler. The hosted driver uses synthetic signing keys and fixtures, not a real GIS sign-in. Actual Google browser login, cross-origin transport, review UI and production deployment are still unverified.

## Activation sequence

1. Recheck GitHub main and actual saved/deployed Apps Script sources if anything has changed since the checkpoint. Use the existing Google web Client ID supplied by the owner. Preserve the private source/configuration backup; do not reset or copy over the live spreadsheet.
2. Prepare the generated source from the reviewed current backend. Test in the existing isolated staging project/database and private receipts folder, with a correctly registered test web origin and the owner login. Keep production data and payment actions out of this test. Do not widen private staging sharing without the owner's confirmation.
3. Verify hosted execution of the Forge bundle, key retrieval and cache, expiry/logout, cross-origin JSON transport, unauthorized denial, all three review screens, stale decisions and ambiguous-save recovery. The old owner dashboard must still open and the customer quote/account flows must still pass. Do not declare the migration complete based only on offline checks.
4. Install **AdminApi.gs** and generated **VendorForge.gs** in the production Apps Script project; apply the two narrow patches to **ManageStay.gs** and **PaymentReview.gs**. Preserve other modules, deployments, schema and records. Apps Script may require owner consent for its added external HTTP request capability; complete that consent through the owner account.
5. Set private Script Properties `ADMIN_GOOGLE_CLIENT_ID` to the existing client ID and `ADMIN_ENABLED=true`. Leave `ADMIN_GOOGLE_SUB` absent for the first verified owner login; it is then pinned automatically. Never copy a synthetic subject/key or a test-token bypass into production.
6. Release a new version through the existing public API deployment, preserving its URL, audience and execute-as-owner mode. The new public entry point remains authenticated in application code. Keep the separate version-7 owner deployment unchanged as rollback access.
7. Publish the GitHub files and verify `admin.html` on the live origin. Sign in as the actual owner and perform read-only record checks. Finish write checks with isolated synthetic staging, not production test bookings or payment claims.
8. Record actual client/project ownership, backend version, PR/commit, Pages run and hosted acceptance results in an owner-controlled handover. Only then mark the new dashboard active.

## Rollback

Set `ADMIN_ENABLED=false`, restore the preceding public backend deployment version if necessary, and revert only the new frontend files. The existing Google-hosted owner dashboard and spreadsheet menus remain available. Never remove booking/proof/audit rows as part of this rollback.
