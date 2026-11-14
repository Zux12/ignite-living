// Test driver for a separate, owner-private Apps Script project only.
// STAGING_DATABASE_ID and STAGING_RECEIPT_FOLDER_ID are injected at build time.
// This file must never be added to the production project.
function runStagingSmokeTests() {
  const ss = stagingAssert_();
  const started = Date.now(), results = [];
  const expect = (condition, label) => { if (!condition) throw new Error('STAGING CHECK FAILED: ' + label); results.push(label); };
  const rejects = (fn, label) => { let rejected = false; try { fn(); } catch (_) { rejected = true; } expect(rejected, label); };
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('MS_SECRET')) props.setProperty('MS_SECRET', Utilities.getUuid() + Utilities.getUuid());
  props.setProperty('MS_FOLDER_ID', STAGING_RECEIPT_FOLDER_ID);
  msFolder_();
  expect(ss.getSheetByName('Bookings').getLastColumn() >= 34, 'Retry columns present');
  rejects(() => msSession_(''), 'No-session access denied');
  const run = Utilities.getUuid(), password = Utilities.getUuid() + '-TEST';
  const emailA = 'synthetic-a-' + run + '@example.invalid';
  const a = gaRegister_({customerName:'Synthetic Guest A',email:emailA,password});
  const b = gaRegister_({customerName:'Synthetic Guest B',email:'synthetic-b-' + run + '@example.invalid',password});
  expect(!!a.token && !!b.token, 'Synthetic registration succeeds');
  rejects(() => msLogin_({identifier:emailA,password:'incorrect-synthetic-password'}), 'Wrong password rejected');
  const login = msLogin_({identifier:emailA,password});
  expect(msSession_(login.token).customerId === a.profile.customerId, 'Correct login succeeds');
  const year = new Date().getUTCFullYear()+5;
  const start = year+'-01-10', end = year+'-01-12';
  const payload = {action:'requestBooking',token:a.token,propertyId:'IL001',checkin:start,checkout:end,occupants:2,agreementAccepted:true,agreementVersion:'2.0',requestId:Utilities.getUuid(),totalAmount:1};
  const send = input => JSON.parse(doPost({postData:{contents:JSON.stringify(input)}}).getContent());
  const first = send(payload), replay = send(payload);
  expect(first.ok && replay.ok && first.bookingId === replay.bookingId, 'Retry returns original booking reference');
  expect(first.totalAmount === 1800 && first.bookingDeposit === 500, 'Server price ignores client amount');
  expect(msRows_('Bookings').filter(r=>r.requestId===payload.requestId && r.customerId===a.profile.customerId).length === 1, 'One row for repeated request');
  expect(send({...payload,occupants:3}).ok === false, 'Changed retry payload rejected');
  rejects(()=>srOwned_(first.bookingId,msSession_(b.token)), 'Cross-customer booking access denied');
  expect(msList_(msSession_(b.token)).bookings.every(x=>x.bookingId!==first.bookingId), 'Other customer cannot list booking');
  const second=send({...payload,token:b.token,requestId:Utilities.getUuid()});
  expect(second.ok, 'Second pending request can be reviewed');
  const firstReview=odOpenBooking(first.bookingId);
  odSaveBooking({token:firstReview.token,action:'CONFIRM',confirmed:true,notes:'TEST ONLY'});
  const secondReview=odOpenBooking(second.bookingId);
  rejects(()=>odSaveBooking({token:secondReview.token,action:'CONFIRM',confirmed:true,notes:'TEST ONLY'}), 'Overlapping confirmation rejected');
  const today=Utilities.formatDate(new Date(),'Asia/Kuala_Lumpur','yyyy-MM-dd');
  const proofInput={token:a.token,bookingId:first.bookingId,uploadId:Utilities.getUuid(),amount:500,paymentDate:today,reference:'SYNTHETIC-'+run,
    base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='};
  const proof=msUpload_(proofInput),again=msUpload_(proofInput);
  expect(proof.proofId===again.proofId, 'Receipt upload is deduplicated');
  expect(msList_(msSession_(a.token)).bookings.find(x=>x.bookingId===first.bookingId).amountPaid===0, 'Receipt claim does not credit payment');
  const payment=odOpenPayment(proof.proofId);
  const paid=odSavePayment({token:payment.token,action:'APPROVE',amount:500,confirmed:true,purpose:'DEPOSIT',bankReference:'SYNTHETIC-'+run,notes:'TEST ONLY. No bank transaction.'});
  expect(paid.paid===500 && paid.balance===1300, 'Synthetic review updates paid amount and balance');
  expect(msRows_('PaymentReviewLog').some(x=>x.proofId===proof.proofId), 'Payment review audit recorded');
  const logout=send({action:'stay.logout',token:a.token});
  expect(logout.ok, 'Logout succeeds'); rejects(()=>msSession_(a.token), 'Logged-out session rejected');
  const report={checks:results.length,passed:results,durationSeconds:Math.round((Date.now()-started)/1000),completedAt:new Date().toISOString()};
  props.setProperty('STAGING_LAST_RESULT',JSON.stringify(report));
  console.log(JSON.stringify(report));
}
function stagingAssert_() {
  if (typeof STAGING_DATABASE_ID !== 'string' || SPREADSHEET_ID !== STAGING_DATABASE_ID) throw new Error('Staging database mismatch.');
  const ss=SpreadsheetApp.openById(STAGING_DATABASE_ID);
  if (!ss.getName().startsWith('Ignite Living STAGING')) throw new Error('Test database name required.');
  if (ss.getSheetByName('Properties').getRange('C2').getDisplayValue()!=='TEST ONLY') throw new Error('Synthetic fixture required.');
  const folder=DriveApp.getFolderById(STAGING_RECEIPT_FOLDER_ID);
  if (!folder.getName().startsWith('Ignite Living STAGING')) throw new Error('Test receipt folder required.');
  return ss;
}
