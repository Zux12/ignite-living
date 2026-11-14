// Staging-only account transitions; credentials are random and never logged.
function runStagingAccountTests() {
  stagingAssert_();const props=PropertiesService.getScriptProperties();
  if(props.getProperty('STAGING_ACCOUNTS_RESULT')){console.log(props.getProperty('STAGING_ACCOUNTS_RESULT'));return;}
  const passed=[],started=Date.now(),expect=(ok,label)=>{if(!ok)throw new Error('STAGING CHECK FAILED: '+label);passed.push(label);};
  const rejects=(fn,label,pattern)=>{let error;try{fn();}catch(e){error=e;}expect(!!error&&(!pattern||pattern.test(String(error.message))),label);};
  const run=Utilities.getUuid(),password=Utilities.getUuid()+'-TEST',nextPassword=Utilities.getUuid()+'-TEST';
  const email='account-'+run+'@example.invalid',nextEmail='edited-'+run+'@example.invalid';
  const before=msRows_('Customers').length;
  rejects(()=>gaRegister_({customerName:'Synthetic Account',email,password:'short'}),'Short registration password rejected');
  expect(msRows_('Customers').length===before,'Invalid registration creates no account');
  const account=gaRegister_({customerName:'Synthetic Account',email,password});
  rejects(()=>gaRegister_({customerName:'Synthetic Duplicate',email,password}),'Duplicate email rejected');
  const edited={token:account.token,customerName:'Synthetic Edited Account',email:nextEmail,phone:'',currentPassword:password};
  rejects(()=>gaEdit_({...edited,currentPassword:'incorrect-synthetic-password'}),'Profile edit requires correct password');
  const updated=gaEdit_(edited);
  expect(updated.profile.customerId===account.profile.customerId&&updated.profile.email===nextEmail,'Profile edit preserves customer identity');
  rejects(()=>msSession_(account.token),'Profile edit invalidates old session');
  rejects(()=>msLogin_({identifier:email,password}),'Old login email no longer authenticates');
  const login=msLogin_({identifier:nextEmail,password});
  rejects(()=>msChangePassword_({token:login.token,currentPassword:'incorrect-synthetic-password',newPassword:nextPassword}),'Password change rejects wrong current password');
  const changed=msChangePassword_({token:login.token,currentPassword:password,newPassword:nextPassword});
  rejects(()=>msSession_(login.token),'Password change invalidates previous session');
  rejects(()=>msLogin_({identifier:nextEmail,password}),'Old password no longer authenticates');
  expect(!!msLogin_({identifier:nextEmail,password:nextPassword}).token,'New password authenticates');
  rejects(()=>msLogin_({identifier:nextEmail,password:'incorrect-synthetic-password'}),'Repeated incorrect login rejected');
  rejects(()=>msLogin_({identifier:nextEmail,password:'incorrect-synthetic-password'}),'Account sign-in rate limit enforced',/Too many sign-in attempts/);
  const forcedEmail='temporary-'+run+'@example.invalid',temporary=Utilities.getUuid()+'-TEST',replacement=Utilities.getUuid()+'-TEST';
  const forced=gaRegister_({customerName:'Synthetic Temporary Account',email:forcedEmail,password:temporary});
  gaWrite_(forced.profile.customerId,{mustChangePassword:true,authVersion:2},false);
  const restricted=msLogin_({identifier:forcedEmail,password:temporary});
  rejects(()=>msSession_(restricted.token),'Temporary-password session blocks normal actions',/temporary password/);
  const replaced=msChangePassword_({token:restricted.token,newPassword:replacement});
  expect(msSession_(replaced.token).customerId===forced.profile.customerId,'Forced password replacement enables normal session');
  const expiryKey='ms.session.'+msHash_(replaced.token),cache=CacheService.getScriptCache();
  const expiry=JSON.parse(cache.get(expiryKey));expiry.expires=Date.now()-1;cache.put(expiryKey,JSON.stringify(expiry),60);
  rejects(()=>msSession_(replaced.token),'Expired session rejected by hosted code',/expired/);
  for(const token of [updated.token,changed.token])JSON.parse(doPost({postData:{contents:JSON.stringify({action:'stay.logout',token})}}).getContent());
  const report={checks:passed.length,passed,durationSeconds:Math.round((Date.now()-started)/1000),completedAt:new Date().toISOString()};
  props.setProperty('STAGING_ACCOUNTS_RESULT',JSON.stringify(report));console.log(JSON.stringify(report));
}
