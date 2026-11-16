"use strict";
// Shared by the browser and Apps Script. All calculations use integer sen.
var IgniteReceipt = (() => {
  const amounts = ["rental", "extras", "discount", "depositPaid", "otherPaid", "paymentRefund", "securityPaid", "securityRefund"];
  function text(value, label, limit, required = false) {
    if (value != null && typeof value !== "string") throw Error(label + " is invalid.");
    const result = String(value || "").trim().replace(/\s+/g, " ");
    if ((required && !result) || result.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result))
      throw Error(label + " is missing or too long (maximum " + limit + " characters).");
    return result;
  }
  function date(value, label) {
    const s = text(value, label, 10, true), d = new Date(s + "T00:00:00Z");
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s)
      throw Error("Enter a valid " + label.toLowerCase() + ".");
    return s;
  }
  function cents(value) {
    const s = String(value == null || value === "" ? "0" : value).trim();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(s) || Number(s) > 1000000)
      throw Error("Amounts must be RM0–RM1,000,000, with at most two decimal places.");
    const [whole, fraction = ""] = s.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }
  function prepare(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Enter receipt details.");
    const d = {
      name: text(raw.name, "Customer name", 100, true),
      phone: text(raw.phone, "Handphone", 30, true),
      property: text(raw.property, "Property / stay description", 100, true),
      checkin: date(raw.checkin, "Check-in date"), checkout: date(raw.checkout, "Check-out date"),
      paymentDate: date(raw.paymentDate, "Payment date"),
      method: text(raw.method, "Payment method", 40, true),
      reference: text(raw.reference, "Payment reference", 80),
      notes: text(raw.notes, "Notes", 220),
      promotionTitle: raw.includePromotion === true ? text(raw.promotionTitle, "Promotion heading", 65) : "",
      promotionText: raw.includePromotion === true ? text(raw.promotionText, "Promotion message", 200) : "",
      amounts: {},
    };
    if (!/^[+()\d .-]{6,30}$/.test(d.phone) || d.phone.replace(/\D/g, "").length < 6) throw Error("Enter a valid handphone number.");
    if (d.checkout <= d.checkin) throw Error("Check-out must be after check-in.");
    for (const key of amounts) d.amounts[key] = cents(raw.amounts?.[key]);
    const a = d.amounts;
    if (a.discount > a.rental + a.extras) throw Error("Discount cannot exceed the stay charges.");
    if (a.paymentRefund > a.depositPaid + a.otherPaid) throw Error("Payment refund cannot exceed stay payments received.");
    if (a.securityRefund > a.securityPaid) throw Error("Security-deposit refund cannot exceed the security deposit received.");
    const charges = a.rental + a.extras - a.discount, stayPaid = a.depositPaid + a.otherPaid - a.paymentRefund;
    return { version: 1, details: d, totals: {
      charges, stayPaid, balanceDue: Math.max(0, charges - stayPaid), creditDue: Math.max(0, stayPaid - charges),
      securityHeld: a.securityPaid - a.securityRefund,
      grossReceived: a.depositPaid + a.otherPaid + a.securityPaid,
      totalRefund: a.paymentRefund + a.securityRefund,
      netReceived: stayPaid + a.securityPaid - a.securityRefund,
    }};
  }
  function money(sen) { return "RM " + (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  return Object.freeze({ amounts, prepare, money });
})();
if (typeof window !== "undefined") window.IgniteReceipt = IgniteReceipt;
