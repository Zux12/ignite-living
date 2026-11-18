// Dated stay promotions. Standard property rates and saved bookings stay unchanged.
const PP_RATE_KEYS = ['nightlyRate', 'twoNightTotal', 'threeNightTotal', 'additionalNightRate'];
function ppToday_() { return Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd'); }
function ppDay_(value) {
  const s = String(value || ''), d = new Date(s + 'T00:00:00Z');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw Error('Choose valid promotion dates.');
  return s;
}
function ppSen_(value) {
  const s = String(value == null ? '' : value);
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s) || Number(s) > 1000000) throw Error('Enter prices from RM0.01 to RM1,000,000, with at most two decimals.');
  const parts = s.split('.'); return Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
}
function ppProperties_() {
  return readRows_('Properties').filter(p => String(p.status).trim().toUpperCase() === 'AVAILABLE');
}
function ppBase_(property) {
  const result = {};
  for (const key of PP_RATE_KEYS) { result[key] = ppSen_(property[key]) / 100; if (result[key] <= 0) throw Error('The standard property rates need owner review.'); }
  return result;
}
function ppKey_(id) { if (!/^[A-Z0-9_-]{1,30}$/.test(id)) throw Error('Choose an available property.'); return 'LIVING_PROMOTION_V1_' + id; }
function ppRead_(id) {
  const value = PropertiesService.getScriptProperties().getProperty(ppKey_(id));
  if (!value) return { revision: 0, offer: null };
  const record = JSON.parse(value);
  if (!record || !Number.isInteger(record.revision) || record.revision < 1 || !record.offer || typeof record.offer.enabled !== 'boolean') throw Error('The saved promotion needs owner review.');
  return record;
}
function ppPrepare_(input, property) {
  if (typeof input?.enabled !== 'boolean') throw Error('Choose whether this promotion is enabled.');
  if (!input.enabled) return { enabled: false };
  const title = String(input.title || 'Stay offer').trim();
  if (!title || title.length > 60 || /[\u0000-\u001f]/.test(title)) throw Error('Use a promotion title of up to 60 characters.');
  const startDate = ppDay_(input.startDate), endDate = ppDay_(input.endDate);
  if (endDate < startDate || endDate < ppToday_()) throw Error('The last promotional night must be today or later, and not before the first night.');
  const normal = ppBase_(property), rates = {};
  for (const key of PP_RATE_KEYS) {
    rates[key] = ppSen_(input.rates?.[key]) / 100;
    if (rates[key] <= 0 || rates[key] > normal[key]) throw Error('Each promotional price must be above zero and no higher than its standard price.');
  }
  if (!PP_RATE_KEYS.some(key => rates[key] < normal[key])) throw Error('Reduce at least one price to enable a promotion.');
  if (rates.twoNightTotal < rates.nightlyRate || rates.threeNightTotal < rates.twoNightTotal) throw Error('The two-night total cannot be below one night, and the three-night total cannot be below two nights.');
  for (const key of PP_RATE_KEYS.slice(0, 3)) if (rates[key] + Number(property.cleaningFee) < Number(property.bookingDeposit)) throw Error('The stay total cannot be less than the booking deposit of RM' + property.bookingDeposit + '.');
  return { enabled: true, title, startDate, endDate, rates };
}
function ppVisible_(record, property, today) {
  const o = record.offer;
  if (!o?.enabled || o.endDate < today) return null;
  // Revalidate against current normal rates; never advertise a stale higher "discount".
  try { ppPrepare_(o, property); } catch (_) { return null; }
  return { title: o.title, startDate: o.startDate, endDate: o.endDate, rates: o.rates, revision: record.revision };
}
function ppProjection_(property, owner) {
  const propertyId = String(property.propertyId).trim(), record = ppRead_(propertyId), today = ppToday_();
  const result = { propertyId, propertyName: String(property.propertyName), standard: ppBase_(property), promotion: ppVisible_(record, property, today) };
  if (owner) Object.assign(result, { revision: record.revision, savedOffer: record.offer, updatedAt: record.updatedAt || '' });
  return result;
}
function ppPublic_() { return { properties: ppProperties_().map(p => ppProjection_(p, false)), serverTime: new Date().toISOString(), today: ppToday_() }; }
function ppList_() { prOwner_(); return { ...ppPublic_(), properties: ppProperties_().map(p => ppProjection_(p, true)) }; }
function ppSave_(input) {
  const owner = prOwner_();
  if (!input || input.confirmed !== true) throw Error('Confirm the promotional prices and dates before saving.');
  const id = String(input.propertyId || ''), requestId = String(input.requestId || '');
  ppKey_(id);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId) || !Number.isInteger(input.expectedRevision)) throw Error('Reload promotions before saving.');
  return msLocked_(() => {
    const matches = ppProperties_().filter(p => String(p.propertyId).trim() === id);
    if (matches.length !== 1) throw Error('Choose an available property.');
    const property = matches[0], previous = ppRead_(id);
    const requestHash = msHash_(JSON.stringify({ propertyId: id, enabled: input.enabled, title: input.title, startDate: input.startDate, endDate: input.endDate, rates: input.rates, expectedRevision: input.expectedRevision }));
    if (previous.requestId === requestId) {
      if (previous.requestHash !== requestHash) throw Error('This saved request used different promotion details. Reload promotions.');
      return { property: ppProjection_(property, true), duplicate: true };
    }
    if (previous.revision !== input.expectedRevision) throw Error('This promotion changed in another session. Reload promotions before editing.');
    const offer = ppPrepare_(input, property), record = { revision: previous.revision + 1, offer, requestId, requestHash, updatedAt: new Date().toISOString(), updatedBy: owner.email };
    const props = PropertiesService.getScriptProperties(), key = ppKey_(id), serialized = JSON.stringify(record);
    props.setProperty(key, serialized);
    if (props.getProperty(key) !== serialized) throw Error('The promotion save could not be confirmed. Retry the same change.');
    return { property: ppProjection_(property, true) };
  });
}
function ppQuote_(property, nights, checkin, checkout) {
  const normal = calculatePrice_(property, nights), id = String(property.propertyId).trim();
  const offer = ppVisible_(ppRead_(id), property, ppToday_());
  let result = { ...normal, originalTotalAmount: normal.totalAmount, promotion: null };
  if (offer && checkin >= offer.startDate && checkout > checkin) {
    const lastNight = new Date(new Date(checkout + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    if (lastNight <= offer.endDate) {
      const n = offer.rates, cents = nights === 1 ? ppSen_(n.nightlyRate) : nights === 2 ? ppSen_(n.twoNightTotal) : ppSen_(n.threeNightTotal) + (nights - 3) * ppSen_(n.additionalNightRate);
      const total = (cents + ppSen_(property.cleaningFee)) / 100;
      if (total < normal.totalAmount && total >= normal.bookingDeposit) result = { ...normal, rentalAmount: cents / 100, totalAmount: total, balanceAfterDeposit: (cents + ppSen_(property.cleaningFee) - ppSen_(normal.bookingDeposit)) / 100, originalTotalAmount: normal.totalAmount, promotion: { title: offer.title, startDate: offer.startDate, endDate: offer.endDate, revision: offer.revision } };
    }
  }
  result.priceKey = msHash_(JSON.stringify([id, checkin, checkout, result.totalAmount, result.cleaningFee, result.bookingDeposit, result.promotion]));
  return result;
}
function ppAssertQuote_(input, quote) {
  if ((input.priceKey || quote.promotion) && input.priceKey !== quote.priceKey) reject_('The price or promotion changed. Check your rental period again before booking.');
}
