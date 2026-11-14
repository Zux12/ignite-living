// Isolated staging only. Run the paired probes in separate editor tabs.
function prepareStagingConcurrency() {
  stagingAssert_();
  const props=PropertiesService.getScriptProperties();
  const previous=JSON.parse(props.getProperty('STAGING_CONCURRENT')||'null');
  if(previous&&previous.reviewA)throw new Error('Confirmation fixture already prepared.');
  for(const key of ['STAGING_BOOKING_A','STAGING_BOOKING_B'])props.deleteProperty(key);
  const customer=msRows_('Customers').filter(c=>String(c.email).endsWith('@example.invalid')&&c.customerName==='Synthetic Guest A').pop();
  if(!customer)throw new Error('Synthetic customer required.');
  const token=msIssue_(customer).token,year=new Date().getUTCFullYear()+6;
  const payload={action:'requestBooking',token,propertyId:'IL001',checkin:year+'-02-10',checkout:year+'-02-12',occupants:2,agreementAccepted:true,agreementVersion:'2.0',requestId:Utilities.getUuid()};
  if(!checkAvailability_(payload).available)throw new Error('Concurrency fixture dates already in use.');
  props.setProperty('STAGING_CONCURRENT',JSON.stringify({payload,customerId:customer.customerId,startAt:Date.now()+45000}));
  console.log('Concurrency fixture prepared. No production data used.');
}
function runStagingConcurrentBookingA(){stagingConcurrentBooking_('A');}
function runStagingConcurrentBookingB(){stagingConcurrentBooking_('B');}
function stagingConcurrentBooking_(label) {
  stagingAssert_();const props=PropertiesService.getScriptProperties(),s=JSON.parse(props.getProperty('STAGING_CONCURRENT')||'null');
  if(!s)throw new Error('Prepare concurrency first.');
  stagingAwaitProbe_(s.startAt);const start=Date.now();
  const result=JSON.parse(doPost({postData:{contents:JSON.stringify(s.payload)}}).getContent());
  const record={start,end:Date.now(),ok:result.ok,bookingId:result.bookingId};
  props.setProperty('STAGING_BOOKING_'+label,JSON.stringify(record));
  console.log(JSON.stringify({probe:label,ok:record.ok,durationMs:record.end-start}));
}
function prepareStagingConfirmations() {
  stagingAssert_();const props=PropertiesService.getScriptProperties(),s=JSON.parse(props.getProperty('STAGING_CONCURRENT')||'null');
  const a=JSON.parse(props.getProperty('STAGING_BOOKING_A')||'null'),b=JSON.parse(props.getProperty('STAGING_BOOKING_B')||'null');
  const rows=msRows_('Bookings').filter(r=>r.customerId===s.customerId&&r.requestId===s.payload.requestId);
  if(!a||!b||!a.ok||!b.ok||a.bookingId!==b.bookingId||rows.length!==1)throw new Error('Concurrent booking replay failed.');
  const overlap=Math.max(a.start,b.start)<Math.min(a.end,b.end);
  if(!overlap)throw new Error('Probe intervals did not overlap; concurrency is unverified.');
  const second=JSON.parse(doPost({postData:{contents:JSON.stringify({...s.payload,requestId:Utilities.getUuid()})}}).getContent());
  if(!second.ok)throw new Error('Second synthetic pending request failed.');
  s.firstId=a.bookingId;s.secondId=second.bookingId;
  s.reviewA=odOpenBooking(s.firstId).token;s.reviewB=odOpenBooking(s.secondId).token;s.confirmAt=Date.now()+45000;
  props.setProperty('STAGING_CONCURRENT',JSON.stringify(s));
  console.log(JSON.stringify({concurrentBookingPassed:true,overlappingExecutions:true,bookingRows:rows.length,next:'paired confirmations'}));
}
function runStagingConcurrentConfirmA(){stagingConcurrentConfirm_('A');}
function runStagingConcurrentConfirmB(){stagingConcurrentConfirm_('B');}
function stagingConcurrentConfirm_(label) {
  stagingAssert_();const props=PropertiesService.getScriptProperties(),s=JSON.parse(props.getProperty('STAGING_CONCURRENT')||'null');
  stagingAwaitProbe_(s.confirmAt);const start=Date.now();let confirmed=false,conflict=false;
  try{odSaveBooking({token:s['review'+label],action:'CONFIRM',confirmed:true,notes:'TEST ONLY concurrent confirmation'});confirmed=true;}
  catch(e){if(!/no longer available/.test(String(e.message)))throw e;conflict=true;}
  const record={start,end:Date.now(),confirmed,conflict};
  props.setProperty('STAGING_CONFIRM_'+label,JSON.stringify(record));
  console.log(JSON.stringify({probe:label,...record}));
}
function verifyStagingConcurrency() {
  stagingAssert_();const props=PropertiesService.getScriptProperties(),s=JSON.parse(props.getProperty('STAGING_CONCURRENT')||'null');
  const a=JSON.parse(props.getProperty('STAGING_CONFIRM_A')||'null'),b=JSON.parse(props.getProperty('STAGING_CONFIRM_B')||'null');
  if(!a||!b||Number(a.confirmed)+Number(b.confirmed)!==1||Number(a.conflict)+Number(b.conflict)!==1)throw new Error('Expected one confirmation and one conflict.');
  if(Math.max(a.start,b.start)>=Math.min(a.end,b.end))throw new Error('Confirmation execution intervals did not overlap.');
  const rows=msRows_('Bookings').filter(r=>[s.firstId,s.secondId].includes(r.bookingId));
  const audits=msRows_('StayRequestLog').filter(r=>[s.firstId,s.secondId].includes(r.bookingId)&&r.action==='BOOKING_CONFIRM');
  if(rows.filter(r=>r.bookingStatus==='CONFIRMED').length!==1||rows.filter(r=>r.bookingStatus==='PENDING_REVIEW').length!==1||audits.length!==1)throw new Error('Confirmation records or audit inconsistent.');
  const report={concurrentBookingReplay:'passed',concurrentConfirmation:'passed',overlappingExecutions:true,confirmationAuditRows:audits.length,completedAt:new Date().toISOString()};
  props.setProperty('STAGING_CONCURRENCY_RESULT',JSON.stringify(report));
  console.log(JSON.stringify(report));
}

function stagingAwaitProbe_(target){const wait=target-Date.now();if(wait<0||wait>45000)throw new Error('Probe window missed; prepare a fresh fixture.');if(wait)Utilities.sleep(wait);}
