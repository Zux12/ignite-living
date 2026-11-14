// Optional offline fault injection against the exact exported backend.
// No Google calls, credentials, customer records or real receipt bytes.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const sourceDir = process.env.PATCHED_BACKEND_SOURCE_DIR;
const check = sourceDir ? test : test.skip;
const headers = 'proofId,bookingId,submittedAt,claimedAmount,paymentDate,reference,fileId,fileUrl,reviewStatus,reviewNotes,uploadId,fileHash'.split(',');

function harness() {
  const state = { rows: [], files: [], locked: false, failure: '' };
  const booking = { bookingId: 'SYNTHETIC-BOOKING', customerId: 'synthetic-customer', bookingStatus: 'CONFIRMED', amountPaid: 0 };
  const sheet = {
    getLastRow: () => state.rows.length + 1,
    getRange: () => ({
      getDisplayValues: () => [headers],
      setValues(rows) { assert.equal(state.locked, true); if (state.failure === 'sheet') throw Error('Synthetic sheet unavailable'); state.rows.push(...rows); }
    })
  };
  const c = vm.createContext({ Date, Int32Array, Uint8Array, Utilities: {
    formatDate: () => '2026-11-15', getUuid: () => crypto.randomUUID(),
    base64Decode: s => [...Buffer.from(s, 'base64')], newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (algorithm, bytes) => [...crypto.createHash('sha256').update(typeof bytes === 'string' ? bytes : Buffer.from(bytes)).digest()]
  }, SpreadsheetApp: {
    openById: () => ({ getSheetByName: () => sheet }),
    flush() { if (state.failure === 'flush') { state.failure = ''; throw Error('Synthetic response lost after sheet write'); } }
  }, LockService: { getScriptLock: () => ({
    tryLock() { if (state.locked) return false; state.locked = true; return true; }, releaseLock() { state.locked = false; }
  }) } });
  for (const name of ['Code.gs', 'ManageStay.gs']) vm.runInContext(fs.readFileSync(path.join(sourceDir, name), 'utf8'), c, { filename: name });
  c.msSession_ = () => ({ customerId: booking.customerId });
  c.msRate_ = () => {};
  c.msRows_ = name => name === 'Bookings' ? [booking] : state.rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  c.msFolder_ = () => ({ createFile(blob) {
    assert.equal(state.locked, true);
    if (state.failure === 'drive') throw Error('Synthetic Drive unavailable');
    const id = 'synthetic-file-' + state.files.length;
    const file = { ...blob, getId: () => id, getUrl: () => 'https://example.invalid/' + id };
    state.files.push(file); return file;
  } });
  const input = { token: 'synthetic', bookingId: booking.bookingId, uploadId: crypto.randomUUID(), amount: 500, paymentDate: '2026-11-14', reference: 'TEST ONLY', base64: Buffer.from('%PDF-1.4\nSYNTHETIC TEST ONLY').toString('base64') };
  return { state, booking, send: extra => c.msUpload_({ ...input, ...extra }) };
}

check('lost receipt acknowledgement replays one proof and creates no second file', () => {
  const h = harness(); h.state.failure = 'flush';
  assert.throws(() => h.send(), /lost after sheet write/);
  assert.equal(h.state.locked, false);
  const recovered = h.send();
  assert.equal(recovered.proofId, h.state.rows[0][0]);
  assert.equal(h.state.rows.length, 1); assert.equal(h.state.files.length, 1);
  assert.equal(h.booking.amountPaid, 0);
});

check('same receipt after a page refresh is deduplicated despite a new upload ID', () => {
  const h = harness(), first = h.send(), second = h.send({ uploadId: crypto.randomUUID() });
  assert.equal(second.proofId, first.proofId);
  assert.equal(h.state.rows.length, 1); assert.equal(h.state.files.length, 1);
});

check('Drive failure leaves no proof row and releases the shared lock for retry', () => {
  const h = harness(); h.state.failure = 'drive';
  assert.throws(() => h.send(), /Drive unavailable/);
  assert.equal(h.state.locked, false); assert.equal(h.state.rows.length, 0); assert.equal(h.state.files.length, 0);
  h.state.failure = ''; assert.ok(h.send().proofId); assert.equal(h.state.rows.length, 1);
});

check('failed sheet write retains the private file for owner reconciliation without crediting payment', () => {
  const h = harness(); h.state.failure = 'sheet';
  assert.throws(() => h.send(), /sheet unavailable/);
  assert.equal(h.state.locked, false); assert.equal(h.state.rows.length, 0); assert.equal(h.state.files.length, 1);
  assert.equal(h.booking.amountPaid, 0);
  // Existing backend behaviour: a later retry can leave the first file orphaned.
  // Preserve this evidence; do not claim atomic Drive + Sheets storage.
  h.state.failure = ''; h.send();
  assert.equal(h.state.rows.length, 1); assert.equal(h.state.files.length, 2);
});
