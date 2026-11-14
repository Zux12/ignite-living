// Optional offline review of owner-supplied Apps Script source; no Google calls.
// BACKEND_SOURCE_DIR=/private/path node --test tests/backend-snapshot.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sourceDir = process.env.BACKEND_SOURCE_DIR;
const check = sourceDir ? test : test.skip;
const property = { propertyId:'IL001', propertyName:'Synthetic Home', status:'AVAILABLE', maxOccupants:30, nightlyRate:1200, twoNightTotal:1800, threeNightTotal:2400, additionalNightRate:500, cleaningFee:0, bookingDeposit:500, minNights:1 };
const booking = { bookingId:'SYNTHETIC-A', customerId:'synthetic-a', propertyId:'IL001', checkin:'2027-01-10', checkout:'2027-01-12', occupants:2, bookingStatus:'CONFIRMED', rentalAmount:1800, cleaningFee:0, totalAmount:1800, amountPaid:500, bookingDeposit:500, changeFees:0 };
function context() {
  const cache = new Map(), state = { locked:false, locks:0, releases:0, writes:[], tables:{Properties:[property], Bookings:[], BlockedDates:[], Settings:[{setting:'bookingEnabled',value:true}]} };
  const c = vm.createContext({console:{error(){}},Date,Int32Array,Uint8Array,Utilities:{
    formatDate:()=> '2026-11-15',getUuid:()=>crypto.randomUUID(), DigestAlgorithm:{SHA_256:'sha256'},
    computeDigest:(alg,value)=>[...crypto.createHash('sha256').update(typeof value==='string'?value:Buffer.from(value)).digest()],
    newBlob:value=>({getBytes:()=>[...Buffer.from(value)]}),base64Decode:value=>[...Buffer.from(value,'base64')]
  },CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})},
  LockService:{getScriptLock:()=>({tryLock(){if(state.locked)return false;state.locked=true;state.locks++;return true;},releaseLock(){state.locked=false;state.releases++;}})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})}});
  for (const name of ['Code.gs','ManageStay.gs','GuestAccounts.gs','PaymentReview.gs','StayRequests.gs']) vm.runInContext(fs.readFileSync(path.join(sourceDir,name),'utf8'),c,{filename:name});
  c.readRows_ = c.msRows_ = name => state.tables[name] || [];
  return {c,state,cache};
}
const input = extra => ({propertyId:'IL001',checkin:'2027-01-01',checkout:'2027-01-02',occupants:2,...extra});

check('snapshot pricing: 1, 2, 3, 4 and 30 nights; deposit remains part of total', () => {
  const {c}=context();
  for(const [nights,total] of [[1,1200],[2,1800],[3,2400],[4,2900],[30,15900]]){
    const q=c.calculatePrice_(property,nights);assert.equal(q.totalAmount,total);assert.equal(q.bookingDeposit,500);assert.equal(q.balanceAfterDeposit,total-500);
  }
});
check('snapshot rejects invalid dates, past stays, occupancy limits and Coming Soon', () => {
  const {c,state}=context();
  for(const extra of [{checkin:'2026-02-30'},{checkin:'2020-01-01'},{checkout:'2027-01-01'},{occupants:31},{occupants:0},{occupants:1.5}])assert.throws(()=>c.checkAvailability_(input(extra)));
  state.tables.Properties=[{...property,status:'COMING_SOON'}];assert.throws(()=>c.checkAvailability_(input()));
});
check('snapshot ignores browser-supplied totals and enforces confirmed/blocked overlap', () => {
  const {c,state}=context();
  assert.equal(c.checkAvailability_(input({totalAmount:1,bookingDeposit:0})).totalAmount,1200);
  state.tables.Bookings=[{...booking,checkin:'2027-01-01',checkout:'2027-01-03'}];
  assert.equal(c.checkAvailability_(input()).available,false);
  assert.equal(c.checkAvailability_(input({checkin:'2027-01-03',checkout:'2027-01-04'})).available,true);
  state.tables.Bookings=[];state.tables.BlockedDates=[{propertyId:'IL001',active:true,startDate:'2027-01-01',endDate:'2027-01-03'}];
  assert.equal(c.checkAvailability_(input()).available,false);
});
check('snapshot ownership rejects a different customer even with a known booking ID', () => {
  const {c,state}=context();state.tables.Bookings=[booking];
  assert.throws(()=>c.srOwned_(booking.bookingId,{customerId:'synthetic-b'}));
  assert.equal(c.srOwned_(booking.bookingId,{customerId:'synthetic-a'}).bookingId,booking.bookingId);
});
check('snapshot session rejects missing, unknown and expired sessions', () => {
  const {c,cache}=context();
  assert.throws(()=>c.msSession_(''));assert.throws(()=>c.msSession_('a'.repeat(64)));
  cache.set('ms.session.'+c.msHash_('a'.repeat(64)),JSON.stringify({customerId:'synthetic-a',expires:0,authVersion:1}));
  assert.throws(()=>c.msSession_('a'.repeat(64)));
});
check('snapshot registration validates contacts and password before any write', () => {
  const {c}=context();
  for(const value of [{customerName:'A',email:'a@example.invalid'},{customerName:'Guest',email:'bad'},{customerName:'Guest',phone:'abc'},{customerName:'Guest'}])assert.throws(()=>c.gaContact_(value));
  assert.throws(()=>c.gaRegister_({customerName:'Guest',email:'guest@example.invalid',password:'short'}));
});
check('snapshot password primitive matches Node PBKDF2 with non-ASCII and long inputs', () => {
  const {c}=context();const salt='01'.repeat(32);
  for(const password of ['synthetic-password','Malaysia-✓-ñ', 'x'.repeat(90)])assert.equal(c.msPbkdf2_(password,salt,2),crypto.pbkdf2Sync(password,Buffer.from(salt,'hex'),2,32,'sha256').toString('hex'));
});
check('snapshot date-change fee boundary is RM100 at five days and free at six', () => {
  const {c}=context();const payload={checkin:'2027-02-01',checkout:'2027-02-03'};
  assert.equal(c.srPlan_(booking,'DATES',payload,'2027-01-05').fee,100);
  assert.equal(c.srPlan_(booking,'DATES',payload,'2027-01-04').fee,0);
});
check('snapshot cancellation retains only the paid deposit portion', () => {
  const {c}=context();
  for(const [paid,retained,refund] of [[0,0,0],[200,200,0],[500,500,0],[800,500,300]]){
    const q=c.srPlan_({...booking,amountPaid:paid},'CANCEL',{},'2026-11-15');assert.equal(q.retained,retained);assert.equal(q.refund,refund);
  }
});
check('snapshot verified payments update balances; unverified claims do not', () => {
  const {c}=context(),proof={proofId:'SYNTHETIC-PROOF',bookingId:booking.bookingId,claimedAmount:500,reviewStatus:'AWAITING_VERIFICATION',fileHash:'synthetic-hash'};
  const q=c.prPlan_(proof,{...booking,amountPaid:0},[proof],{action:'APPROVE',amount:500,confirmed:true,purpose:'DEPOSIT',bankReference:'TEST-ONLY'});
  assert.equal(q.paid,500);assert.equal(q.balance,1300);
  assert.throws(()=>c.prPlan_(proof,{...booking,amountPaid:0},[proof],{action:'APPROVE',amount:2000,confirmed:true,purpose:'DEPOSIT',notes:'TEST'}));
});
check('snapshot rejects duplicate verified receipts and cancelled booking payment review', () => {
  const {c}=context(),proof={proofId:'SYNTHETIC-PROOF',bookingId:booking.bookingId,claimedAmount:500,reviewStatus:'AWAITING_VERIFICATION',fileHash:'same-hash'};
  const old={...proof,proofId:'SYNTHETIC-OLD',bookingId:'OTHER-SYNTHETIC',reviewStatus:'VERIFIED',approvedAmount:500};
  const action={action:'APPROVE',amount:500,confirmed:true,purpose:'DEPOSIT'};
  assert.throws(()=>c.prPlan_(proof,{...booking,amountPaid:0},[proof,old],action));
  assert.throws(()=>c.prPlan_(proof,{...booking,amountPaid:0,bookingStatus:'CANCELLED'},[proof],action));
});
check('snapshot upload rejects invalid bytes and oversized files before storage', () => {
  const {c}=context();c.msSession_=()=>({customerId:'synthetic-a'});
  const data={token:'synthetic',uploadId:'synthetic-upload-1234',amount:500,paymentDate:'2026-11-14',reference:''};
  assert.throws(()=>c.msUpload_({...data,base64:Buffer.from('<html>not a receipt</html>').toString('base64')}));
  assert.throws(()=>c.msUpload_({...data,base64:'A'.repeat(6990512)}));
});
check('snapshot locks release on errors and reject a concurrent lock holder', () => {
  const {c,state}=context();assert.throws(()=>c.msLocked_(()=>{throw new Error('Synthetic failure');}));
  assert.equal(state.locked,false);assert.equal(state.releases,1);
  state.locked=true;assert.throws(()=>c.msLocked_(()=>{throw new Error('Must not run');}));
});
check('confirmed snapshot defect: retried booking creates two pending records', () => {
  const {c,state}=context();
  c.msSession_=()=>({customerId:'synthetic-a',customer:{customerName:'Synthetic Guest',phone:'',email:'guest@example.invalid'}});
  const headers=['bookingId','customerId','createdAt','propertyId','checkin','checkout','nights','occupants','customerName','customerPhone','customerEmail','bookingStatus','paymentStatus','rentalAmount','cleaningFee','bookingDeposit','totalAmount','amountPaid','agreementVersion','agreementAccepted','acceptedAt','updatedAt','notes','balanceDue'];
  c.SpreadsheetApp={flush(){},openById:()=>({getSheetByName:()=>({getLastColumn:()=>headers.length,getLastRow:()=>state.writes.length+1,getRange:()=>({getDisplayValues:()=>[headers],setValues:rows=>{assert.equal(state.locked,true);state.writes.push(...rows);}})})})};
  const e={postData:{contents:JSON.stringify({...input(),action:'requestBooking',token:'synthetic',agreementAccepted:true,agreementVersion:'2.0'})}};
  const one=c.bookingDoPost_(e),two=c.bookingDoPost_(e);
  assert.equal(one.ok,true);assert.equal(two.ok,true);assert.equal(state.writes.length,2);assert.notEqual(one.bookingId,two.bookingId);
  assert.equal(state.locks,2);assert.equal(state.releases,2);
});
