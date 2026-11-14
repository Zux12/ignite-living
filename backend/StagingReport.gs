// Summaries only: never logs fixture credentials, customer records or file IDs.
function reportStagingResults() {
  stagingAssert_();const p=PropertiesService.getScriptProperties();
  const core=JSON.parse(p.getProperty('STAGING_LAST_RESULT')||'null');
  const concurrency=JSON.parse(p.getProperty('STAGING_CONCURRENCY_RESULT')||'null');
  const lifecycle=JSON.parse(p.getProperty('STAGING_LIFECYCLE_RESULT')||'null');
  const accounts=JSON.parse(p.getProperty('STAGING_ACCOUNTS_RESULT')||'null');
  const recovery=JSON.parse(p.getProperty('STAGING_RECOVERY_RESULT')||'null');
  const report={environment:'STAGING ONLY',coreChecks:core?core.checks:null,lifecycleChecks:lifecycle?lifecycle.checks:null,accountChecks:accounts?accounts.checks:null,recoveryChecks:recovery?recovery.checks:null,concurrentBooking:concurrency?concurrency.concurrentBookingReplay:'pending',concurrentConfirmation:concurrency?concurrency.concurrentConfirmation:'pending',allSuitesComplete:!!(core&&concurrency&&lifecycle&&accounts&&recovery),generatedAt:new Date().toISOString()};
  console.log(JSON.stringify(report));
}
