// Owner-only manual reservations. Uses the same Bookings table and script lock as online stays.
function mbText_(value, label, max, required) {
  const s = String(value == null ? '' : value).trim();
  if ((required && !s) || s.length > max || /[\u0000-\u001f]/.test(s)) throw Error('Check ' + label + '.');
  return s;
}
function mbInput_(input) {
  if (!input) throw Error('Enter the booking details.');
  const value = {
    propertyId: mbText_(input.propertyId, 'property', 30, true),
    checkin: dateText_(input.checkin), checkout: dateText_(input.checkout), occupants: Number(input.occupants),
    customerName: mbText_(input.customerName, 'guest name', 100, true),
    customerPhone: mbText_(input.customerPhone, 'handphone', 30, true),
    customerEmail: mbText_(input.customerEmail, 'email', 150, false),
    notes: mbText_(input.notes, 'notes (up to 500 characters)', 500, false)
  };
  if (!/^\+?[\d ()-]{7,30}$/.test(value.customerPhone) || value.customerPhone.replace(/\D/g, '').length < 7) throw Error('Enter a valid handphone number.');
  if (value.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.customerEmail)) throw Error('Enter a valid email or leave it blank.');
  if (!Number.isInteger(value.occupants) || value.occupants < 1) throw Error('Enter the number of guests.');
  return value;
}
function mbTable_(ss) {
  const sheet = ss.getSheetByName('Bookings');
  if (!sheet) throw Error('Bookings table is missing.');
  const values = sheet.getDataRange().getValues(), headers = values.shift().map(v => String(v).trim());
  for (const key of ['bookingId','createdAt','propertyId','checkin','checkout','nights','occupants','customerName','customerPhone','customerEmail','bookingStatus','paymentStatus','rentalAmount','cleaningFee','bookingDeposit','totalAmount','amountPaid','agreementVersion','agreementAccepted','acceptedAt','updatedAt','notes','balanceDue','customerId','requestId','requestHash','requestResult']) {
    if (headers.filter(h => h === key).length !== 1) throw Error('Missing or duplicated Bookings heading: ' + key);
  }
  const rows = values.map((cells, i) => ({ row: i + 2, cells, value: Object.fromEntries(headers.map((h, j) => [h, cells[j]])) }));
  return { sheet, headers, rows };
}
function mbResult_(b) {
  return { bookingId: String(b.bookingId), status: String(b.bookingStatus), checkin: dateText_(b.checkin), checkout: dateText_(b.checkout), totalAmount: Number(b.totalAmount), message: String(b.bookingStatus) === 'CANCELLED' ? 'This manual booking was already cancelled. Dates are released.' : 'Manual booking saved and confirmed. Dates are reserved. No payment has been recorded.' };
}
function mbList_(input) {
  prOwner_();
  const month = String(input?.month || ppToday_().slice(0, 7));
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Choose a valid calendar month.');
  const first = month + '-01', next = new Date(first + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.toISOString().slice(0, 10), properties = ppProperties_().map(p => ({ propertyId: String(p.propertyId).trim(), propertyName: String(p.propertyName), maxOccupants: Number(p.maxOccupants) }));
  const propertyId = String(input?.propertyId || properties[0]?.propertyId || '');
  if (properties.length && !properties.some(p => p.propertyId === propertyId)) throw Error('Choose an available property.');
  const inMonth = (a, b) => dateText_(a) < end && dateText_(b) > first;
  const bookings = readRows_('Bookings').filter(b => String(b.propertyId).trim() === propertyId && ['CONFIRMED','CHECKED_IN','PENDING_REVIEW'].includes(String(b.bookingStatus)) && inMonth(b.checkin,b.checkout)).map(b => ({ bookingId: String(b.bookingId), customerName: String(b.customerName), checkin: dateText_(b.checkin), checkout: dateText_(b.checkout), occupants: Number(b.occupants), status: String(b.bookingStatus), manual: String(b.bookingId).startsWith('IL-MANUAL-'), totalAmount: Number(b.totalAmount), amountPaid: Number(b.amountPaid) }));
  const blocked = readRows_('BlockedDates').filter(b => String(b.propertyId).trim() === propertyId && String(b.active).toUpperCase() === 'TRUE' && inMonth(b.startDate,b.endDate)).map(b => ({ checkin: dateText_(b.startDate), checkout: dateText_(b.endDate) }));
  return { properties, propertyId, month, today: ppToday_(), bookings, blocked };
}
function mbQuote_(input) {
  prOwner_();
  const value = mbInput_(input), quote = checkAvailability_(value);
  if (!quote.available) throw Error('These dates are unavailable. Choose another stay.');
  return { quote };
}
function mbCreate_(input) {
  const owner = prOwner_(), value = mbInput_(input);
  if (input.confirmed !== true) throw Error('Confirm the booking details before saving.');
  const requestId = String(input.requestId || '').toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId) || !/^[a-f0-9]{64}$/.test(String(input.priceKey || ''))) throw Error('Review the booking price before saving.');
  const bookingId = 'IL-MANUAL-' + requestId, requestHash = msHash_(JSON.stringify([value, input.priceKey]));
  return msLocked_(() => {
    prOwner_();
    const t = mbTable_(owner.ss), matches = t.rows.filter(r => String(r.value.bookingId) === bookingId);
    if (matches.length > 1) throw Error('Duplicate booking reference. Owner review required.');
    if (matches.length) {
      if (String(matches[0].value.requestHash) !== requestHash) throw Error('This request was already saved with different details. Reload the calendar.');
      return { ...mbResult_(matches[0].value), duplicate: true };
    }
    const q = checkAvailability_(value); ppAssertQuote_(input, q);
    if (!q.available) throw Error('These dates were just reserved or blocked. No booking was saved.');
    const now = new Date().toISOString();
    const record = { ...value, bookingId, requestId, requestHash, customerId: '', createdAt: now, updatedAt: now,
      nights: q.nights, bookingStatus: 'CONFIRMED', paymentStatus: 'UNPAID', rentalAmount: q.rentalAmount, cleaningFee: q.cleaningFee,
      bookingDeposit: q.bookingDeposit, totalAmount: q.totalAmount, amountPaid: 0, balanceDue: q.totalAmount,
      agreementVersion: '', agreementAccepted: false, acceptedAt: '',
      notes: 'Manual reservation by ' + owner.email + '. Guest online terms not recorded. No payment recorded.' + (value.notes ? '\nOwner notes: ' + value.notes : '') };
    const result = mbResult_(record); record.requestResult = JSON.stringify(result);
    const cells = t.headers.map(h => { const v = record[h] === undefined ? '' : record[h]; return typeof v === 'string' && /^[=+\-@\s]/.test(v) ? "'" + v : v; });
    t.sheet.getRange(t.sheet.getLastRow()+1,1,1,cells.length).setValues([cells]);
    SpreadsheetApp.flush(); return result;
  });
}
function mbCancel_(input) {
  const owner = prOwner_(), id = String(input?.bookingId || ''), reason = mbText_(input?.reason, 'cancellation reason', 300, true);
  if (input.confirmed !== true || !/^IL-MANUAL-[a-f0-9-]{36}$/.test(id)) throw Error('Confirm the manual booking to cancel.');
  return msLocked_(() => {
    prOwner_(); const t = mbTable_(owner.ss), matches = t.rows.filter(r => String(r.value.bookingId) === id);
    if (matches.length !== 1) throw Error('Manual booking not found.');
    const row = matches[0], b = row.value;
    if (b.bookingStatus === 'CANCELLED') return mbResult_(b);
    if (b.bookingStatus !== 'CONFIRMED' || dateText_(b.checkin) < ppToday_()) throw Error('Only upcoming confirmed manual bookings can be cancelled here.');
    if (b.amountPaid === '' || !Number.isFinite(Number(b.amountPaid)) || Number(b.amountPaid) !== 0 || Number(b.amountRefunded || 0) !== 0 || Number(b.refundDue || 0) !== 0 ||
      readRows_('PaymentProofs').some(p => String(p.bookingId) === id) || readRows_('StayRequests').some(r => String(r.bookingId) === id)) throw Error('This booking has payment or stay-request records. Use the payment/refund review process.');
    const updates = { bookingStatus:'CANCELLED', totalAmount:0, balanceDue:0, paymentStatus:'UNPAID', updatedAt:new Date().toISOString(), notes:String(b.notes || '') + '\nManual cancellation by ' + owner.email + ': ' + reason };
    // A single row write preserves all other stored fields, including retry identity.
    const cells = t.headers.map((h,i) => { const v = Object.prototype.hasOwnProperty.call(updates,h) ? updates[h] : row.cells[i]; return typeof v === 'string' && /^[=+\-@\s]/.test(v) ? "'" + v : v; });
    t.sheet.getRange(row.row,1,1,cells.length).setValues([cells]); SpreadsheetApp.flush();
    return mbResult_({ ...b, ...updates });
  });
}
