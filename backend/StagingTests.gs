// Test driver for a separate, owner-private Apps Script project only.
// Inject STAGING_DATABASE_ID and STAGING_RECEIPT_FOLDER_ID at build time.
// Never add this file to production. Each Run is a separate server request.
function runStagingSmokeTests() {
  const ss = stagingAssert_(), props = PropertiesService.getScriptProperties();
  let state = JSON.parse(props.getProperty('STAGING_RUN_STATE') || 'null');
  if (state && state.phase === 'complete') {
    console.log(props.getProperty('STAGING_LAST_RESULT')); return;
  }
  if (!state) state = {phase:'accounts-and-bookings',started:Date.now(),passed:[]};
  const phase = state.phase;
  const expect = (condition,label) => { if (!condition) throw new Error('STAGING CHECK FAILED: '+label); state.passed.push(label); };
  const rejects = (fn,label,pattern) => { let error; try { fn(); } catch(e) { error=e; }
    expect(!!error && (!pattern || pattern.test(String(error.message))),label); };
  const send = input => JSON.parse(doPost({postData:{contents:JSON.stringify(input)}}).getContent());
  if (phase === 'accounts-and-bookings') {
    if (!props.getProperty('MS_SECRET')) props.setProperty('MS_SECRET',Utilities.getUuid()+Utilities.getUuid());
    props.setProperty('MS_FOLDER_ID',STAGING_RECEIPT_FOLDER_ID); msFolder_();
    expect(ss.getSheetByName('Bookings').getLastColumn()>=34,'Retry columns present');
    rejects(()=>msSession_(''),'No-session access denied');
    const run=Utilities.getUuid(),password=Utilities.getUuid()+'-TEST';
    const emailA='synthetic-a-'+run+'@example.invalid';
    const a=gaRegister_({customerName:'Synthetic Guest A',email:emailA,password});
    const b=gaRegister_({customerName:'Synthetic Guest B',email:'synthetic-b-'+run+'@example.invalid',password});
    expect(!!a.token&&!!b.token,'Synthetic registration succeeds');
    rejects(()=>msLogin_({identifier:emailA,password:'incorrect-synthetic-password'}),'Wrong password rejected');
    const login=msLogin_({identifier:emailA,password});
    expect(msSession_(login.token).customerId===a.profile.customerId,'Correct login succeeds');
    const base=Date.UTC(new Date().getUTCFullYear()+5,0,10);
    let dates;
    for(let offset=0;offset<180;offset+=3){
      const checkin=new Date(base+offset*86400000).toISOString().slice(0,10);
      const checkout=new Date(base+(offset+2)*86400000).toISOString().slice(0,10);
      if(checkAvailability_({propertyId:'IL001',checkin,checkout,occupants:2}).available){dates={checkin,checkout};break;}
    }
    if(!dates)throw new Error('No unused synthetic date window.');
    const payload={action:'requestBooking',token:a.token,propertyId:'IL001',...dates,occupants:2,agreementAccepted:true,agreementVersion:'2.0',requestId:Utilities.getUuid(),totalAmount:1};
    const first=send(payload),replay=send(payload);
    expect(first.ok&&replay.ok&&first.bookingId===replay.bookingId,'Retry returns original booking reference');
    expect(first.totalAmount===1800&&first.bookingDeposit===500,'Server price ignores client amount');
    expect(msRows_('Bookings').filter(r=>r.requestId===payload.requestId&&r.customerId===a.profile.customerId).length===1,'One row for repeated request');
    expect(send({...payload,occupants:3}).ok===false,'Changed retry payload rejected');
    rejects(()=>srOwned_(first.bookingId,msSession_(b.token)),'Cross-customer booking access denied');
    expect(msList_(msSession_(b.token)).bookings.every(x=>x.bookingId!==first.bookingId),'Other customer cannot list booking');
    const second=send({...payload,token:b.token,requestId:Utilities.getUuid()});
    expect(second.ok,'Second pending request can be reviewed');
    Object.assign(state,{run,aToken:a.token,bToken:b.token,firstId:first.bookingId,secondId:second.bookingId,payload,phase:'confirm-first'});
  } else if(phase==='confirm-first') {
    const review=odOpenBooking(state.firstId);
    odSaveBooking({token:review.token,action:'CONFIRM',confirmed:true,notes:'TEST ONLY'});
    // The API write is verified in the next execution, matching separate UI RPCs.
    state.phase='reject-overlap-and-upload';
  } else if(phase==='reject-overlap-and-upload') {
    const bookings=msRows_('Bookings');
    expect(bookings.find(b=>b.bookingId===state.firstId).bookingStatus==='CONFIRMED','First confirmation persists across requests');
    expect(checkAvailability_(state.payload,state.secondId).available===false,'Confirmed dates unavailable in fresh request');
    const review=odOpenBooking(state.secondId);
    rejects(()=>odSaveBooking({token:review.token,action:'CONFIRM',confirmed:true,notes:'TEST ONLY'}),'Overlapping confirmation rejected',/no longer available/);
    expect(send(state.payload).bookingId===state.firstId,'Booking replay survives confirmation in a new request');
    const proofInput={token:state.aToken,bookingId:state.firstId,uploadId:Utilities.getUuid(),amount:500,paymentDate:Utilities.formatDate(new Date(),'Asia/Kuala_Lumpur','yyyy-MM-dd'),reference:'SYNTHETIC-'+state.run,
      base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='};
    const proof=msUpload_(proofInput),again=msUpload_(proofInput);
    expect(proof.proofId===again.proofId,'Receipt upload is deduplicated');
    state.proofId=proof.proofId;state.phase='review-payment';
  } else if(phase==='review-payment') {
    expect(msList_(msSession_(state.aToken)).bookings.find(b=>b.bookingId===state.firstId).amountPaid===0,'Receipt claim does not credit payment');
    const review=odOpenPayment(state.proofId);
    const paid=odSavePayment({token:review.token,action:'APPROVE',amount:500,confirmed:true,purpose:'DEPOSIT',bankReference:'SYNTHETIC-'+state.run,notes:'TEST ONLY. No bank transaction.'});
    expect(paid.paid===500&&paid.balance===1300,'Synthetic review returns correct paid amount and balance');
    state.phase='verify-payment-and-logout';
  } else if(phase==='verify-payment-and-logout') {
    const bookings=msList_(msSession_(state.aToken)).bookings;
    const first=bookings.find(b=>b.bookingId===state.firstId);
    expect(first.amountPaid===500&&first.balanceDue===1300,'Verified payment persists for guest in a new request');
    expect(msRows_('Bookings').find(b=>b.bookingId===state.secondId).bookingStatus==='PENDING_REVIEW','Rejected overlap leaves second request pending');
    expect(msRows_('PaymentReviewLog').filter(r=>r.proofId===state.proofId).length===1,'One payment review audit recorded');
    const proof=msRows_('PaymentProofs').find(r=>r.proofId===state.proofId),file=DriveApp.getFileById(proof.fileId);
    expect(file.getSharingAccess()===DriveApp.Access.PRIVATE&&!file.getViewers().length&&!file.getEditors().length,'Synthetic receipt remains owner-private');
    const logout=send({action:'stay.logout',token:state.aToken});
    expect(logout.ok,'Logout succeeds');rejects(()=>msSession_(state.aToken),'Logged-out session rejected');
    send({action:'stay.logout',token:state.bToken});
    const report={checks:state.passed.length,passed:state.passed,durationSeconds:Math.round((Date.now()-state.started)/1000),completedAt:new Date().toISOString()};
    props.setProperty('STAGING_LAST_RESULT',JSON.stringify(report));
    state={phase:'complete'};
    console.log(JSON.stringify(report));
  } else throw new Error('Unknown staging test phase.');
  props.setProperty('STAGING_RUN_STATE',JSON.stringify(state));
  console.log(JSON.stringify({completedPhase:phase,nextPhase:state.phase,checksPassed:state.passed?state.passed.length:'complete'}));
}
function stagingAssert_() {
  if(typeof STAGING_DATABASE_ID!=='string'||SPREADSHEET_ID!==STAGING_DATABASE_ID)throw new Error('Staging database mismatch.');
  const ss=SpreadsheetApp.openById(STAGING_DATABASE_ID);
  if(!ss.getName().startsWith('Ignite Living STAGING'))throw new Error('Test database name required.');
  if(ss.getSheetByName('Properties').getRange('C2').getDisplayValue()!=='TEST ONLY')throw new Error('Synthetic fixture required.');
  const folder=DriveApp.getFolderById(STAGING_RECEIPT_FOLDER_ID);
  if(!folder.getName().startsWith('Ignite Living STAGING'))throw new Error('Test receipt folder required.');
  return ss;
}
