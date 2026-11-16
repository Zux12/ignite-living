"use strict";
(() => {
  const root = document.getElementById("guestReviews"); if (!root) return;
  const { node, card, form } = IgniteReviews, list = document.getElementById("guestReviewList"), summary = document.getElementById("guestReviewSummary"), message = document.getElementById("guestReviewListMessage"), more = document.getElementById("guestReviewMore"), filter = document.getElementById("guestReviewFilter");
  let nextOffset = null, generation = 0, loading = false, working = false, retry = null;
  async function api(action, input) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(BOOKING_API, { method: "POST", credentials: "omit", redirect: "follow", cache: "no-store", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "reviews." + action, ...input }), signal: controller.signal });
      if (!response.ok) throw Error("Connection unavailable.");
      const result = await response.json();
      if (!result || typeof result.ok !== "boolean") throw Error("Unexpected review response.");
      if (!result.ok) { const error = Error(result.message || "Unable to complete this request."); error.rejected = true; throw error; }
      return result;
    } finally { clearTimeout(timeout); }
  }
  async function load(append = false) {
    if (append && (loading || nextOffset === null)) return;
    const current = ++generation; loading = true; more.disabled = true; message.textContent = "Loading guest reviews…";
    if (!append) { list.replaceChildren(); summary.textContent = "Loading ratings…"; more.hidden = true; }
    try {
      const result = await api("list", { propertyId: filter.value, offset: append ? nextOffset : 0 }); if (current !== generation) return;
      if (!Array.isArray(result.reviews) || !Number.isInteger(result.total) || (result.total > 0 && !Number.isFinite(result.average))) throw Error("Review list unavailable.");
      for (const review of result.reviews) list.append(card(review));
      summary.replaceChildren();
      if (result.total) summary.append(node("strong", result.average.toFixed(1), "review-average"), node("span", " / 5 · " + result.total + " " + (result.total === 1 ? "review" : "reviews")));
      else summary.textContent = "No published reviews yet";
      nextOffset = result.nextOffset; more.hidden = nextOffset === null;
      message.textContent = result.total ? "Ratings are based on published reviews submitted here or shared by the host." : "Stayed with us? Be the first to share your experience.";
    } catch (_) { if (current === generation) { message.textContent = "Reviews could not be loaded. Please try again."; if (!append) summary.textContent = "Ratings temporarily unavailable"; } }
    finally { if (current === generation) { loading = false; more.disabled = false; } }
  }
  filter.onchange = () => load(); more.onclick = () => load(true); document.getElementById("guestReviewRefresh").onclick = () => load();
  const editor = form(document.getElementById("guestReviewFormHost"), "guestReview", false);
  editor.form.onsubmit = async event => {
    event.preventDefault(); if (working) return;
    if (!retry) { if (!editor.form.reportValidity()) return; retry = { ...editor.raw(), requestId: crypto.randomUUID() }; }
    working = true; editor.lock(true); editor.status.textContent = "Sending your review…";
    try {
      const result = await api("submit", retry); if (!result.reviewId) throw Error("Missing review acknowledgement.");
      retry = null; editor.reset(); editor.status.textContent = "Thank you! Your review has been received and will appear after moderation.";
    } catch (error) {
      if (error.rejected) { retry = null; editor.lock(false); editor.status.textContent = error.message; }
      else { editor.submit.disabled = false; editor.submit.textContent = "Retry same review"; editor.status.textContent = "We could not confirm receipt. Retry this same review to avoid sending a duplicate. Keep this page open."; }
    } finally { working = false; }
  };
  load();
})();
