"use strict";
window.createGuestReviewWorkspace = ({ rpc, canStart, setWorking }) => {
  const root = document.getElementById("guestReviewsWorkspace"), { node, card, form } = IgniteReviews;
  let epoch = 0, generation = 0, working = false, retry = null, nextOffset = null;
  root.innerHTML = `<div class="page-heading"><div><p class="eyebrow">WORDS FROM YOUR GUESTS</p><h2 id="guestReviewsTitle">Guest reviews</h2><p class="muted">Enter feedback you already have, or publish reviews submitted by guests.</p></div></div><div class="guest-review-admin-layout"><section class="guest-review-form-panel"><h3>Add an existing review</h3><p>Copy the guest’s original words and rating. Published entries are labelled “Shared by host”. Saving adds it to Pending so you can check it before publishing.</p><div id="ownerReviewFormHost"></div><button type="button" id="ownerReviewClear">Clear form</button></section><section aria-label="Review moderation"><div class="guest-review-tools"><label for="ownerReviewStatus">Show reviews<select id="ownerReviewStatus"><option value="PENDING">Pending</option><option value="PUBLISHED">Published</option><option value="HIDDEN">Hidden</option><option value="ALL">All reviews</option></select></label><button type="button" id="ownerReviewRefresh">Refresh</button></div><p class="guest-review-policy">Publish genuine feedback regardless of rating. Hide spam, personal details or unrelated content. Only published reviews contribute to the public average.</p><p id="ownerReviewListMessage" role="status" aria-live="polite"></p><div id="ownerReviewList"></div><button class="review-more" type="button" id="ownerReviewMore" hidden>Load more</button></section></div>`;
  const $ = id => document.getElementById(id), editor = form($("ownerReviewFormHost"), "ownerReview", true), list = $("ownerReviewList"), status = $("ownerReviewStatus"), message = $("ownerReviewListMessage");
  function busy(value) { working = value; setWorking(value); $("ownerReviewClear").disabled = value; for (const b of list.querySelectorAll("button")) b.disabled = value; }
  function renderReview(r) {
    const article = card(r), actions = node("div", undefined, "guest-review-moderation"); article.append(node("p", r.status === "PENDING" ? "Pending moderation" : r.status === "PUBLISHED" ? "Published on the website" : "Hidden from the website", "guest-review-state"));
    for (const [target, text] of [["PUBLISHED", "Publish"], ["HIDDEN", "Hide"]]) {
      if (target === r.status) continue;
      const button = node("button", text); button.type = "button";
      button.onclick = () => {
        if (working || !canStart()) return;
        const previous = article.querySelector(".review-confirmation"); if (previous) previous.remove();
        const confirmation = node("div", undefined, "review-confirmation"), accept = node("button", target === "PUBLISHED" ? "Confirm publish" : "Confirm hide"), cancel = node("button", "Cancel");
        accept.type = cancel.type = "button"; confirmation.append(node("p", target === "PUBLISHED" ? "Display this name, rating and review on the public website?" : "Hide this review and remove its rating from the public average?"), accept, cancel); article.append(confirmation);
        cancel.onclick = () => confirmation.remove();
        accept.onclick = async () => {
          if (working || !canStart()) return; const e = epoch; busy(true); message.textContent = "Saving the review decision…";
          try { await rpc("grModerate", { id: r.id, revision: r.revision, status: target, confirmed: true }); if (e !== epoch) return; await load(); }
          catch (error) { if (e === epoch) { message.textContent = error.message + " Refresh the list before trying again."; confirmation.remove(); } }
          finally { if (e === epoch) busy(false); }
        };
      };
      actions.append(button);
    }
    article.append(actions); return article;
  }
  async function load(append = false) {
    if (append && nextOffset === null) return;
    const e = epoch, g = ++generation; message.textContent = "Loading guest reviews…"; $("ownerReviewMore").disabled = true;
    try {
      const result = await rpc("grList", { status: status.value, offset: append ? nextOffset : 0 }); if (e !== epoch || g !== generation) return;
      if (!Array.isArray(result.reviews)) throw Error("Reviews could not be loaded.");
      if (!append) list.replaceChildren(); for (const r of result.reviews) list.append(renderReview(r));
      nextOffset = result.nextOffset; $("ownerReviewMore").hidden = nextOffset === null;
      message.textContent = result.total + " matching · " + result.pending + " pending" + (result.total ? "" : ". No reviews in this category yet.");
    } catch (error) { if (e === epoch && g === generation) message.textContent = error.message; }
    finally { if (e === epoch && g === generation) $("ownerReviewMore").disabled = false; }
  }
  editor.form.onsubmit = async event => {
    event.preventDefault(); if (working || !canStart()) return;
    if (!retry) { if (!editor.form.reportValidity()) return; retry = { ...editor.raw(), requestId: crypto.randomUUID() }; }
    const e = epoch; busy(true); editor.lock(true); editor.status.textContent = "Saving the guest’s review…";
    try {
      const result = await rpc("grAdd", retry); if (e !== epoch) return;
      if (!result.reviewId) throw Error("Missing saved-review acknowledgement.");
      retry = null; editor.reset(); editor.status.textContent = "Saved to Pending. Check the review, then choose Publish to display it."; status.value = "PENDING"; await load();
    } catch (error) { if (e === epoch) { editor.submit.disabled = false; editor.submit.textContent = "Retry same review"; editor.status.textContent = error.message + " Use Retry same review, or refresh the list before starting another."; } }
    finally { if (e === epoch) busy(false); }
  };
  $("ownerReviewClear").onclick = () => { if (working) return; retry = null; editor.reset(); };
  $("ownerReviewRefresh").onclick = () => { if (!working && canStart()) load(); }; status.onchange = () => { if (!working && canStart()) load(); }; $("ownerReviewMore").onclick = () => { if (!working && canStart()) load(true); };
  return { activate() { load(); }, reset() { epoch++; generation++; working = false; retry = null; nextOffset = null; editor.reset(); list.replaceChildren(); message.textContent = ""; status.value = "PENDING"; $("ownerReviewClear").disabled = false; $("ownerReviewMore").hidden = true; } };
};
