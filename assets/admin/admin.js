"use strict";
(() => {
  const API =
    "https://script.google.com/macros/s/AKfycbz1Vb_WMbyij69uPshUVRImmNF9yLI4eNnte-qD85J9T244vDIVs0EFa4IXsI7c1qBM/exec";
  const $ = (id) => document.getElementById(id);
  let data = { bookings: [], proofs: [], requests: [] },
    tab = "bookings",
    busy = false;
  let sessionToken = "",
    sessionExpires = 0,
    sessionEpoch = 0,
    expiryTimer;
  const requests = new Set();
  const money = (value) =>
    "RM " +
    Number(value || 0).toLocaleString("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const day = (value) => String(value || "").slice(0, 10),
    label = (value) =>
      String(value || "")
        .replace(/_/g, " ")
        .toLowerCase();
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function notice(text) {
    $("message").textContent = text;
  }
  function clearSession(message) {
    sessionEpoch++;
    sessionToken = "";
    sessionExpires = 0;
    clearTimeout(expiryTimer);
    for (const controller of requests) controller.abort();
    requests.clear();
    data = { bookings: [], proofs: [], requests: [] };
    tab = "bookings";
    busy = false;
    for (const id of ["stats", "tabs", "list", "detail"])
      $(id).replaceChildren();
    $("search").value = "";
    $("pending").checked = true;
    notice("");
    $("updated").textContent = "";
    if ($("dialog").open) $("dialog").close();
    $("dashboard").hidden = true;
    $("signOut").hidden = true;
    $("signIn").hidden = false;
    $("googleSignIn").replaceChildren();
    $("authMessage").textContent = message;
    $("retrySignIn").hidden = false;
    $("retrySignIn").focus();
    receiptUI.reset();
  }
  async function api(action, payload = {}) {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 45000);
    requests.add(controller);
    try {
      const response = await fetch(API, {
        method: "POST",
        credentials: "omit",
        redirect: "follow",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "admin." + action,
          origin: location.origin,
          ...payload,
        }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error("Connection unavailable. Please try again.");
      const result = await response.json();
      if (!result || typeof result.ok !== "boolean")
        throw new Error(
          "The admin connection returned an unexpected response.",
        );
      if (!result.ok) {
        const error = new Error(
          result.message || "Unable to complete this admin action.",
        );
        error.code = result.code;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === "AbortError")
        throw new Error(
          "The connection timed out. Refresh records before retrying a change.",
        );
      if (error instanceof SyntaxError)
        throw new Error(
          "The admin connection is not ready. Please try again later.",
        );
      throw error;
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
    }
  }
  async function rpc(method, input) {
    if (!sessionToken || Date.now() >= sessionExpires) {
      clearSession("Your admin session expired. Reload to sign in again.");
      throw new Error("Please sign in again.");
    }
    const epoch = sessionEpoch;
    try {
      const result = await api("rpc", { token: sessionToken, method, input });
      if (epoch !== sessionEpoch)
        throw new Error("Your session changed. Please sign in again.");
      return result;
    } catch (error) {
      if (
        epoch === sessionEpoch &&
        ["AUTH_REQUIRED", "ADMIN_NOT_CONFIGURED"].includes(error.code)
      )
        clearSession(error.message);
      throw error;
    }
  }
  async function load() {
    if (busy || !sessionToken) return false;
    busy = true;
    $("refresh").disabled = true;
    const epoch = sessionEpoch;
    try {
      const result = await rpc("odList");
      if (epoch !== sessionEpoch) return false;
      if (
        !["bookings", "proofs", "requests"].every((key) =>
          Array.isArray(result[key]),
        )
      )
        throw new Error("The record list is incomplete. Please refresh again.");
      data = {
        bookings: result.bookings,
        proofs: result.proofs,
        requests: result.requests,
      };
      $("updated").textContent =
        "Updated " +
        new Intl.DateTimeFormat("en-MY", {
          timeZone: "Asia/Kuala_Lumpur",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date());
      render();
      return true;
    } catch (error) {
      if (epoch === sessionEpoch)
        notice(
          error.message + " Your last displayed records may be out of date.",
        );
      return false;
    } finally {
      if (epoch === sessionEpoch) {
        busy = false;
        $("refresh").disabled = false;
      }
    }
  }
  function safeReceiptUrl(value) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "drive.google.com" ||
      url.username ||
      url.password
    )
      throw new Error("The receipt link could not be verified.");
    return url.href;
  }
  function googleLibrary() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "Google sign-in did not load. Check your connection and reload this page.",
            ),
          ),
        15000,
      );
      script.onload = () => {
        clearTimeout(timeout);
        window.google?.accounts?.id
          ? resolve()
          : reject(
              new Error("Google sign-in is unavailable. Reload to try again."),
            );
      };
      script.onerror = () => {
        clearTimeout(timeout);
        reject(
          new Error(
            "Google sign-in did not load. Check your connection and reload this page.",
          ),
        );
      };
      document.head.append(script);
    });
  }
  async function start() {
    try {
      const challenge = await api("challenge");
      if (!challenge.clientId || !challenge.challengeId || !challenge.nonce)
        throw new Error("The admin connection is not ready yet.");
      await googleLibrary();
      let signingIn = false;
      window.google.accounts.id.initialize({
        client_id: challenge.clientId,
        nonce: challenge.nonce,
        auto_select: false,
        ux_mode: "popup",
        context: "signin",
        callback: async (response) => {
          if (signingIn || sessionToken) return;
          signingIn = true;
          $("authMessage").textContent = "Checking owner access…";
          try {
            const result = await api("login", {
              challengeId: challenge.challengeId,
              credential: response.credential,
            });
            if (
              !/^[a-f0-9]{64}$/.test(result.token || "") ||
              !Number.isFinite(result.expires) ||
              result.expires <= Date.now()
            )
              throw new Error(
                "Admin sign-in could not be completed. Reload to try again.",
              );
            sessionToken = result.token;
            sessionExpires = result.expires;
            sessionEpoch++;
            $("signIn").hidden = true;
            $("dashboard").hidden = false;
            $("signOut").hidden = false;
            $("authMessage").textContent = "";
            expiryTimer = setTimeout(
              () =>
                clearSession(
                  "Your admin session expired. Reload to sign in again.",
                ),
              Math.min(3600000, sessionExpires - Date.now()),
            );
            await load();
            if (sessionToken) receiptUI.signedIn();
            if (sessionToken) $("refresh").focus();
          } catch (error) {
            clearSession(error.message);
          } finally {
            signingIn = false;
          }
        },
      });
      window.google.accounts.id.renderButton($("googleSignIn"), {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
      });
      $("authMessage").textContent =
        "Only the authorised owner account can access records.";
    } catch (error) {
      $("authMessage").textContent = error.message;
      $("retrySignIn").hidden = false;
    }
  }
  $("retrySignIn").onclick = () => location.reload();
  window.addEventListener("pagehide", () =>
    clearSession("Reload to sign in again."),
  );
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  $("signOut").onclick = async () => {
    if (busy) {
      notice("Wait for the current action to finish before signing out.");
      return;
    }
    const previous = sessionToken;
    clearSession(
      "Signed out. Reload this page when you want to sign in again.",
    );
    window.google?.accounts?.id?.disableAutoSelect();
    try {
      await api("logout", { token: previous });
    } catch (_) {
      $("authMessage").textContent =
        "This page is signed out. Server sign-out could not be confirmed; the session will expire automatically.";
    }
  };
  // Existing booking, receipt and request review components follow below.
  function need(r) {
    return tab === "bookings"
      ? r.bookingStatus === "PENDING_REVIEW"
      : tab === "proofs"
        ? r.reviewStatus === "AWAITING_VERIFICATION"
        : ["PENDING", "APPROVED_REFUND_PENDING"].includes(r.status);
  }
  function booking(id) {
    return data.bookings.find((b) => b.bookingId === id) || {};
  }
  function render() {
    $("stats").replaceChildren();
    const stats = [
      [
        "Bookings to review",
        data.bookings.filter((b) => b.bookingStatus === "PENDING_REVIEW")
          .length,
      ],
      [
        "Receipts to verify",
        data.proofs.filter((p) => p.reviewStatus === "AWAITING_VERIFICATION")
          .length,
      ],
      [
        "Requests to review",
        data.requests.filter((r) => r.status === "PENDING").length,
      ],
      [
        "Refunds to complete",
        data.requests.filter((r) => r.status === "APPROVED_REFUND_PENDING")
          .length,
      ],
    ];
    stats.forEach(([name, n]) => {
      const c = el("div", undefined, "stat");
      c.append(el("strong", n), el("span", name));
      $("stats").append(c);
    });
    $("tabs").replaceChildren();
    [
      ["bookings", "Bookings"],
      ["proofs", "Payment proofs"],
      ["requests", "Stay requests"],
    ].forEach(([key, name]) => {
      const b = el("button", name);
      b.setAttribute("aria-pressed", String(tab === key));
      b.onclick = () => {
        tab = key;
        render();
      };
      $("tabs").append(b);
    });
    $("list").replaceChildren();
    const query = $("search").value.trim().toLowerCase();
    let rows = data[tab].filter(
      (r) =>
        (!$("pending").checked || need(r)) &&
        JSON.stringify([r, booking(r.bookingId)])
          .toLowerCase()
          .includes(query),
    );
    rows = rows.slice().reverse();
    if (!rows.length)
      $("list").append(
        el(
          "p",
          "No matching records. Clear “Needs attention only” to view history.",
        ),
      );
    rows.forEach((r) => {
      const b = tab === "bookings" ? r : booking(r.bookingId),
        c = el("section", undefined, "card");
      c.append(
        el("h3", b.customerName || "Guest"),
        el("div", r.bookingId, "muted"),
      );
      c.append(
        el(
          "span",
          label(
            tab === "bookings"
              ? r.bookingStatus
              : tab === "proofs"
                ? r.reviewStatus
                : r.status,
          ),
          "badge",
        ),
      );
      if (tab === "bookings") {
        c.append(
          el("span", label(b.paymentStatus), "badge"),
          el(
            "p",
            day(b.checkin) +
              " → " +
              day(b.checkout) +
              " · " +
              b.occupants +
              " guests",
          ),
          el(
            "p",
            "Total " +
              money(b.totalAmount) +
              " · Paid " +
              money(b.amountPaid) +
              " · Balance " +
              money(b.balanceDue),
          ),
        );
      } else if (tab === "proofs")
        c.append(
          el(
            "p",
            "Claimed " + money(r.claimedAmount) + " · " + day(r.paymentDate),
          ),
        );
      else
        c.append(el("p", label(r.type) + " request · " + day(r.submittedAt)));
      const button = el(
        "button",
        tab === "proofs"
          ? "View receipt / review"
          : tab === "requests"
            ? "View request / review"
            : "View booking",
        "primary",
      );
      button.onclick = () => openRecord(tab, r);
      c.append(button);
      $("list").append(c);
    });
  }
  function details(pairs) {
    const d = el("dl");
    pairs.forEach(([k, v]) => d.append(el("dt", k), el("dd", v)));
    return d;
  }
  function field(form, id, title, type, value) {
    const l = el("label", title);
    l.htmlFor = id;
    const n = el(type === "textarea" ? "textarea" : "input");
    n.id = id;
    if (type !== "textarea") n.type = type;
    if (value !== undefined) n.value = value;
    form.append(l, n);
    return n;
  }
  function select(form, id, title, options) {
    const l = el("label", title);
    l.htmlFor = id;
    const n = el("select");
    n.id = id;
    options.forEach(([v, t]) => {
      const o = el("option", t);
      o.value = v;
      n.append(o);
    });
    form.append(l, n);
    return n;
  }
  function check(form, id, title) {
    const l = el("label"),
      n = el("input");
    n.type = "checkbox";
    n.id = id;
    l.append(n, document.createTextNode(title));
    form.append(l);
    return n;
  }
  function formSave(form, method, build) {
    const controls = el("div", undefined, "actions"),
      save = el("button", "Confirm and save", "primary"),
      msg = el("p", "", "message");
    save.type = "submit";
    controls.append(save);
    form.append(controls, msg);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      const epoch = sessionEpoch;
      busy = true;
      $("close").disabled = true;
      const inputs = [...form.querySelectorAll("button,input,select,textarea")];
      const payload = build();
      inputs.forEach((n) => (n.disabled = true));
      msg.textContent = "Saving…";
      try {
        const result = await rpc(method, payload);
        if (epoch !== sessionEpoch) return;
        $("detail").replaceChildren(el("p", result.message, "summary"));
        notice(result.message);
      } catch (err) {
        if (epoch === sessionEpoch)
          msg.textContent =
            (err.message || String(err)) +
            " Close and reopen this review before retrying.";
      } finally {
        if (epoch === sessionEpoch) {
          busy = false;
          $("close").disabled = false;
          await load();
        }
      }
    };
  }
  async function openRecord(kind, r) {
    if (busy) return;
    const epoch = sessionEpoch;
    busy = true;
    $("detail").replaceChildren(el("p", "Loading…"));
    $("title").textContent =
      kind === "proofs"
        ? "Payment review"
        : kind === "requests"
          ? "Stay request"
          : "Booking details";
    $("dialog").showModal();
    try {
      const x = await rpc(
        kind === "proofs"
          ? "odOpenPayment"
          : kind === "requests"
            ? "odOpenRequest"
            : "odOpenBooking",
        kind === "proofs"
          ? r.proofId
          : kind === "requests"
            ? r.requestId
            : r.bookingId,
      );
      if (epoch !== sessionEpoch) return;
      $("detail").replaceChildren();
      if (kind === "proofs") payment(x);
      else if (kind === "requests") request(x);
      else book(x);
    } catch (e) {
      if (epoch === sessionEpoch)
        $("detail").replaceChildren(el("p", e.message || String(e), "warning"));
    } finally {
      if (epoch === sessionEpoch) busy = false;
    }
  }
  function payment(x) {
    const d = $("detail"),
      p = x.proof,
      b = x.booking,
      test = b.bookingId.startsWith("IL-TEST-");
    d.append(
      details([
        ["Guest", b.customerName],
        ["Booking", b.bookingId],
        ["Booking status", label(b.bookingStatus)],
        ["Payment review", label(p.reviewStatus)],
        ["Total", money(b.totalAmount)],
        ["Verified paid", money(b.amountPaid)],
        ["Claimed amount", money(p.claimedAmount)],
        ["Payment date", day(p.paymentDate)],
        ["Customer reference", p.reference || "—"],
      ]),
    );
    const a = el("a", "Open uploaded receipt ↗", "receipt");
    a.href = safeReceiptUrl(x.url);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    d.append(a);
    if (p.reviewNotes) d.append(el("p", p.reviewNotes));
    if (b.bookingStatus === "CANCELLED") {
      d.append(
        el("p", "This booking is cancelled. Payment reviews are locked."),
      );
      return;
    }
    if (test)
      d.append(
        el(
          "p",
          "TEST BOOKING: no real payment. Add a TEST ONLY note. If you enter a bank reference, use a TEST- prefix.",
          "warning",
        ),
      );
    const f = el("form"),
      action = select(
        f,
        "action",
        "Action",
        p.reviewStatus === "AWAITING_VERIFICATION"
          ? [
              ["APPROVE", "Approve payment"],
              ["REJECT", "Reject proof"],
            ]
          : [["UNDO", "Undo review"]],
      ),
      approval = el("div");
    f.append(approval);
    const purpose = select(approval, "purpose", "Payment purpose", [
        ["DEPOSIT", "Booking deposit"],
        ["BALANCE", "Remaining balance"],
        ["FULL_PAYMENT", "Full payment"],
        ["OTHER", "Other instalment"],
      ]),
      amount = field(
        approval,
        "amount",
        "Actual amount received (RM)",
        "number",
        p.claimedAmount,
      );
    amount.min = "0.01";
    amount.max = "1000000";
    amount.step = "0.01";
    const ref = field(
      approval,
      "ref",
      "Verified bank transaction reference (optional)",
      "text",
    );
    ref.maxLength = 120;
    const confirmed = check(
      approval,
      "confirmed",
      test
        ? "This is a simulated payment approval."
        : "I checked this payment against my bank records.",
    );
    const notes = field(f, "notes", "Review notes / reason", "textarea");
    notes.maxLength = 500;
    const preview = el("p", "", "summary");
    f.append(preview);
    function update() {
      const yes = action.value === "APPROVE";
      approval.hidden = !yes;
      amount.required = yes;
      confirmed.required = yes;
      notes.required = action.value !== "APPROVE" || test;
      const paid =
        Number(b.amountPaid) - x.oldApproved + (yes ? Number(amount.value) : 0);
      preview.textContent =
        "After saving: " +
        money(paid) +
        " paid · " +
        money(Number(b.totalAmount) - paid) +
        " outstanding. Booking status stays unchanged.";
    }
    action.onchange = update;
    amount.oninput = update;
    update();
    formSave(f, "odSavePayment", () => ({
      token: x.token,
      action: action.value,
      amount: amount.value,
      purpose: purpose.value,
      bankReference: ref.value,
      confirmed: confirmed.checked,
      notes: notes.value,
    }));
    d.append(f);
  }
  function request(x) {
    const d = $("detail"),
      r = x.request,
      b = x.booking,
      q = x.quote,
      p = x.payload;
    d.append(
      details([
        ["Guest", b.customerName],
        ["Booking", b.bookingId],
        ["Request", label(r.type)],
        ["Status", label(r.status)],
        ["Current dates", day(b.checkin) + " → " + day(b.checkout)],
        ["Verified paid", money(b.amountPaid)],
        ["Reason", p.reason],
      ]),
    );
    if (r.type === "DATES")
      d.append(
        details([
          ["Requested dates", q.checkin + " → " + q.checkout],
          ["New rental", money(q.rentalTotal)],
          ["Change fee", money(q.fee)],
          ["Total charges", money(q.totalAmount)],
          ["Balance after approval", money(q.balanceDue)],
        ]),
      );
    if (r.type === "GUEST")
      d.append(
        details([
          ["Replacement guest", p.customerName],
          ["Phone", p.phone || "—"],
          ["Email", p.email || "—"],
          ["Fee", money(0)],
        ]),
        el(
          "p",
          "This updates the check-in guest. Account ownership remains with the original customer.",
        ),
      );
    if (r.type === "CANCEL") {
      d.append(
        details([
          ["Amount retained", money(q.retained)],
          ["Refund", money(q.refund)],
          ["Bank", p.bankName || "—"],
          ["Account holder", p.accountName || "—"],
          ["Account number", p.accountNumber || "—"],
        ]),
      );
    }
    if (r.reviewNotes) d.append(el("p", r.reviewNotes));
    if (!["PENDING", "APPROVED_REFUND_PENDING"].includes(r.status)) {
      if (r.refundDate)
        d.append(
          el(
            "p",
            "Refund recorded " + day(r.refundDate) + " · " + r.refundReference,
          ),
        );
      return;
    }
    const refund = r.status === "APPROVED_REFUND_PENDING",
      test = b.bookingId.startsWith("IL-TEST-");
    if (test)
      d.append(
        el(
          "p",
          "TEST BOOKING: use a TEST ONLY note. Do not transfer real money.",
          "warning",
        ),
      );
    if (refund)
      d.append(
        el(
          "p",
          "Record this only after making and checking the bank transfer. This dashboard does not send money.",
          "warning",
        ),
      );
    const f = el("form"),
      action = select(
        f,
        "action",
        "Action",
        refund
          ? [["REFUND_COMPLETE", "Record completed refund"]]
          : [
              ["APPROVE", "Approve request"],
              ["REJECT", "Reject request"],
            ],
      ),
      notes = field(f, "notes", "Review notes / reason", "textarea");
    notes.maxLength = 500;
    notes.required = test;
    action.onchange = () =>
      (notes.required = test || action.value === "REJECT");
    let date, ref, confirmed;
    if (refund) {
      date = field(f, "refundDate", "Actual refund date", "date");
      date.required = true;
      ref = field(f, "refundReference", "Refund transfer reference", "text");
      ref.maxLength = 120;
      ref.required = true;
      confirmed = check(
        f,
        "confirmed",
        test
          ? "This is a simulated refund; no money was transferred."
          : "I completed and checked the refund transfer.",
      );
      confirmed.required = true;
    }
    formSave(f, "odSaveRequest", () => ({
      token: x.token,
      action: action.value,
      notes: notes.value,
      refundDate: date ? date.value : "",
      refundReference: ref ? ref.value : "",
      confirmed: confirmed ? confirmed.checked : false,
    }));
    d.append(f);
  }
  function book(x) {
    const d = $("detail"),
      b = x.booking;
    d.append(
      details([
        ["Guest", b.customerName],
        ["Booking", b.bookingId],
        ["Property", b.propertyId],
        ["Phone", b.customerPhone || "—"],
        ["Email", b.customerEmail || "—"],
        ["Dates", day(b.checkin) + " → " + day(b.checkout)],
        ["Guests", b.occupants],
        ["Booking status", label(b.bookingStatus)],
        ["Payment status", label(b.paymentStatus)],
        ["Total charges", money(b.totalAmount)],
        ["Booking deposit", money(b.bookingDeposit)],
        ["Verified paid", money(b.amountPaid)],
        ["Outstanding", money(b.balanceDue)],
      ]),
    );
    if (b.notes) d.append(el("p", b.notes));
    if (b.bookingStatus !== "PENDING_REVIEW") {
      d.append(
        el(
          "p",
          "Use Payment proofs for receipts and Stay requests for submitted changes, cancellations or refunds.",
        ),
      );
      return;
    }
    const f = el("form"),
      action = select(f, "action", "Decision", [
        ["CONFIRM", "Confirm booking and reserve dates"],
        ["REJECT", "Reject unpaid booking"],
      ]),
      notes = field(f, "notes", "Owner notes / reason", "textarea");
    notes.maxLength = 500;
    const preview = el("p", "", "summary");
    f.append(preview);
    const confirmed = check(
      f,
      "confirmed",
      "I have reviewed this booking and want to apply the selected decision.",
    );
    confirmed.required = true;
    function update() {
      notes.required =
        action.value === "REJECT" || b.bookingId.startsWith("IL-TEST-");
      preview.textContent =
        action.value === "CONFIRM"
          ? "Availability will be checked again before reserving the dates. The agreed price and paid amount stay unchanged."
          : "Rejection is allowed only with no verified payments or pending receipts. Total charges and balance become zero.";
    }
    action.onchange = update;
    update();
    formSave(f, "odSaveBooking", () => ({
      token: x.token,
      action: action.value,
      notes: notes.value,
      confirmed: confirmed.checked,
    }));
    d.append(f);
  }
  $("refresh").onclick = () => {
    notice("");
    load();
  };
  $("close").onclick = () => {
    if (!busy) $("dialog").close();
  };
  $("dialog").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  $("search").oninput = render;
  $("pending").onchange = render;

  const receiptUI = window.createReceiptWorkspace({
    rpc, canStart: () => Boolean(sessionToken) && !busy,
    setWorking: (value) => { busy = value; $("refresh").disabled = value; },
  });
  start();
})();
