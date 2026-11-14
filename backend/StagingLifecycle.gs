// Separate staging only; uses the synthetic, paid booking from the core suite.
// Each invocation is one request boundary. No bank transaction is performed.
function runStagingLifecycleTests() {
  stagingAssert_();const props=PropertiesService.getScriptProperties();
  let s=JSON.parse(props.getProperty('STAGING_LIFECYCLE_STATE')||'null');
  if(s&&s.phase==='complete'){console.log(props.getProperty('STAGING_LIFECYCLE_RESULT'));return;}
  if(!s){
    const b=msRows_('Bookings').filter(b=>b.customerName==='Synthetic Guest A'&&b.bookingStatus==='CONFIRMED'&&Number(b.amountPaid)===500).pop();
    if(!b)throw new Error('Paid core-test fixture required.');
    const c=msCustomer_(b.customerId);if(!String(c.email).endsWith('@example.invalid'))throw new Error('Synthetic customer required.');
    s={phase:'submit-dates',bookingId:b.bookingId,customerId:b.customerId,token:msIssue_(c).token,passed:[],started:Date.now()};
  }
  const phase=s.phase,expect=(ok,label)=>{if(!ok)throw new Error('STAGING CHECK FAILED: '+label);s.passed.push(label);};
  const rejects=(fn,label)=>{let failed=false;try{fn();}catch(e){failed=true;}expect(failed,label);};
  const booking=()=>srOwned_(s.bookingId,msSession_(s.token));
  const review=()=>{const r=odOpenRequest(s.requestId);return odSaveRequest({token:r.token,action:'APPROVE',notes:'TEST ONLY lifecycle review'});};
  if(phase==='submit-dates'){
    const b=booking(),start=Date.parse(msDate_(b.checkin))+30*86400000;
    s.checkin=new Date(start).toISOString().slice(0,10);s.checkout=new Date(start+2*86400000).toISOString().slice(0,10);
    const p=srPreview_({token:s.token,bookingId:s.bookingId,type:'DATES',checkin:s.checkin,checkout:s.checkout,reason:'TEST ONLY date change'});
    expect(p.quote.fee===0&&p.quote.totalAmount===1800&&p.quote.amountPaid===500,'Advance date change preserves price and payment');
    const tomorrow=new Date(Date.parse(srToday_())+86400000).toISOString().slice(0,10);
    const late=srPlan_({...b,checkin:tomorrow},'DATES',{checkin:s.checkin,checkout:s.checkout},srToday_());
    expect(late.fee===100&&late.totalAmount===1900,'Late date-change calculation includes RM100');
    rejects(()=>srSubmit_({token:s.token,previewId:p.previewId,accepted:false}),'Stay change requires policy acceptance');
    const r=srSubmit_({token:s.token,previewId:p.previewId,accepted:true});s.previewId=p.previewId;s.requestId=r.requestId;s.phase='approve-dates';
  } else if(phase==='approve-dates'){
    const again=srSubmit_({token:s.token,previewId:s.previewId,accepted:true});
    expect(again.requestId===s.requestId&&msRows_('StayRequests').filter(r=>r.requestId===s.requestId).length===1,'Repeated stay-change request is deduplicated');
    review();s.phase='submit-guest';
  } else if(phase==='submit-guest'){
    const b=booking();expect(msDate_(b.checkin)===s.checkin&&msDate_(b.checkout)===s.checkout&&Number(b.amountPaid)===500,'Approved dates persist with payment preserved');
    const p=srPreview_({token:s.token,bookingId:s.bookingId,type:'GUEST',guestName:'Synthetic Replacement Guest',guestEmail:'replacement@example.invalid',guestPhone:'',reason:'TEST ONLY guest change'});
    const r=srSubmit_({token:s.token,previewId:p.previewId,accepted:true});s.requestId=r.requestId;s.phase='approve-guest';
  } else if(phase==='approve-guest'){
    review();s.phase='verify-guest-and-undo-payment';
  } else if(phase==='verify-guest-and-undo-payment'){
    const b=booking();expect(b.checkinGuestName==='Synthetic Replacement Guest'&&b.customerId===s.customerId,'Guest change preserves booking ownership');
    const proof=msRows_('PaymentProofs').find(p=>p.bookingId===s.bookingId&&p.reviewStatus==='VERIFIED');if(!proof)throw new Error('Verified synthetic proof required.');s.proofId=proof.proofId;
    const r=odOpenPayment(s.proofId),paid=odSavePayment({token:r.token,action:'UNDO',notes:'TEST ONLY undo review'});
    expect(paid.paid===0&&paid.balance===1800,'Undo payment returns full balance');s.phase='correct-payment';
  } else if(phase==='correct-payment'){
    expect(Number(booking().amountPaid)===0,'Payment undo persists across requests');
    const r=odOpenPayment(s.proofId),paid=odSavePayment({token:r.token,action:'APPROVE',amount:1000,confirmed:true,purpose:'OTHER',bankReference:'SYNTHETIC-CORRECTION-'+Utilities.getUuid(),notes:'TEST ONLY amount correction to exercise refund recording. No transaction.'});
    expect(paid.paid===1000&&paid.balance===800,'Corrected synthetic payment updates balance');s.phase='submit-cancellation';
  } else if(phase==='submit-cancellation'){
    expect(Number(booking().amountPaid)===1000,'Corrected payment persists across requests');
    const p=srPreview_({token:s.token,bookingId:s.bookingId,type:'CANCEL',reason:'TEST ONLY cancellation',bankName:'TEST BANK ONLY',accountName:'SYNTHETIC TEST ACCOUNT',accountNumber:'TESTONLY123'});
    expect(p.quote.retained===500&&p.quote.refund===500&&p.quote.balanceDue===0,'Cancellation retains deposit and calculates refund');
    const r=srSubmit_({token:s.token,previewId:p.previewId,accepted:true});s.requestId=r.requestId;s.phase='approve-cancellation';
  } else if(phase==='approve-cancellation'){
    review();s.phase='record-refund';
  } else if(phase==='record-refund'){
    const b=booking();expect(b.bookingStatus==='CANCELLED'&&Number(b.refundDue)===500&&Number(b.amountRefunded)===0,'Cancellation approval records pending refund');
    rejects(()=>srPreview_({token:s.token,bookingId:s.bookingId,type:'DATES',checkin:s.checkin,checkout:s.checkout,reason:'TEST ONLY'}),'Cancelled booking rejects further stay changes');
    const proof=msRows_('PaymentProofs').find(p=>p.proofId===s.proofId);
    rejects(()=>prPlan_(proof,b,[proof],{action:'UNDO',notes:'TEST ONLY'}),'Cancelled booking locks payment reviews');
    const r=odOpenRequest(s.requestId);odSaveRequest({token:r.token,action:'REFUND_COMPLETE',confirmed:true,refundDate:srToday_(),refundReference:'SYNTHETIC-NO-TRANSFER',notes:'TEST ONLY record. No bank transfer.'});
    s.phase='verify-refund';
  } else if(phase==='verify-refund'){
    const b=booking(),r=msRows_('StayRequests').find(r=>r.requestId===s.requestId);
    expect(Number(b.refundDue)===0&&Number(b.amountRefunded)===500&&b.paymentStatus==='REFUNDED'&&r.status==='REFUND_COMPLETED','Refund record persists with matching booking and request');
    const logs=msRows_('StayRequestLog').filter(r=>r.bookingId===s.bookingId);
    expect(logs.filter(r=>r.action==='SUBMIT').length===3&&logs.filter(r=>r.action==='APPROVE').length===3&&logs.filter(r=>r.action==='REFUND_COMPLETE').length===1,'Date, guest, cancellation and refund audit counts match');
    expect(msRows_('PaymentReviewLog').filter(r=>r.proofId===s.proofId).length===3,'Payment approval, undo and correction audit counts match');
    const report={checks:s.passed.length,passed:s.passed,durationSeconds:Math.round((Date.now()-s.started)/1000),completedAt:new Date().toISOString()};
    props.setProperty('STAGING_LIFECYCLE_RESULT',JSON.stringify(report));
    JSON.parse(doPost({postData:{contents:JSON.stringify({action:'stay.logout',token:s.token})}}).getContent());
    s={phase:'complete'};console.log(JSON.stringify(report));
  } else throw new Error('Unknown lifecycle phase.');
  props.setProperty('STAGING_LIFECYCLE_STATE',JSON.stringify(s));
  console.log(JSON.stringify({completedPhase:phase,nextPhase:s.phase,checksPassed:s.passed?s.passed.length:'complete'}));
}
