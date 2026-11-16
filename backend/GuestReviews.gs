// Moderated guest reviews. Private storage; only explicitly published fields leave the API.
const GR_SHEET = 'GuestReviews';
const GR_HEADERS = ['reviewId', 'requestId', 'createdAt', 'updatedAt', 'reviewJson'];
const GR_PROPERTIES = { IL001: 'Mayang Sari Beach Cottage', IL002: 'Laman Seri Residence', IL003: 'Seri Teduh Residence' };
function grFail_(message) { const e = new Error(message); e.reviewMessage = message; throw e; }
function grText_(value, label, max, required) {
  if (value != null && typeof value !== 'string') grFail_(label + ' is invalid.');
  const text = String(value || '').trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) grFail_(label + ' is missing or too long.');
  return text;
}
function grToday_() { return Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd'); }
function grPrepare_(input, owner) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) grFail_('Enter a review.');
  const propertyId = grText_(input.propertyId, 'Property', 10, true);
  if (!Object.prototype.hasOwnProperty.call(GR_PROPERTIES, propertyId)) grFail_('Choose a property.');
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) grFail_('Choose an overall rating from 1 to 5 stars.');
  const anonymous = input.anonymous === true;
  const name = anonymous ? '' : grText_(input.name, 'Display name', 80, true);
  const comment = grText_(input.comment, 'Review', 1500, true);
  if (input.consent !== true) grFail_('Confirm that this review may be displayed on the website.');
  const reviewDate = owner ? grText_(input.reviewDate || grToday_(), 'Review date', 10, true) : grToday_();
  const d = new Date(reviewDate + 'T00:00:00Z');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(reviewDate) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== reviewDate || reviewDate > grToday_()) grFail_('Choose a valid review date that is not in the future.');
  return { propertyId, rating, anonymous, name, comment, reviewDate, consent: true };
}
function grTable_(ss, create) {
  let sheet = ss.getSheetByName(GR_SHEET);
  if (!sheet && create) sheet = ss.insertSheet(GR_SHEET);
  if (!sheet) return { sheet: null, records: [] };
  if (!sheet.getLastRow() && create) { sheet.getRange(1, 1, 1, GR_HEADERS.length).setValues([GR_HEADERS]); sheet.setFrozenRows(1); }
  const rows = sheet.getDataRange().getValues();
  if (JSON.stringify(rows[0]) !== JSON.stringify(GR_HEADERS)) throw Error('Review register headings changed.');
  const seen = new Set();
  const records = rows.slice(1).map((row, index) => {
    if (row.every(v => v === '')) return null;
    const review = JSON.parse(String(row[4]));
    if (!review || review.id !== row[0] || review.requestId !== row[1] || !['PENDING', 'PUBLISHED', 'HIDDEN'].includes(review.status) || !Number.isInteger(review.revision) || seen.has(review.id)) throw Error('Review register is inconsistent.');
    seen.add(review.id); return { row: index + 2, review };
  }).filter(Boolean);
  return { sheet, records };
}
function grWrite_(table, row, review) {
  const values = [review.id, review.requestId, review.createdAt, review.updatedAt, JSON.stringify(review)];
  const range = table.sheet.getRange(row, 1, 1, GR_HEADERS.length);
  range.setNumberFormat('@').setValues([values]); SpreadsheetApp.flush();
  if (String(range.getValues()[0][4]) !== values[4]) throw Error('Review save could not be confirmed.');
}
function grRate_() {
  // Durable shared budgets, under the script lock. Browser-supplied identity is not trusted.
  const props = PropertiesService.getScriptProperties(), now = Date.now();
  for (const [key, windowMs, limit] of [['GR_SUBMISSIONS_HOUR', 3600000, 40], ['GR_SUBMISSIONS_DAY', 86400000, 200]]) {
    let value = JSON.parse(props.getProperty(key) || 'null');
    if (!value || value.until <= now) value = { count: 0, until: now + windowMs };
    if (value.count >= limit) grFail_('Review submissions are busy. Please try again later.');
    value.count++; props.setProperty(key, JSON.stringify(value));
  }
}
function grCreate_(input, owner) {
  const principal = owner ? prOwner_() : null;
  const details = grPrepare_(input, owner), requestId = String(input.requestId || '');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) grFail_('Reload the review form before submitting.');
  if (String(input.website || '')) grFail_('Unable to accept this submission.');
  const source = owner ? 'HOST' : 'GUEST';
  return msLocked_(() => {
    const ss = principal ? principal.ss : SpreadsheetApp.openById(SPREADSHEET_ID);
    let table = grTable_(ss, false);
    const matches = table.records.filter(r => r.review.requestId === requestId);
    if (matches.length > 1) throw Error('Duplicate review request.');
    if (matches.length) {
      const existing = matches[0].review;
      // The guest's server date is deliberately excluded: a retry after midnight is the same request.
      const canonical = d => JSON.stringify(owner ? d : { ...d, reviewDate: '' });
      if (existing.source !== source || canonical(existing.details) !== canonical(details)) grFail_('This submission was already saved with different details.');
      return { reviewId: existing.id, duplicate: true, message: 'Thank you. Your review has been received for moderation.' };
    }
    if (!owner) grRate_();
    if (!table.sheet) table = grTable_(ss, true);
    const now = new Date().toISOString();
    const review = { id: 'ILREV-' + Utilities.getUuid(), requestId, createdAt: now, updatedAt: now, revision: 1,
      source, status: 'PENDING', details, enteredBy: principal ? principal.email : '',
      history: [{ status: 'PENDING', at: now, by: principal ? principal.email : 'guest' }] };
    grWrite_(table, table.sheet.getLastRow() + 1, review);
    return { reviewId: review.id, duplicate: false, message: 'Thank you. Your review has been received for moderation.' };
  });
}
function grPublic_(r) {
  return { id: r.id, propertyId: r.details.propertyId, propertyName: GR_PROPERTIES[r.details.propertyId],
    rating: r.details.rating, name: r.details.anonymous ? 'Anonymous guest' : r.details.name,
    comment: r.details.comment, reviewDate: r.details.reviewDate, source: r.source };
}
function grOffset_(input) { const n = Number(input && input.offset || 0); if (!Number.isInteger(n) || n < 0 || n > 100000) grFail_('Invalid review page.'); return n; }
function grPublicList_(input) {
  const propertyId = String(input.propertyId || ''), offset = grOffset_(input);
  if (propertyId && !Object.prototype.hasOwnProperty.call(GR_PROPERTIES, propertyId)) grFail_('Choose a property.');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const records = grTable_(ss, false).records.map(r => r.review).filter(r => r.status === 'PUBLISHED' && (!propertyId || r.details.propertyId === propertyId));
  records.sort((a, b) => b.details.reviewDate.localeCompare(a.details.reviewDate) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { reviews: records.slice(offset, offset + 10).map(grPublic_), total: records.length,
    average: records.length ? records.reduce((sum, r) => sum + r.details.rating, 0) / records.length : null,
    nextOffset: offset + 10 < records.length ? offset + 10 : null };
}
function grAdminList_(input) {
  const { ss } = prOwner_(), status = String(input && input.status || 'PENDING'), offset = grOffset_(input);
  if (!['ALL', 'PENDING', 'PUBLISHED', 'HIDDEN'].includes(status)) grFail_('Choose a review status.');
  const records = grTable_(ss, false).records.map(r => r.review).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const matches = records.filter(r => status === 'ALL' || r.status === status);
  return { reviews: matches.slice(offset, offset + 50).map(r => ({ ...grPublic_(r), revision: r.revision, status: r.status })),
    total: matches.length, pending: records.filter(r => r.status === 'PENDING').length, nextOffset: offset + 50 < matches.length ? offset + 50 : null };
}
function grAdminAdd_(input) { return grCreate_(input, true); }
function grAdminModerate_(input) {
  const { ss, email } = prOwner_();
  if (!input || input.confirmed !== true || !['PUBLISHED', 'HIDDEN'].includes(input.status) || !Number.isInteger(input.revision)) grFail_('Choose a review and confirm the decision.');
  return msLocked_(() => {
    const table = grTable_(ss, false), found = table.records.filter(r => r.review.id === input.id);
    if (found.length !== 1) grFail_('The review could not be found. Refresh the list.');
    const { row, review } = found[0];
    if (review.revision !== input.revision) grFail_('This review changed. Refresh the list before deciding again.');
    if (review.status === input.status) return { reviewId: review.id, status: review.status };
    review.status = input.status; review.revision++; review.updatedAt = new Date().toISOString();
    review.history.push({ status: review.status, at: review.updatedAt, by: email });
    grWrite_(table, row, review); return { reviewId: review.id, status: review.status };
  });
}
function guestReviewsDoPost_(input) {
  try {
    if (!input || JSON.stringify(input).length > 6000) grFail_('Review request is too large.');
    let result;
    if (input.action === 'reviews.list') result = grPublicList_(input);
    else if (input.action === 'reviews.submit') result = grCreate_(input, false);
    else grFail_('Unknown review action.');
    return msJson_({ ok: true, ...result });
  } catch (error) { return msJson_({ ok: false, message: error.reviewMessage || 'Reviews are temporarily unavailable. Please try again later.' }); }
}
