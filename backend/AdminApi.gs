// Owner API for the GitHub-hosted dashboard. All entry helpers are private to GAS.
// Requires the generated VendorForge.gs and the narrow prOwner_/doPost patches.
// Script Properties: ADMIN_ENABLED=true, ADMIN_GOOGLE_CLIENT_ID.
// ADMIN_GOOGLE_SUB is pinned after the existing owner's first verified sign-in.
var aaPrincipal_ = null; // Request-local only; never set from an unverified payload.
const AA_ORIGIN = "https://living.igniteinnov.com";
const AA_METHODS = [
  "odList",
  "odOpenBooking",
  "odSaveBooking",
  "odOpenPayment",
  "odSavePayment",
  "odOpenRequest",
  "odSaveRequest",
  "rrList",
  "rrGet",
  "rrIssue",
  "grList",
  "grAdd",
  "grModerate",
  "ppList",
  "ppSave",
];

function aaFail_(message, code) {
  const error = new Error(message);
  error.adminCode = code || "ADMIN_ERROR";
  throw error;
}
function aaConfig_() {
  const p = PropertiesService.getScriptProperties();
  const clientId = p.getProperty("ADMIN_GOOGLE_CLIENT_ID") || "";
  const subject = p.getProperty("ADMIN_GOOGLE_SUB") || "";
  if (
    p.getProperty("ADMIN_ENABLED") !== "true" ||
    !/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
    (subject && !/^\d{10,255}$/.test(subject))
  ) {
    aaFail_(
      "The new admin sign-in is being connected. Please use the existing owner dashboard for now.",
      "ADMIN_NOT_CONFIGURED",
    );
  }
  return { clientId, subject };
}
function aaRandom_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}
function aaCached_(key) {
  try {
    return JSON.parse(CacheService.getScriptCache().get(key) || "null");
  } catch (_) {
    return null;
  }
}
function aaChallenge_() {
  const config = aaConfig_(),
    challengeId = aaRandom_(),
    nonce = aaRandom_();
  // Shared, bounded budget. It never relies on a browser-supplied IP or identity.
  msRate_("admin.challenge", 120, 3600);
  CacheService.getScriptCache().put(
    "admin.challenge." + challengeId,
    JSON.stringify({ nonce, expires: Date.now() + 300000 }),
    300,
  );
  return { clientId: config.clientId, challengeId, nonce };
}
function aaDecode_(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    aaFail_("Google sign-in could not be verified.", "AUTH_REQUIRED");
  return Utilities.base64DecodeWebSafe(
    value + "=".repeat((4 - (value.length % 4)) % 4),
  );
}
function aaJsonPart_(value) {
  try {
    return JSON.parse(
      Utilities.newBlob(aaDecode_(value)).getDataAsString("UTF-8"),
    );
  } catch (_) {
    aaFail_("Google sign-in could not be verified.", "AUTH_REQUIRED");
  }
}
function aaKeys_(force) {
  const cache = CacheService.getScriptCache(),
    stored = force ? null : aaCached_("admin.google.keys");
  if (stored && stored.expires > Date.now()) return stored.keys;
  // Fixed Google public-key endpoint. Token headers never select a fetch URL.
  const response = UrlFetchApp.fetch(
    "https://www.googleapis.com/oauth2/v3/certs",
    { muteHttpExceptions: true, followRedirects: false },
  );
  if (response.getResponseCode() !== 200)
    aaFail_(
      "Google sign-in verification is temporarily unavailable. Try again later.",
      "AUTH_UNAVAILABLE",
    );
  let body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (_) {}
  if (
    !body ||
    !Array.isArray(body.keys) ||
    !body.keys.length ||
    body.keys.length > 10
  )
    aaFail_(
      "Google sign-in verification is temporarily unavailable.",
      "AUTH_UNAVAILABLE",
    );
  const headers = response.getAllHeaders(),
    header = Object.keys(headers).find(
      (k) => k.toLowerCase() === "cache-control",
    );
  const control = String(header ? headers[header] : ""),
    maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(control);
  const seconds = /no-store|no-cache/i.test(control)
    ? 0
    : Math.min(21600, maxAge ? Number(maxAge[1]) : 0);
  if (seconds > 0)
    cache.put(
      "admin.google.keys",
      JSON.stringify({ keys: body.keys, expires: Date.now() + seconds * 1000 }),
      seconds,
    );
  return body.keys;
}
function aaVerify_(credential, nonce, config) {
  if (typeof credential !== "string" || credential.length > 12000)
    aaFail_("Google sign-in could not be verified.", "AUTH_REQUIRED");
  const parts = credential.split(".");
  if (parts.length !== 3)
    aaFail_("Google sign-in could not be verified.", "AUTH_REQUIRED");
  const head = aaJsonPart_(parts[0]),
    claims = aaJsonPart_(parts[1]);
  if (
    !head ||
    head.alg !== "RS256" ||
    typeof head.kid !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(head.kid) ||
    head.crit
  )
    aaFail_("Google sign-in could not be verified.", "AUTH_REQUIRED");
  const now = Math.floor(Date.now() / 1000);
  if (
    !claims ||
    !["https://accounts.google.com", "accounts.google.com"].includes(
      claims.iss,
    ) ||
    claims.aud !== config.clientId ||
    (claims.azp && claims.azp !== config.clientId) ||
    !Number.isInteger(claims.exp) ||
    claims.exp <= now ||
    !Number.isInteger(claims.iat) ||
    claims.iat > now + 60 ||
    claims.iat < now - 3600 ||
    (claims.nbf !== undefined &&
      (!Number.isInteger(claims.nbf) || claims.nbf > now)) ||
    claims.nonce !== nonce ||
    claims.email_verified !== true ||
    claims.email !== OD_OWNER_EMAIL ||
    typeof claims.sub !== "string" ||
    !/^\d{10,255}$/.test(claims.sub) ||
    (config.subject && claims.sub !== config.subject)
  ) {
    aaFail_(
      "Sign in using the authorised owner Google account.",
      "AUTH_REQUIRED",
    );
  }
  let keys = aaKeys_(false),
    key = keys.find((k) => k.kid === head.kid);
  if (!key) {
    msRate_("admin.keyRefresh", 6, 3600);
    keys = aaKeys_(true);
    key = keys.find((k) => k.kid === head.kid);
  }
  if (
    !key ||
    key.kty !== "RSA" ||
    key.alg !== "RS256" ||
    key.use !== "sig" ||
    typeof key.n !== "string" ||
    typeof key.e !== "string"
  )
    aaFail_("Google sign-in could not be verified.", "AUTH_REQUIRED");
  try {
    const forge = aaForgeLib_(),
      hex = (bytes) =>
        bytes.map((b) => (b & 255).toString(16).padStart(2, "0")).join("");
    const modulus = new forge.jsbn.BigInteger(hex(aaDecode_(key.n)), 16),
      exponent = new forge.jsbn.BigInteger(hex(aaDecode_(key.e)), 16);
    if (modulus.bitLength() < 2048 || modulus.bitLength() > 4096)
      throw new Error("Key size");
    const publicKey = forge.pki.setRsaPublicKey(modulus, exponent),
      digest = forge.md.sha256.create();
    digest.update(parts[0] + "." + parts[1], "utf8");
    const signature = aaDecode_(parts[2])
      .map((b) => String.fromCharCode(b & 255))
      .join("");
    if (!publicKey.verify(digest.digest().bytes(), signature))
      throw new Error("Signature");
  } catch (_) {
    aaFail_("Google sign-in could not be verified.", "AUTH_REQUIRED");
  }
  return claims;
}
function aaLogin_(input) {
  const config = aaConfig_();
  if (!/^[a-f0-9]{64}$/.test(String(input.challengeId || "")))
    aaFail_("Reload this page to sign in again.", "AUTH_REQUIRED");
  const key = "admin.challenge." + input.challengeId,
    challenge = aaCached_(key);
  if (!challenge || challenge.expires <= Date.now())
    aaFail_("Sign-in expired. Reload this page to try again.", "AUTH_REQUIRED");
  msRate_("admin.verify", 60, 3600);
  const claims = aaVerify_(input.credential, challenge.nonce, config);
  return msLocked_(() => {
    const current = aaCached_(key);
    if (
      !current ||
      current.nonce !== challenge.nonce ||
      current.expires <= Date.now()
    )
      aaFail_(
        "Sign-in expired. Reload this page to try again.",
        "AUTH_REQUIRED",
      );
    const currentConfig = aaConfig_(),
      owner = SpreadsheetApp.openById(SPREADSHEET_ID).getOwner();
    if (
      currentConfig.clientId !== config.clientId ||
      (currentConfig.subject && currentConfig.subject !== claims.sub) ||
      !owner ||
      owner.getEmail().trim().toLowerCase() !== claims.email
    )
      aaFail_(
        "Sign in using the authorised owner Google account.",
        "AUTH_REQUIRED",
      );
    if (!currentConfig.subject)
      PropertiesService.getScriptProperties().setProperty(
        "ADMIN_GOOGLE_SUB",
        claims.sub,
      );
    CacheService.getScriptCache().remove(key);
    const token = aaRandom_(),
      expires = Math.min(claims.exp * 1000, Date.now() + 3600000);
    const principal = {
      email: claims.email,
      subject: claims.sub,
      clientId: config.clientId,
      expires,
    };
    CacheService.getScriptCache().put(
      "admin.session." + msHash_(token),
      JSON.stringify(principal),
      Math.max(1, Math.floor((expires - Date.now()) / 1000)),
    );
    return { token, expires, email: principal.email };
  });
}
function aaSession_(token) {
  const config = aaConfig_();
  if (!/^[a-f0-9]{64}$/.test(String(token || "")))
    aaFail_("Sign in to open the admin dashboard.", "AUTH_REQUIRED");
  const principal = aaCached_("admin.session." + msHash_(token));
  if (
    !principal ||
    principal.expires <= Date.now() ||
    principal.email !== OD_OWNER_EMAIL ||
    principal.subject !== config.subject ||
    principal.clientId !== config.clientId
  )
    aaFail_("Your admin session expired. Sign in again.", "AUTH_REQUIRED");
  return principal;
}
function aaOwnerEmail_() {
  if (!aaPrincipal_) return "";
  const config = aaConfig_();
  if (
    aaPrincipal_.expires <= Date.now() ||
    aaPrincipal_.email !== OD_OWNER_EMAIL ||
    aaPrincipal_.subject !== config.subject ||
    aaPrincipal_.clientId !== config.clientId
  )
    aaFail_("Your admin session expired. Sign in again.", "AUTH_REQUIRED");
  return aaPrincipal_.email;
}
function aaRpc_(input) {
  const principal = aaSession_(input.token),
    method = String(input.method || "");
  if (!AA_METHODS.includes(method))
    aaFail_("This admin action is not available.", "ADMIN_ACTION_DENIED");
  const names = {
    odOpenBooking: "booking",
    odSaveBooking: "booking",
    odOpenPayment: "payment",
    odSavePayment: "payment",
    odOpenRequest: "request",
    odSaveRequest: "request",
  };
  const cache = CacheService.getScriptCache(),
    prefix = "admin.review." + msHash_(input.token) + "." + names[method] + ".";
  const saving = method.indexOf("odSave") === 0,
    opening = method.indexOf("odOpen") === 0;
  if (
    saving &&
    (!input.input ||
      !/^[a-f0-9-]{36}$/i.test(String(input.input.token || "")) ||
      !cache.get(prefix + input.input.token))
  )
    aaFail_("Close and reopen this review before saving.", "REVIEW_EXPIRED");
  const dispatch = {
    odList,
    odOpenBooking,
    odSaveBooking,
    odOpenPayment,
    odSavePayment,
    odOpenRequest,
    odSaveRequest,
  };
  aaPrincipal_ = principal;
  try {
    const result = method === "rrList" ? rrList_(input.input)
      : method === "rrGet" ? rrGet_(input.input)
      : method === "rrIssue" ? rrIssue_(input.input)
      : method === "grList" ? grAdminList_(input.input)
      : method === "grAdd" ? grAdminAdd_(input.input)
      : method === "grModerate" ? grAdminModerate_(input.input)
      : method === "ppList" ? ppList_()
      : method === "ppSave" ? ppSave_(input.input)
      : dispatch[method](input.input);
    if (opening && result && result.token)
      cache.put(
        prefix + result.token,
        "1",
        Math.min(
          1800,
          Math.max(1, Math.floor((principal.expires - Date.now()) / 1000)),
        ),
      );
    if (saving) cache.remove(prefix + input.input.token);
    return result;
  } catch (error) {
    if (error.adminCode) throw error;
    // The existing owner handlers return useful validation text; do not emit stacks.
    aaFail_(
      String(error.message || "Unable to complete the admin action.").slice(
        0,
        500,
      ),
      "ADMIN_ACTION_FAILED",
    );
  } finally {
    aaPrincipal_ = null;
  }
}
function adminDoPost_(input) {
  try {
    if (!input || JSON.stringify(input).length > 24000)
      aaFail_("Admin request is invalid or too large.", "ADMIN_REQUEST");
    if (!input || input.origin !== AA_ORIGIN)
      aaFail_(
        "Open the admin page on the Ignite Living website.",
        "ADMIN_ORIGIN",
      );
    let result;
    switch (input.action) {
      case "admin.challenge":
        result = aaChallenge_();
        break;
      case "admin.login":
        result = aaLogin_(input);
        break;
      case "admin.rpc":
        result = aaRpc_(input);
        break;
      case "admin.logout":
        if (/^[a-f0-9]{64}$/.test(String(input.token || "")))
          CacheService.getScriptCache().remove(
            "admin.session." + msHash_(input.token),
          );
        result = {};
        break;
      default:
        aaFail_("This admin action is not available.", "ADMIN_ACTION_DENIED");
    }
    return msJson_({ ok: true, ...result });
  } catch (error) {
    return msJson_({
      ok: false,
      code: error.adminCode || "ADMIN_UNAVAILABLE",
      message: error.adminCode
        ? error.message
        : "Admin access is temporarily unavailable. Please try again later.",
    });
  }
}
