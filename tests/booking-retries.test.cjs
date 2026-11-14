// Synthetic, offline integration of the patched exported backend. Never calls Google.
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const dir=process.env.PATCHED_BACKEND_SOURCE_DIR;
const check=dir?test:test.skip;
const fields='bookingId,createdAt,propertyId,checkin,checkout,nights,occupants,customerName,customerPhone,customerEmail,bookingStatus,paymentStatus,rentalAmount,cleaningFee,bookingDeposit,totalAmount,amountPaid,agreementVersion,agreementAccepted,acceptedAt,updatedAt,notes,balanceDue,customerId,changeFees,cancellationRetained,refundDue,amountRefunded,checkinGuestName,checkinGuestPhone,checkinGuestEmail,requestId,requestHash,requestResult'.split(',');
function harness(){
 const state={rows:[],headers:[...fields],locked:false,flushFailure:false,owner:'synthetic-a',blocked:false,enabled:true};
 const sheet={getLastColumn:()=>state.headers.length,getLastRow:()=>state.rows.length+1,getRange:(row,col,count=1,width=state.headers.length)=>({
  getDisplayValues:()=>[state.headers],getValues:()=>state.rows.slice(row-2,row-2+count).map(r=>r.slice(col-1,col-1+width)),
  setValues:rows=>{assert.equal(state.locked,true);state.rows.push(...rows);}
 })};
 const c=vm.createContext({Date,Int32Array,Uint8Array,console:{error(){}},Utilities:{formatDate:()=> '2026-11-14',getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(a,v)=>[...crypto.createHash('sha256').update(String(v)).digest()]},
  SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush(){if(state.flushFailure){state.flushFailure=false;throw new Error('Synthetic lost response after write');}}},
  LockService:{getScriptLock:()=>({tryLock(){if(state.locked)return false;state.locked=true;return true;},waitLock(){if(state.locked)throw Error('Busy');state.locked=true;},releaseLock(){state.locked=false;}})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})}
 });
 for(const file of ['Code.gs','ManageStay.gs','GuestAccounts.gs','PaymentReview.gs','StayRequests.gs','OwnerDashboard.gs','BookingRequests.gs'])vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),c,{filename:file});
 c.msSession_=()=>({customerId:state.owner,customer:{customerName:'Synthetic Guest',phone:'',email:'synthetic@example.invalid'}});
 c.bookingEnabled_=()=>state.enabled;
 const property={propertyId:'IL001',propertyName:'Synthetic Home',status:'AVAILABLE',maxOccupants:30,nightlyRate:1200,twoNightTotal:1800,threeNightTotal:2400,additionalNightRate:500,cleaningFee:0,bookingDeposit:500,minNights:1};
 c.readRows_=name=>name==='Properties'?[property]:name==='Bookings'?state.rows.map(r=>Object.fromEntries(state.headers.map((h,i)=>[h,r[i]]))):name==='BlockedDates'&&state.blocked?[{propertyId:'IL001',startDate:'2027-01-01',endDate:'2027-02-01',active:true}]:[];
 const send=data=>c.bookingDoPost_({postData:{contents:JSON.stringify({action:'requestBooking',token:'synthetic',agreementAccepted:true,agreementVersion:'2.0',propertyId:'IL001',checkin:'2027-01-01',checkout:'2027-01-02',occupants:2,...data})}});
 return {c,state,send};
}
check('repeated request persists one booking and returns the original acknowledgement',()=>{
 const {state,send}=harness(),requestId=crypto.randomUUID();const a=send({requestId}),b=send({requestId});
 assert.equal(a.ok,true);assert.deepEqual(b,a);assert.equal(state.rows.length,1);assert.equal(state.locked,false);
});
check('retry after write-then-timeout returns the saved reference without a new row',()=>{
 const {state,send}=harness(),requestId=crypto.randomUUID();state.flushFailure=true;
 assert.equal(send({requestId}).ok,false);assert.equal(state.rows.length,1);
 const b=send({requestId});assert.equal(b.ok,true);assert.equal(b.bookingId,state.rows[0][0]);assert.equal(state.rows.length,1);
});
check('saved acknowledgement can be recovered after dates become blocked or booking closes',()=>{
 const {state,send}=harness(),requestId=crypto.randomUUID();const a=send({requestId});state.blocked=true;state.enabled=false;
 assert.deepEqual(send({requestId}),a);assert.equal(state.rows.length,1);
});
check('request identity cannot be reused with changed dates, occupancy or agreement',()=>{
 for(const change of [{checkout:'2027-01-03'},{occupants:3},{agreementAccepted:false}]){
  const {state,send}=harness(),requestId=crypto.randomUUID();send({requestId});assert.equal(send({requestId,...change}).ok,false);assert.equal(state.rows.length,1);
 }
});
check('replay is customer-bound and browser-supplied totals do not affect pricing',()=>{
 const {state,send}=harness(),requestId=crypto.randomUUID();const a=send({requestId,totalAmount:1});
 state.owner='synthetic-b';const b=send({requestId,totalAmount:0});assert.equal(b.ok,true);assert.notEqual(a.bookingId,b.bookingId);
 assert.equal(a.totalAmount,1200);assert.equal(b.totalAmount,1200);assert.equal(state.rows.length,2);
});
check('missing identity, missing or duplicate columns and corrupt replay fail closed',()=>{
 let h=harness();assert.equal(h.send({}).ok,false);assert.equal(h.state.rows.length,0);
 for(const duplicate of [false,true]){h=harness();if(duplicate)h.state.headers.push('requestId');else h.state.headers=h.state.headers.filter(x=>x!=='requestResult');assert.equal(h.send({requestId:crypto.randomUUID()}).ok,false);assert.equal(h.state.rows.length,0);}
 h=harness();const requestId=crypto.randomUUID();h.send({requestId});h.state.rows[0][fields.indexOf('requestResult')]='invalid';assert.equal(h.send({requestId}).ok,false);assert.equal(h.state.rows.length,1);
});
check('contended lock refuses a request without writing',()=>{const h=harness();h.state.locked=true;assert.equal(h.send({requestId:crypto.randomUUID()}).ok,false);assert.equal(h.state.rows.length,0);});
check('owner confirmation rechecks overlap inside lock and appends its audit atomically',()=>{
 const {c,state}=harness();const records=[{bookingId:'SYNTHETIC-A',propertyId:'IL001',checkin:'2027-01-01',checkout:'2027-01-03',occupants:2,bookingStatus:'PENDING_REVIEW',amountPaid:0,notes:'',row:2},{bookingId:'SYNTHETIC-B',propertyId:'IL001',checkin:'2027-01-02',checkout:'2027-01-04',occupants:2,bookingStatus:'PENDING_REVIEW',amountPaid:0,notes:'',row:3}];
 state.rows=records.map(b=>fields.map(h=>b[h]===undefined?'':b[h]));
 const props=new Map(),updates=[];c.odOwner_=()=>({ss:{},email:'owner@example.invalid'});c.PropertiesService={getUserProperties:()=>({getProperty:k=>props.get(k),deleteProperty:k=>props.delete(k)})};
 c.srTables_=()=>({bookings:{headers:fields,rows:records},requests:{rows:[]},log:{}});c.prTables_=()=>({proofs:{rows:[]}});
 const checkAvailability=c.checkAvailability_;c.checkAvailability_=(input,exclude)=>{assert.equal(state.locked,true);return checkAvailability(input,exclude);};
 c.prUpdate_=(_,row,key,value)=>({row,key,value});c.srAppend_=(_,record)=>({audit:record});c.Sheets={Spreadsheets:{batchUpdate:({requests})=>{assert.equal(state.locked,true);updates.push(requests);for(const u of requests)if(u.row){records.find(r=>r.row===u.row)[u.key]=u.value;state.rows[u.row-2][fields.indexOf(u.key)]=u.value;}}}};
 function review(b){const token=crypto.randomUUID();props.set('OD_BOOK_'+token,JSON.stringify({bookingId:b.bookingId,snapshot:c.srSnapshot_(b),expires:Date.now()+60000}));return {token,action:'CONFIRM',confirmed:true};}
 const first=review(records[0]),second=review(records[1]);c.odSaveBooking(first);assert.throws(()=>c.odSaveBooking(second),/no longer available/);assert.equal(updates.length,1);assert.equal(updates[0].filter(x=>x.audit).length,1);assert.equal(records[1].bookingStatus,'PENDING_REVIEW');assert.equal(state.locked,false);
});
