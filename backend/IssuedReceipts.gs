// Immutable, owner-only receipt register. No booking/payment records are altered.
const RR_SHEET = 'IssuedReceipts';
const RR_HEADERS = ['receiptNumber', 'requestId', 'savedAt', 'savedBy', 'receiptJson'];
function rrTable_(ss, create) {
  let sheet = ss.getSheetByName(RR_SHEET);
  if (!sheet && create) sheet = ss.insertSheet(RR_SHEET);
  if (!sheet) return null;
  if (!sheet.getLastRow() && create) {
    sheet.getRange(1, 1, 1, RR_HEADERS.length).setValues([RR_HEADERS]);
    sheet.setFrozenRows(1);
  }
  const rows = sheet.getDataRange().getValues();
  if (JSON.stringify(rows[0]) !== JSON.stringify(RR_HEADERS)) throw Error('Receipt register headings changed. Restore them before issuing receipts.');
  return { sheet, rows: rows.slice(1).filter(r => r.some(v => v !== '')) };
}
function rrRecord_(row) {
  let r;
  try { r = JSON.parse(String(row[4])); } catch (_) { throw Error('A stored receipt is unreadable. Contact the owner before issuing more receipts.'); }
  if (!r || r.version !== 1 || r.number !== String(row[0]) || r.requestId !== String(row[1]) || !r.details || !r.totals)
    throw Error('A stored receipt is inconsistent. Check the receipt register.');
  return r;
}
function rrList_(input) {
  const { ss } = prOwner_(), table = rrTable_(ss, false);
  const query = String(input?.query || '').trim().toLowerCase().slice(0, 100);
  if (!table) return { receipts: [], total: 0, matching: 0 };
  const records = table.rows.map(rrRecord_).reverse();
  const matches = records.filter(r => !query || [r.number, r.details.name, r.details.phone, r.details.property].some(v => String(v).toLowerCase().includes(query)));
  return { total: records.length, matching: matches.length, receipts: matches.slice(0, 100).map(r => ({
    number: r.number, name: r.details.name, checkin: r.details.checkin, checkout: r.details.checkout,
    savedAt: r.savedAt, netReceived: r.totals.netReceived,
  })) };
}
function rrGet_(input) {
  const { ss } = prOwner_(), table = rrTable_(ss, false);
  const number = String(input?.number || '');
  if (!/^ILR-20\d{2}-\d{6}$/.test(number)) throw Error('Choose a saved receipt.');
  const rows = table ? table.rows.filter(r => String(r[0]) === number) : [];
  if (rows.length !== 1) throw Error('The saved receipt could not be found uniquely.');
  return { receipt: rrRecord_(rows[0]) };
}
function rrIssue_(input) {
  const { ss, email } = prOwner_();
  if (!input || input.confirmed !== true) throw Error('Confirm that the receipt details and payments are correct.');
  const requestId = String(input.requestId || '');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) throw Error('Start a new receipt from the admin page.');
  const prepared = IgniteReceipt.prepare(input.details);
  if (prepared.totals.grossReceived <= 0) throw Error('A receipt must record a payment received. Enter the booking deposit, other payment or security deposit.');
  return msLocked_(() => {
    const table = rrTable_(ss, true), matches = table.rows.filter(r => String(r[1]) === requestId);
    if (matches.length > 1) throw Error('Duplicate receipt request found. Check the register.');
    if (matches.length) {
      const existing = rrRecord_(matches[0]);
      if (JSON.stringify(existing.details) !== JSON.stringify(prepared.details)) throw Error('This request was already saved with different details. Open its saved receipt or start a new one.');
      return { receipt: existing, duplicate: true };
    }
    const year = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy');
    const prefix = 'ILR-' + year + '-';
    const props = PropertiesService.getScriptProperties(), counterKey = 'RECEIPT_LAST_' + year;
    const counter = props.getProperty(counterKey) || '0';
    if (!/^\d{1,6}$/.test(counter)) throw Error('Receipt counter is invalid. Check the saved numbering configuration.');
    let highest = Number(counter);
    const seen = new Set();
    for (const row of table.rows) {
      const r = rrRecord_(row);
      if (!/^ILR-20\d{2}-\d{6}$/.test(r.number) || seen.has(r.number)) throw Error('Duplicate or invalid receipt number in register.');
      seen.add(r.number);
      if (r.number.startsWith(prefix)) highest = Math.max(highest, Number(r.number.slice(-6)));
    }
    if (highest >= 999999) throw Error('Receipt number limit reached for this year.');
    // Reserve before writing: a failed write may leave a gap, but numbers are never reused.
    props.setProperty(counterKey, String(highest + 1));
    const receipt = { ...prepared, number: prefix + String(highest + 1).padStart(6, '0'), requestId,
      savedAt: new Date().toISOString(), savedBy: email,
      issuer: { brand: 'IGNITE LIVING', company: 'IgniteInno Ventures Sdn Bhd', phone: '019-345 5154', email: 'info@igniteinnov.com' },
    };
    const range = table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, RR_HEADERS.length);
    range.setNumberFormat('@').setValues([[receipt.number, requestId, receipt.savedAt, email, JSON.stringify(receipt)]]);
    SpreadsheetApp.flush();
    if (String(range.getValues()[0][4]) !== JSON.stringify(receipt)) throw Error('Receipt save could not be confirmed. Retry this same request or check saved receipts.');
    return { receipt, duplicate: false };
  });
}
