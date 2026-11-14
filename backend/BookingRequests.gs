// Booking retry identities are stored in the same row as the booking.
// Call only while holding the existing project script lock.
function brIdentity_(input, customerId) {
  const requestId = String(input.requestId || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    reject_('Please refresh this page before submitting your booking request.');
  }
  const requestHash = msHash_(JSON.stringify([
    String(customerId), String(input.propertyId || ''), String(input.checkin || ''),
    String(input.checkout || ''), Number(input.occupants), String(input.agreementVersion || ''),
    input.agreementAccepted === true
  ]));
  return { requestId, requestHash };
}

function brReplay_(sheet, headers, customerId, identity) {
  for (const key of ['customerId', 'requestId', 'requestHash', 'requestResult']) {
    if (headers.filter(value => value === key).length !== 1) {
      throw new Error('Missing or duplicated Bookings heading: ' + key);
    }
  }
  if (sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const at = key => headers.indexOf(key);
  const matches = rows.filter(row => String(row[at('customerId')]) === String(customerId) &&
    String(row[at('requestId')]) === identity.requestId);
  if (matches.length > 1) throw new Error('Duplicate stored request identity. Owner review required.');
  if (!matches.length) return null;
  const row = matches[0];
  if (String(row[at('requestHash')]) !== identity.requestHash) {
    reject_('This request was already used for different booking details. Please check Manage my stay.');
  }
  const result = JSON.parse(String(row[at('requestResult')]));
  if (!result || typeof result.bookingId !== 'string' || result.status !== 'PENDING_REVIEW' ||
      ![result.totalAmount, result.bookingDeposit, result.balanceAfterDeposit].every(Number.isFinite)) {
    throw new Error('Stored booking response is invalid. Owner review required.');
  }
  // This is the original submission acknowledgement, not a new reservation.
  return result;
}
