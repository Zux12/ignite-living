"use strict";
window.IgniteReviews = (() => {
  const properties = { IL001: "Mayang Sari Beach Cottage", IL002: "Laman Seri Residence", IL003: "Seri Teduh Residence" };
  function node(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
  function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  function stars(rating) { const n = node("span", "★".repeat(rating) + "☆".repeat(5 - rating), "review-stars"); n.setAttribute("aria-label", rating + " out of 5 stars"); return n; }
  function card(r) {
    const article = node("article", undefined, "guest-review-card"), head = node("div", undefined, "guest-review-card-head");
    head.append(node("strong", r.name), stars(r.rating)); article.append(head, node("p", r.comment, "guest-review-comment"));
    const date = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(r.reviewDate + "T00:00:00Z"));
    article.append(node("p", (properties[r.propertyId] || r.propertyName) + " · " + date + (r.source === "HOST" ? " · Shared by host" : ""), "guest-review-meta")); return article;
  }
  function form(container, prefix, owner) {
    const f = node("form", undefined, "guest-review-form");
    f.innerHTML = `<label for="${prefix}Property">Property</label><select id="${prefix}Property" name="propertyId" required>${Object.entries(properties).map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
      <fieldset class="review-rating"><legend>Overall star rating</legend><div class="review-rating-options">${[1,2,3,4,5].map(n => `<label><input type="radio" name="rating" value="${n}" aria-label="${n} ${n===1?'star':'stars'}" required><span aria-hidden="true">★</span><small aria-hidden="true">${n}</small></label>`).join("")}</div><p class="review-rating-value" aria-live="polite">Choose 1–5 stars</p></fieldset>
      <label class="review-checkbox"><input type="checkbox" name="anonymous">${owner ? "Display as anonymous" : "Post anonymously"}</label>
      <div class="review-name-field"><label for="${prefix}Name">Display name</label><input id="${prefix}Name" name="displayName" maxlength="80" autocomplete="nickname" required placeholder="Your name or nickname"></div>
      ${owner ? `<label for="${prefix}Date">Original review date</label><input id="${prefix}Date" type="date" name="reviewDate" max="${today()}" required>` : ""}
      <label for="${prefix}Comment">${owner ? "Guest’s review" : "Your review"}</label><textarea id="${prefix}Comment" name="comment" maxlength="1500" rows="5" required placeholder="Tell us about the stay"></textarea>
      <div class="review-trap" aria-hidden="true"><label for="${prefix}Website">Leave this blank</label><input id="${prefix}Website" name="website" tabindex="-1" autocomplete="off"></div>
      <label class="review-checkbox"><input type="checkbox" name="consent" required>${owner ? "This is genuine guest feedback, copied accurately, and I have permission to display it." : "This review is based on my stay, and it may be displayed publicly with my chosen name or anonymously."}</label>
      <button class="review-submit" type="submit">${owner ? "Save existing review" : "Submit review"}</button><p class="review-form-message" role="status" aria-live="polite"></p>`;
    container.append(f);
    const get = name => f.elements.namedItem(name), submit = f.querySelector('button[type="submit"]'), status = f.querySelector(".review-form-message");
    function anonymous() { f.querySelector(".review-name-field").hidden = get("anonymous").checked; get("displayName").required = !get("anonymous").checked; get("displayName").disabled = get("anonymous").checked; if (get("anonymous").checked) get("displayName").value = ""; }
    function rating() { const value = Number(get("rating").value); f.querySelector(".review-rating-value").textContent = value ? value + " out of 5 stars" : "Choose 1–5 stars"; for (const radio of f.querySelectorAll('[name="rating"]')) radio.parentElement.classList.toggle("selected", Number(radio.value) <= value); }
    get("anonymous").onchange = anonymous; for (const radio of f.querySelectorAll('[name="rating"]')) radio.onchange = rating;
    function reset() { f.reset(); if (owner) get("reviewDate").value = today(); lock(false); rating(); status.textContent = ""; submit.textContent = owner ? "Save existing review" : "Submit review"; }
    function lock(value) { for (const field of f.querySelectorAll("input,select,textarea,button")) field.disabled = value; if (!value) anonymous(); }
    function raw() { return { propertyId: get("propertyId").value, rating: Number(get("rating").value), anonymous: get("anonymous").checked, name: get("displayName").value, comment: get("comment").value, reviewDate: owner ? get("reviewDate").value : undefined, consent: get("consent").checked, website: get("website").value }; }
    reset(); return { form: f, get, submit, status, raw, lock, reset };
  }
  return { properties, node, today, stars, card, form };
})();
