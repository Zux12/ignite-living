const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  { JSDOM } = require("jsdom");
const html = fs.readFileSync(path.join(__dirname, "../admin.html"), "utf8");
const script = fs.readFileSync(
  path.join(__dirname, "../assets/admin/admin.js"),
  "utf8",
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sample = {
  bookingId: "IL-TEST-SYNTHETIC",
  customerName: "<img src=x onerror=alert(1)>",
  customerEmail: "synthetic@example.invalid",
  customerPhone: "TEST ONLY",
  propertyId: "SYNTHETIC-HOME",
  checkin: "2027-01-01",
  checkout: "2027-01-03",
  occupants: 2,
  bookingStatus: "PENDING_REVIEW",
  paymentStatus: "UNPAID",
  totalAmount: 1800,
  bookingDeposit: 500,
  amountPaid: 0,
  balanceDue: 1800,
};
async function setup(t, responder) {
  const calls = [];
  let callback;
  const dom = new JSDOM(html, {
    url: "https://living.igniteinnov.com/admin.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window,
    d = w.document;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.google = {
    accounts: {
      id: {
        initialize(options) {
          callback = options.callback;
          assert.equal(options.nonce, "synthetic-nonce");
        },
        renderButton(element) {
          const b = d.createElement("button");
          b.textContent = "Sign in with Google";
          b.onclick = () => callback({ credential: "synthetic-jwt" });
          element.append(b);
        },
        disableAutoSelect() {},
      },
    },
  };
  w.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/script.google.com\/macros\/s\//);
    assert.equal(options.credentials, "omit");
    const input = JSON.parse(options.body);
    calls.push(input);
    let value = responder?.(input, options, w);
    if (value === undefined) {
      if (input.action === "admin.challenge")
        value = {
          ok: true,
          clientId: "synthetic.apps.googleusercontent.com",
          challengeId: "synthetic-challenge",
          nonce: "synthetic-nonce",
        };
      else if (input.action === "admin.login")
        value = {
          ok: true,
          token: "a".repeat(64),
          expires: Date.now() + 3600000,
          email: "owner@example.invalid",
        };
      else if (input.action === "admin.logout") value = { ok: true };
      else if (input.method === "odList")
        value = { ok: true, bookings: [sample], proofs: [], requests: [] };
      else if (input.method === "odOpenBooking")
        value = { ok: true, token: "synthetic-review", booking: sample };
      else if (input.method === "odSaveBooking")
        value = { ok: true, message: "Synthetic booking confirmed" };
      else throw Error("Unexpected synthetic request: " + input.method);
    }
    return { ok: true, json: async () => await value };
  };
  w.eval(script);
  await tick();
  const login = async () => {
    d.querySelector("#googleSignIn button").click();
    await tick();
  };
  return { w, d, calls, login };
}
test("signed-out admin page requests no records and stores no credentials", async (t) => {
  const h = await setup(t);
  assert.equal(h.d.getElementById("dashboard").hidden, true);
  assert.deepEqual(
    h.calls.map((x) => x.action),
    ["admin.challenge"],
  );
  assert.equal(h.w.localStorage.length, 0);
  assert.equal(h.w.sessionStorage.length, 0);
});
test("signed-in dashboard renders untrusted record text without HTML injection", async (t) => {
  const h = await setup(t);
  await h.login();
  assert.equal(h.d.getElementById("dashboard").hidden, false);
  assert.equal(h.d.querySelector("#list h3").textContent, sample.customerName);
  assert.equal(h.d.querySelector("#list img"), null);
  assert.equal(h.d.querySelectorAll("#tabs button").length, 3);
  assert.equal(h.calls.filter((x) => x.method === "odList").length, 1);
  assert.equal(h.w.localStorage.length, 0);
  assert.equal(h.w.sessionStorage.length, 0);
});
test("unconfigured backend shows setup guidance without a false empty dashboard", async (t) => {
  const h = await setup(t, (input) =>
    input.action === "admin.challenge"
      ? {
          ok: false,
          code: "ADMIN_NOT_CONFIGURED",
          message: "The new admin sign-in is being connected.",
        }
      : undefined,
  );
  assert.equal(h.d.getElementById("dashboard").hidden, true);
  assert.match(
    h.d.getElementById("authMessage").textContent,
    /being connected/,
  );
  assert.equal(h.d.getElementById("retrySignIn").hidden, false);
  assert.equal(h.calls.length, 1);
});
test("sign-out clears records, search and open review details", async (t) => {
  const h = await setup(t);
  await h.login();
  h.d.querySelector("#list button").click();
  await tick();
  assert.equal(h.d.getElementById("dialog").open, true);
  h.d.getElementById("search").value = "synthetic guest";
  h.d.getElementById("signOut").click();
  await tick();
  for (const id of ["stats", "tabs", "list", "detail"])
    assert.equal(h.d.getElementById(id).textContent, "", id);
  assert.equal(h.d.getElementById("search").value, "");
  assert.equal(h.d.getElementById("dialog").open, false);
  assert.equal(h.d.getElementById("dashboard").hidden, true);
  assert.equal(h.calls.at(-1).action, "admin.logout");
});
test("an expired or rejected admin session clears all private UI", async (t) => {
  let expired = false;
  const h = await setup(t, (input) =>
    expired && input.method === "odList"
      ? {
          ok: false,
          code: "AUTH_REQUIRED",
          message: "Your admin session expired.",
        }
      : undefined,
  );
  await h.login();
  expired = true;
  h.d.getElementById("refresh").click();
  await tick();
  assert.equal(h.d.getElementById("list").textContent, "");
  assert.equal(h.d.getElementById("dashboard").hidden, true);
  assert.match(h.d.getElementById("authMessage").textContent, /expired/);
});
test("connection failure preserves the last records and reports that they may be stale", async (t) => {
  let fail = false;
  const h = await setup(t, (input) => {
    if (fail && input.method === "odList")
      throw new TypeError("Synthetic connection failure");
  });
  await h.login();
  fail = true;
  h.d.getElementById("refresh").click();
  await tick();
  assert.match(h.d.getElementById("message").textContent, /out of date/);
  assert.equal(h.d.querySelector("#list h3").textContent, sample.customerName);
  assert.equal(h.d.getElementById("refresh").disabled, false);
});
test("booking approval requires confirmation and prevents duplicate saves", async (t) => {
  let release;
  const h = await setup(t, (input) =>
    input.method === "odSaveBooking"
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined,
  );
  await h.login();
  h.d.querySelector("#list button").click();
  await tick();
  const form = h.d.querySelector("#detail form");
  h.d.getElementById("notes").value = "TEST ONLY";
  form.requestSubmit();
  await tick();
  assert.equal(h.calls.filter((x) => x.method === "odSaveBooking").length, 0);
  h.d.getElementById("confirmed").checked = true;
  form.requestSubmit();
  form.dispatchEvent(
    new h.w.Event("submit", { cancelable: true, bubbles: true }),
  );
  await tick();
  assert.equal(h.calls.filter((x) => x.method === "odSaveBooking").length, 1);
  assert.equal(h.d.getElementById("close").disabled, true);
  assert.ok(
    [...form.querySelectorAll("button,input,select,textarea")].every(
      (e) => e.disabled,
    ),
  );
  release({ ok: true, message: "Synthetic booking confirmed" });
  await tick();
  assert.match(
    h.d.getElementById("detail").textContent,
    /Synthetic booking confirmed/,
  );
});
test("a lost save response instructs a fresh review instead of automatically retrying", async (t) => {
  const h = await setup(t, (input) => {
    if (input.method === "odSaveBooking")
      throw new TypeError("Synthetic lost response");
  });
  await h.login();
  h.d.querySelector("#list button").click();
  await tick();
  h.d.getElementById("notes").value = "TEST ONLY";
  h.d.getElementById("confirmed").checked = true;
  h.d.querySelector("#detail form").requestSubmit();
  await tick();
  assert.match(
    h.d.getElementById("detail").textContent,
    /Close and reopen this review before retrying/,
  );
  assert.equal(h.calls.filter((x) => x.method === "odSaveBooking").length, 1);
  assert.equal(h.d.querySelector("#detail button[type=submit]").disabled, true);
});
test("receipt links outside Google Drive are rejected", async (t) => {
  const h = await setup(t, (input) =>
    input.method === "odList"
      ? {
          ok: true,
          bookings: [sample],
          proofs: [
            {
              proofId: "SYNTHETIC-PROOF",
              bookingId: sample.bookingId,
              reviewStatus: "AWAITING_VERIFICATION",
              claimedAmount: 500,
            },
          ],
          requests: [],
        }
      : input.method === "odOpenPayment"
        ? {
            ok: true,
            url: "javascript:alert(1)",
            proof: { reviewStatus: "AWAITING_VERIFICATION" },
            booking: sample,
          }
        : undefined,
  );
  await h.login();
  h.d.querySelectorAll("#tabs button")[1].click();
  h.d.querySelector("#list button").click();
  await tick();
  assert.equal(h.d.querySelector("#detail a"), null);
  assert.match(
    h.d.getElementById("detail").textContent,
    /could not be verified/,
  );
});
