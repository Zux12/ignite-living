"use strict";
window.createReceiptWorkspace = ({ rpc, canStart, setWorking }) => {
  const $ = id => document.getElementById(id), root = $("receiptsWorkspace"), model = IgniteReceipt;
  let epoch = 0, working = false, receipt = null, retry = null;
  const issuer = { brand: "IGNITE LIVING", company: "IgniteInno Ventures Sdn Bhd", phone: "019-345 5154", email: "info@igniteinnov.com" };
  const moneyFields = [
    ["rental", "Stay / rental charges"], ["extras", "Other charges"], ["discount", "Discount"],
    ["depositPaid", "Booking deposit received"], ["otherPaid", "Other stay payments received"], ["paymentRefund", "Stay payment refunded"],
    ["securityPaid", "Refundable security deposit received"], ["securityRefund", "Security deposit refunded"],
  ];
  function node(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
  function button(text, action, cls) { const b = node("button", text, cls); b.type = "button"; b.onclick = action; return b; }
  function localDate(value = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(value); }
  function dateLabel(s) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(s + "T00:00:00Z")); }
  function paper(r) {
    const p = node("article", undefined, "receipt-paper"), d = r.details, a = d.amounts, t = r.totals, i = r.issuer || issuer;
    const head = node("div", undefined, "receipt-letterhead"), logo = node("img", undefined, "receipt-logo"), brand = node("div", undefined, "receipt-issuer");
    logo.src = "assets/brand/ignite-living-logo-v1.png"; logo.alt = i.brand; logo.width = 2098; logo.height = 750;
    brand.append(node("p", i.company), node("p", i.phone), node("p", i.email));
    head.append(logo, brand); p.append(head);
    const title = node("div", undefined, "receipt-title-row"), meta = node("div", undefined, "receipt-meta");
    meta.append(node("strong", r.number || "DRAFT · NOT SAVED"), node("span", r.savedAt ? "Issued " + dateLabel(localDate(new Date(r.savedAt))) : "A number is assigned when saved"));
    title.append(node("h1", "RECEIPT"), meta); p.append(title);
    const guest = node("div", undefined, "receipt-guest");
    for (const [label, value] of [["Received from", d.name], ["Handphone", d.phone], ["Property / stay", d.property], ["Stay dates", dateLabel(d.checkin) + " – " + dateLabel(d.checkout)], ["Payment date", dateLabel(d.paymentDate)], ["Payment method", d.method], ...(d.reference ? [["Reference", d.reference]] : [])]) {
      const row = node("div"); row.append(node("span", label), node("strong", value)); guest.append(row);
    }
    p.append(guest);
    const table = node("table", undefined, "receipt-amounts"), body = node("tbody");
    function row(label, value, cls) { const tr = node("tr", undefined, cls); tr.append(node("th", label), node("td", model.money(value))); body.append(tr); }
    row("Stay / rental charges", a.rental); if (a.extras) row("Other charges", a.extras); if (a.discount) row("Less: discount", -a.discount);
    row("Total stay charges", t.charges, "receipt-subtotal");
    row("Booking deposit received", a.depositPaid); row("Other stay payments received", a.otherPaid);
    if (a.paymentRefund) row("Less: stay payment refunded", -a.paymentRefund);
    row("Net stay payments", t.stayPaid, "receipt-subtotal");
    row("Outstanding stay balance", t.balanceDue);
    if (t.creditDue) row("Stay payment credit", t.creditDue);
    if (a.securityPaid || a.securityRefund) {
      row("Refundable security deposit received", a.securityPaid);
      if (a.securityRefund) row("Less: security deposit refunded", -a.securityRefund);
      row("Security deposit held", t.securityHeld);
    }
    if (t.totalRefund) row("Total refunds recorded", t.totalRefund);
    row("NET AMOUNT RECEIVED", t.netReceived, "receipt-grand-total");
    table.append(body); p.append(table);
    p.append(node("p", "Booking deposits form part of stay payments. Refundable security deposits are shown separately and are not stay charges.", "receipt-explanation"));
    if (d.notes) { const notes = node("div", undefined, "receipt-notes"); notes.append(node("strong", "Notes"), node("p", d.notes)); p.append(notes); }
    const bottom = node("div", undefined, "receipt-bottom");
    if (d.promotionText) { const promo = node("div", undefined, "receipt-promotion"); promo.append(node("h3", d.promotionTitle || "For your next stay"), node("p", d.promotionText)); bottom.append(promo); }
    bottom.append(node("p", "Thank you for choosing Ignite Living.", "receipt-thanks"), node("p", "Computer-generated receipt. No signature is required.", "receipt-fineprint"));
    p.append(bottom); return p;
  }
  root.innerHTML = `<div class="receipt-tool-heading"><div><p class="eyebrow">PAYMENTS, ON PAPER</p><h2 id="receiptsTitle">Receipt generator</h2><p class="muted">Create a receipt for any stay. Save once, then print or reopen it whenever you need.</p></div></div>
    <div class="receipt-editor-layout"><div class="receipt-form-panel"><form id="receiptForm"><h3>Customer &amp; stay</h3>
    <div class="receipt-fields" id="receiptCustomerFields"></div><h3>Charges &amp; payments <small>MYR / RM</small></h3>
    <p class="muted">Enter amounts already received or refunded. A booking deposit counts towards the stay; a refundable security deposit is tracked separately.</p>
    <div class="receipt-fields" id="receiptMoneyFields"></div>
    <label for="receiptNotes">Notes (optional)</label><textarea id="receiptNotes" maxlength="220" rows="2"></textarea>
    <details class="receipt-promo-settings"><summary>Returning-customer promotions</summary>
      <label class="receipt-promo-toggle"><input id="receiptIncludePromotion" type="checkbox">Include promotions at the bottom of this receipt</label>
      <div id="receiptPromotionChoices" hidden>
        <fieldset class="receipt-promo-offers"><legend>Tick the offers for this customer</legend><div class="receipt-promo-grid">
          ${[10,20,30,40,50].map(rate => `<label><input id="receiptPromo${rate}" type="checkbox">${rate}% discount</label>`).join("")}
          <label><input id="receiptPromoFreeDay" type="checkbox">1 free day</label>
        </div></fieldset>
        <div id="receiptFreeDayField" hidden><label for="receiptFreeDayDate">Free-day date — valid on this date only</label><input id="receiptFreeDayDate" type="date" min="2027-01-01" max="2099-12-31" aria-describedby="receiptPromotionValidity" disabled></div>
        <p class="receipt-promo-loyalty"><strong>Always included:</strong> Every 3 stays, get 1 free night.</p>
        <p id="receiptPromotionValidity" class="muted">All promotions are valid for stays from 1 January 2027 (after December 2026).</p>
        <p class="muted">These offers are for a future stay. They do not change the charges on this receipt.</p>
      </div>
      <div id="receiptPromotionMessage" hidden><label for="receiptPromotionTitle">Heading</label><input id="receiptPromotionTitle" maxlength="65" placeholder="Returning-customer offers"><label for="receiptPromotionText">Promotion printed on the receipt</label><textarea id="receiptPromotionText" rows="5" readonly></textarea></div>
    </details>
    <label class="receipt-confirm"><input id="receiptConfirmed" type="checkbox">I confirm these details and amounts received / refunded are correct.</label>
    <div class="actions"><button id="receiptPreviewButton" type="button">Preview A4</button><button id="receiptSave" class="primary" type="submit">Save &amp; issue receipt</button></div>
    <p class="muted">Saved receipts keep their number and original details. Creating a receipt does not change booking records or move money.</p></form>
    <div id="receiptSavedActions" class="actions" hidden><button id="receiptPrintButton" class="primary" type="button">Print / Save PDF</button><button id="receiptNew" type="button">New receipt</button></div>
    <p id="receiptMessage" class="message" role="status" aria-live="polite"></p></div>
    <div class="receipt-preview-panel"><div class="receipt-preview-label">A4 preview <span id="receiptPreviewStatus">Not saved</span></div><div id="receiptPreview"><div class="receipt-empty"><h3>Your receipt, ready to keep.</h3><p>Enter the details, then choose Preview A4.</p><p>A receipt number is assigned only when you save.</p></div></div></div></div>
    <section class="receipt-history" aria-labelledby="receiptHistoryTitle"><div class="receipt-history-head"><div><h3 id="receiptHistoryTitle">Saved receipts</h3><p class="muted" id="receiptHistoryCount"></p></div><form id="receiptSearchForm"><label for="receiptSearch">Find a receipt</label><div class="toolbar"><input id="receiptSearch" type="search" maxlength="100" placeholder="Number, name, phone or property"><button type="submit">Search / refresh</button></div></form></div><p id="receiptHistoryMessage" role="status"></p><div id="receiptHistoryList"></div></section>`;
  function field(key, label, type, required, maxLength) {
    const wrap = node("div"), id = "receipt-" + key, lab = node("label", label), input = node("input"); lab.htmlFor = id; input.id = id; input.name = key; input.type = type; input.required = required;
    if (maxLength) input.maxLength = maxLength; if (type === "text" || type === "tel") input.autocomplete = "off";
    wrap.append(lab, input); $("receiptCustomerFields").append(wrap);
  }
  for (const args of [["name", "Customer name", "text", true, 100], ["phone", "Handphone", "tel", true, 30], ["property", "Property / stay description", "text", true, 100], ["paymentDate", "Payment date", "date", true], ["checkin", "Check-in", "date", true], ["checkout", "Check-out", "date", true], ["method", "Payment method", "text", true, 40], ["reference", "Reference (optional)", "text", false, 80]]) field(...args);
  for (const [key, label] of moneyFields) { const wrap = node("div"), lab = node("label", label), input = node("input"); lab.htmlFor = input.id = "receipt-" + key; input.type = "number"; input.min = "0"; input.max = "1000000"; input.step = "0.01"; input.inputMode = "decimal"; input.value = "0.00"; wrap.append(lab, input); $("receiptMoneyFields").append(wrap); }
  function message(s) { $("receiptMessage").textContent = s; }
  function promotionText(validate = false) {
    if (!$("receiptIncludePromotion").checked) return "";
    const offers = [], discounts = [10,20,30,40,50].filter(rate => $("receiptPromo" + rate).checked);
    if (discounts.length) offers.push("Return-stay discounts: " + discounts.map(rate => rate + "%").join(", ") + ".");
    if ($("receiptPromoFreeDay").checked) {
      const value = $("receiptFreeDayDate").value, date = new Date(value + "T00:00:00Z");
      const valid = /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "2027-01-01";
      if (validate && !valid) throw Error("Choose the free-day date from 1 January 2027 onwards.");
      offers.push(valid ? "1 free day: " + dateLabel(value) + " only." : "1 free day: select a date.");
    }
    offers.push("Every 3 stays, get 1 free night.", "Valid for stays from 1 Jan 2027 (after Dec 2026).");
    return offers.join(" ");
  }
  function syncPromotions() {
    const included = $("receiptIncludePromotion").checked, freeDay = included && $("receiptPromoFreeDay").checked;
    $("receiptPromotionChoices").hidden = !included; $("receiptPromotionMessage").hidden = !included;
    $("receiptFreeDayField").hidden = !freeDay; $("receiptFreeDayDate").disabled = !freeDay; $("receiptFreeDayDate").required = freeDay;
    $("receiptPromotionText").value = promotionText();
  }
  for (const id of ["receiptIncludePromotion", ...[10,20,30,40,50].map(rate => "receiptPromo" + rate), "receiptPromoFreeDay", "receiptFreeDayDate"]) $(id).addEventListener("input", syncPromotions);
  function raw() { const d = { amounts: {}, includePromotion: $("receiptIncludePromotion").checked, notes: $("receiptNotes").value, promotionTitle: $("receiptPromotionTitle").value || "Returning-customer offers", promotionText: promotionText(true) }; for (const key of ["name", "phone", "property", "paymentDate", "checkin", "checkout", "method", "reference"]) d[key] = $("receipt-" + key).value; for (const [key] of moneyFields) d.amounts[key] = $("receipt-" + key).value; return d; }
  function lockForm(locked) { for (const input of $("receiptForm").querySelectorAll("input,textarea,button")) input.disabled = locked; if (!locked) syncPromotions(); }
  function show(r) {
    receipt = r.number ? r : null; $("receiptPreview").replaceChildren(paper(r)); $("receiptPreviewStatus").textContent = r.number || "Draft · not saved";
    $("receiptPrint").replaceChildren(); $("receiptPrint").hidden = true; $("receiptSavedActions").hidden = !r.number;
    if (r.number) {
      retry = null;
      for (const key of ["name", "phone", "property", "paymentDate", "checkin", "checkout", "method", "reference"]) $("receipt-" + key).value = r.details[key];
      for (const [key] of moneyFields) $("receipt-" + key).value = (r.details.amounts[key] / 100).toFixed(2);
      $("receiptNotes").value = r.details.notes; $("receiptPromotionTitle").value = r.details.promotionTitle; $("receiptPromotionText").value = r.details.promotionText;
      $("receiptIncludePromotion").checked = Boolean(r.details.promotionText); $("receiptConfirmed").checked = true; lockForm(true);
      $("receiptPromotionChoices").hidden = true; $("receiptPromotionMessage").hidden = !r.details.promotionText;
    }
  }
  function newDraft() {
    receipt = null; retry = null; $("receiptForm").reset(); lockForm(false);
    $("receipt-paymentDate").value = localDate(); $("receipt-method").value = "Bank transfer";
    $("receiptPreview").replaceChildren(node("p", "Enter customer details and choose Preview A4.", "receipt-empty"));
    $("receiptPreviewStatus").textContent = "Not saved"; $("receiptSavedActions").hidden = true;
    $("receiptPrint").replaceChildren(); $("receiptPrint").hidden = true; $("receiptSave").textContent = "Save & issue receipt"; message("");
    $("receiptPrintButton").disabled = false;
  }
  async function history() {
    const e = epoch; $("receiptHistoryMessage").textContent = "Loading saved receipts…";
    try {
      const result = await rpc("rrList", { query: $("receiptSearch").value }); if (e !== epoch) return;
      if (!Array.isArray(result.receipts)) throw Error("Saved receipts could not be loaded.");
      $("receiptHistoryCount").textContent = result.receipts.length + " shown · " + result.matching + " matching · " + result.total + " saved";
      $("receiptHistoryList").replaceChildren();
      for (const r of result.receipts) {
        const card = node("div", undefined, "receipt-history-row"), info = node("div");
        info.append(node("strong", r.number), node("p", r.name + " · " + r.checkin + " → " + r.checkout), node("span", model.money(r.netReceived) + " net received", "muted"));
        card.append(info, button("Open / reprint", () => open(r.number))); $("receiptHistoryList").append(card);
      }
      $("receiptHistoryMessage").textContent = result.receipts.length ? (result.matching > 100 ? "Showing the latest 100 matches. Refine your search to find an older receipt." : "") : "No saved receipts match this search.";
    } catch (error) { if (e === epoch) $("receiptHistoryMessage").textContent = error.message; }
  }
  async function open(number) {
    if (working || !canStart()) return;
    const e = epoch; message("Opening saved receipt…");
    try { const result = await rpc("rrGet", { number }); if (e !== epoch) return; show(result.receipt); message("Saved receipt " + result.receipt.number + ". Print a copy or start a new receipt."); $("receiptPrintButton").focus(); }
    catch (error) { if (e === epoch) message(error.message); }
  }
  $("receiptPreviewButton").onclick = () => { try { if (!$("receiptForm").reportValidity()) return; show(model.prepare(raw())); message("Draft preview only. Save to assign a receipt number."); } catch (error) { message(error.message); } };
  $("receiptForm").addEventListener("input", () => { if (retry || receipt) return; $("receiptPreviewStatus").textContent = "Draft changed · preview again"; $("receiptPrint").hidden = true; });
  $("receiptForm").onsubmit = async event => {
    event.preventDefault(); if (working || !canStart()) return;
    try {
      if (!retry) { if (!$("receiptForm").reportValidity()) return; if (!$("receiptConfirmed").checked) throw Error("Confirm the details and payments before issuing the receipt."); const details = raw(), prepared = model.prepare(details); if (prepared.totals.grossReceived <= 0) throw Error("Enter a payment received before issuing a receipt."); retry = { requestId: crypto.randomUUID(), details, confirmed: true }; show(prepared); }
      const e = epoch; working = true; setWorking(true); lockForm(true); message("Saving the receipt and assigning its number…");
      try { const result = await rpc("rrIssue", retry); if (e !== epoch) return; show(result.receipt); retry = null; message("Saved " + result.receipt.number + ". You can print, save as PDF or reopen it from Saved receipts."); await history(); }
      catch (error) { if (e === epoch) { message(error.message + " If the response was lost, use Retry same receipt to recover its saved number. You may also search Saved receipts. Do not start a second receipt for the same payment."); $("receiptSave").disabled = false; $("receiptSave").textContent = "Retry same receipt"; } }
      finally { if (e === epoch) { working = false; setWorking(false); } }
    } catch (error) { message(error.message); }
  };
  $("receiptNew").onclick = () => { if (!working) newDraft(); };
  $("receiptSearchForm").onsubmit = e => { e.preventDefault(); if (!working) history(); };
  $("receiptPrintButton").onclick = async () => {
    if (!receipt || working) return;
    const current = receipt, e = epoch, printButton = $("receiptPrintButton");
    $("receiptPrint").replaceChildren(paper(current)); $("receiptPrint").hidden = false; printButton.disabled = true;
    try {
      const logo = $("receiptPrint").querySelector(".receipt-logo");
      if (typeof logo.decode === "function") await logo.decode();
      if (e === epoch && receipt === current) window.print();
    } catch (_) {
      if (e === epoch) message("The receipt logo could not load. Check your connection and choose Print / Save PDF again.");
    } finally { if (e === epoch) printButton.disabled = false; }
  };
  function select(which) { if (working) return; const receipts = which === "receipts"; root.hidden = !receipts; $("bookingsWorkspace").hidden = receipts; $("showReceipts").setAttribute("aria-pressed", String(receipts)); $("showBookings").setAttribute("aria-pressed", String(!receipts)); if (receipts) history(); }
  $("showReceipts").onclick = () => { if (canStart()) select("receipts"); }; $("showBookings").onclick = () => select("bookings");
  newDraft();
  return { signedIn() {}, reset() { epoch++; working = false; retry = null; newDraft(); select("bookings"); $("receiptHistoryList").replaceChildren(); $("receiptHistoryMessage").textContent = ""; $("receiptHistoryCount").textContent = ""; $("receiptSearch").value = ""; } };
};
