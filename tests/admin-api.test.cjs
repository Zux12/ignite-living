// Actual JWT signature verification and routing with synthetic keys/services only.
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto");
const dir = process.env.ADMIN_BACKEND_SOURCE_DIR;
const check = dir ? test : test.skip;
const owner = "igniteinnoventureskl@gmail.com",
  clientId = "1234567890-synthetic.apps.googleusercontent.com",
  subject = "123456789012345678901";
const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "synthetic-key",
  alg: "RS256",
  use: "sig",
};
function harness() {
  const props = new Map([
      ["ADMIN_ENABLED", "true"],
      ["ADMIN_GOOGLE_CLIENT_ID", clientId],
    ]),
    cache = new Map();
  const state = {
    now: Date.now(),
    reads: 0,
    calls: [],
    locked: false,
    fetches: 0,
    activeEmail: "",
    sheetsOwner: owner,
    keys: [jwk],
    googleDown: false,
  };
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [state.now]));
    }
    static now() {
      return state.now;
    }
  }
  const c = vm.createContext({
    Date: FakeDate,
    Int32Array,
    Uint8Array,
    console: { error() {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64DecodeWebSafe: (value) => [...Buffer.from(value, "base64url")],
      newBlob: (value) => ({
        getDataAsString: () => Buffer.from(value).toString("utf8"),
      }),
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (algorithm, value) => [
        ...crypto.createHash("sha256").update(String(value)).digest(),
      ],
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => props.get(key) || null,
        setProperty: (key, value) => props.set(key, value),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => {
          const v = cache.get(key);
          return v && v.expires > state.now ? v.value : null;
        },
        put: (key, value, seconds) =>
          cache.set(key, { value, expires: state.now + seconds * 1000 }),
        remove: (key) => cache.delete(key),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (state.locked) return false;
          state.locked = true;
          return true;
        },
        releaseLock: () => {
          state.locked = false;
        },
      }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => state.activeEmail }) },
    SpreadsheetApp: {
      openById: () => {
        state.reads++;
        return { getOwner: () => ({ getEmail: () => state.sheetsOwner }) };
      },
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs");
        assert.equal(options.followRedirects, false);
        state.fetches++;
        return {
          getResponseCode: () => (state.googleDown ? 503 : 200),
          getContentText: () => JSON.stringify({ keys: state.keys }),
          getAllHeaders: () => ({ "Cache-Control": "public, max-age=300" }),
        };
      },
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }),
    },
  });
  for (const file of [
    "Code.gs",
    "ManageStay.gs",
    "GuestAccounts.gs",
    "PaymentReview.gs",
    "StayRequests.gs",
    "OwnerDashboard.gs",
    "BookingRequests.gs",
    "VendorForge.gs",
    "AdminApi.gs",
    "ReceiptModel.gs",
    "IssuedReceipts.gs",
  ])
    vm.runInContext(fs.readFileSync(path.join(dir, file), "utf8"), c, {
      filename: file,
    });
  c.msRate_ = () => {};
  // Real prOwner_ authentication is preserved; record operations are isolated fixtures.
  for (const name of [
    "odList",
    "odOpenBooking",
    "odSaveBooking",
    "odOpenPayment",
    "odSavePayment",
    "odOpenRequest",
    "odSaveRequest",
    "rrList_",
    "rrGet_",
    "rrIssue_",
  ])
    c[name] = (input) => {
      const principal = c.prOwner_();
      assert.equal(principal.email, owner);
      state.calls.push({ name, input });
      if (name.startsWith("odOpen"))
        return {
          token: crypto.randomUUID(),
          booking: { bookingId: "SYNTHETIC-A" },
        };
      if (name === "odList") return { bookings: [], proofs: [], requests: [] };
      return { message: "Synthetic decision saved" };
    };
  const send = (input) =>
    c.doPost({
      postData: {
        contents: JSON.stringify({
          origin: "https://living.igniteinnov.com",
          ...input,
        }),
      },
    });
  const challenge = () => send({ action: "admin.challenge" });
  function credential(ch, changes = {}, header = {}) {
    const now = Math.floor(state.now / 1000),
      head = { alg: "RS256", kid: jwk.kid, ...header };
    const claims = {
      iss: "https://accounts.google.com",
      aud: clientId,
      sub: subject,
      email: owner,
      email_verified: true,
      iat: now,
      exp: now + 3600,
      nonce: ch.nonce,
      ...changes,
    };
    const text = [head, claims]
      .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
      .join(".");
    return (
      text +
      "." +
      crypto
        .sign("RSA-SHA256", Buffer.from(text), pair.privateKey)
        .toString("base64url")
    );
  }
  function login() {
    const ch = challenge();
    return send({
      action: "admin.login",
      challengeId: ch.challengeId,
      credential: credential(ch),
    });
  }
  return { c, state, props, cache, send, challenge, credential, login };
}

check("receipt endpoints require the verified owner session before reading or issuing", () => {
  const h = harness();
  for (const method of ["rrList", "rrGet", "rrIssue"])
    assert.equal(h.send({action:"admin.rpc",method,token:"synthetic-guest-token"}).code,"AUTH_REQUIRED");
  assert.equal(h.state.calls.length,0);
  const session=h.login();
  for (const method of ["rrList", "rrGet", "rrIssue"]) {
    const response=h.send({action:"admin.rpc",method,token:session.token,input:{confirmed:true}});
    assert.equal(response.ok,true);
    assert.equal(h.state.calls.at(-1).name,method+"_");
  }
});

check(
  "anonymous and guest tokens cannot read owner records or run arbitrary functions",
  () => {
    const h = harness();
    for (const token of ["", "synthetic-guest-token", "a".repeat(64)])
      assert.equal(
        h.send({ action: "admin.rpc", token, method: "odList" }).code,
        "AUTH_REQUIRED",
      );
    assert.equal(h.state.reads, 0);
    assert.equal(h.state.calls.length, 0);
    const session = h.login();
    assert.equal(session.ok, true);
    for (const method of [
      "setupPaymentReview",
      "constructor",
      "doPost",
      "prOwner_",
    ])
      assert.equal(
        h.send({ action: "admin.rpc", token: session.token, method }).code,
        "ADMIN_ACTION_DENIED",
      );
    assert.equal(h.state.calls.length, 0);
  },
);
check(
  "valid Google signature pins the existing owner subject and allows only authenticated API calls",
  () => {
    const h = harness(),
      session = h.login();
    assert.equal(session.ok, true);
    assert.equal(h.props.get("ADMIN_GOOGLE_SUB"), subject);
    assert.equal(
      h.send({ action: "admin.rpc", token: session.token, method: "odList" })
        .ok,
      true,
    );
    assert.equal(h.state.calls.length, 1);
    assert.equal(h.c.aaPrincipal_, null);
    assert.throws(() => h.c.prOwner_(), /owner Google account/);
  },
);
check(
  "wrong issuer, client, presenter, owner, subject, nonce, expiry and missing claims fail closed",
  () => {
    for (const change of [
      { iss: "https://evil.example" },
      { aud: "other-client" },
      { azp: "other-client" },
      { email: "other@gmail.com" },
      { email_verified: false },
      { sub: "bad" },
      { nonce: "wrong" },
      { exp: 0 },
      { exp: undefined },
      { iat: undefined },
      { iat: 9999999999 },
    ]) {
      const h = harness(),
        ch = h.challenge();
      const r = h.send({
        action: "admin.login",
        challengeId: ch.challengeId,
        credential: h.credential(ch, change),
      });
      assert.equal(r.ok, false, JSON.stringify(change));
      assert.equal(h.state.reads, 0);
    }
    const h = harness();
    h.props.set("ADMIN_GOOGLE_SUB", "987654321098765432109");
    assert.equal(h.login().ok, false);
  },
);
check(
  "tampered signatures, unsigned JWTs and wrong signing algorithms cannot authenticate",
  () => {
    for (const kind of ["tamper", "none", "HS256", "crit"]) {
      const h = harness(),
        ch = h.challenge();
      let credential = h.credential(
        ch,
        {},
        kind === "crit"
          ? { crit: ["unknown"] }
          : kind === "tamper"
            ? {}
            : { alg: kind },
      );
      if (kind === "tamper") {
        const parts = credential.split(".");
        const sig = Buffer.from(parts[2], "base64url");
        sig[0] ^= 255;
        parts[2] = sig.toString("base64url");
        credential = parts.join(".");
      }
      assert.equal(
        h.send({
          action: "admin.login",
          challengeId: ch.challengeId,
          credential,
        }).ok,
        false,
        kind,
      );
      assert.equal(h.state.reads, 0);
      assert.equal(h.state.calls.length, 0);
    }
  },
);
check(
  "login challenges are single-use and expire before five-minute-old credentials can be replayed",
  () => {
    const h = harness(),
      ch = h.challenge(),
      input = {
        action: "admin.login",
        challengeId: ch.challengeId,
        credential: h.credential(ch),
      };
    assert.equal(h.send(input).ok, true);
    assert.equal(h.send(input).ok, false);
    const next = h.challenge();
    h.state.now += 300001;
    assert.equal(
      h.send({
        action: "admin.login",
        challengeId: next.challengeId,
        credential: h.credential(next),
      }).ok,
      false,
    );
  },
);
check(
  "Google key outage fails closed; cached keys avoid unnecessary network calls",
  () => {
    const h = harness();
    h.state.googleDown = true;
    assert.equal(h.login().ok, false);
    assert.equal(h.state.reads, 0);
    h.state.googleDown = false;
    assert.equal(h.login().ok, true);
    const fetched = h.state.fetches;
    assert.equal(h.login().ok, true);
    assert.equal(h.state.fetches, fetched);
  },
);
check(
  "logout, expiry, disabled configuration and changed owner revoke record access",
  () => {
    for (const mode of ["logout", "expiry", "disabled", "owner"]) {
      const h = harness(),
        session = h.login();
      if (mode === "logout")
        assert.equal(
          h.send({ action: "admin.logout", token: session.token }).ok,
          true,
        );
      if (mode === "expiry") h.state.now += 3600001;
      if (mode === "disabled") h.props.set("ADMIN_ENABLED", "false");
      if (mode === "owner") h.state.sheetsOwner = "other@gmail.com";
      assert.equal(
        h.send({ action: "admin.rpc", token: session.token, method: "odList" })
          .ok,
        false,
        mode,
      );
      assert.equal(h.state.calls.length, 0);
      assert.equal(h.c.aaPrincipal_, null);
    }
  },
);
check(
  "review tokens require the same session and action and are consumed after saving",
  () => {
    const h = harness(),
      one = h.login(),
      two = h.login();
    const review = h.send({
      action: "admin.rpc",
      token: one.token,
      method: "odOpenBooking",
      input: "SYNTHETIC-A",
    });
    const save = {
      action: "admin.rpc",
      token: one.token,
      method: "odSaveBooking",
      input: { token: review.token, action: "CONFIRM", confirmed: true },
    };
    assert.equal(h.send({ ...save, token: two.token }).code, "REVIEW_EXPIRED");
    assert.equal(
      h.send({ ...save, method: "odSavePayment" }).code,
      "REVIEW_EXPIRED",
    );
    assert.equal(h.send(save).ok, true);
    assert.equal(h.send(save).code, "REVIEW_EXPIRED");
    assert.equal(
      h.state.calls.filter((x) => x.name === "odSaveBooking").length,
      1,
    );
  },
);
check(
  "legacy Google owner access remains intact without an API principal",
  () => {
    const h = harness();
    h.state.activeEmail = owner;
    assert.equal(h.c.prOwner_().email, owner);
    h.props.set("ADMIN_ENABLED", "false");
    assert.equal(h.c.prOwner_().email, owner);
    assert.equal(
      h.send({ action: "admin.challenge" }).code,
      "ADMIN_NOT_CONFIGURED",
    );
  },
);
