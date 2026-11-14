// Owner-private staging recovery drill. Copies only guarded synthetic fixtures.
// Retain the copies for review; do not run against production.
function runStagingRecoveryTests() {
  const ss=stagingAssert_(),props=PropertiesService.getScriptProperties();
  if(props.getProperty('STAGING_RECOVERY_RESULT')){console.log(props.getProperty('STAGING_RECOVERY_RESULT'));return;}
  const passed=[],expect=(ok,label)=>{if(!ok)throw new Error('STAGING CHECK FAILED: '+label);passed.push(label);};
  const digest=value=>Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value));
  const fingerprint=book=>digest(JSON.stringify(book.getSheets().map(sheet=>({name:sheet.getName(),values:sheet.getDataRange().getValues()}))));
  const privateFile=file=>file.getSharingAccess()===DriveApp.Access.PRIVATE&&!file.getEditors().length&&!file.getViewers().length;
  const run=Utilities.getUuid(),original=DriveApp.getFileById(ss.getId()),originalHash=fingerprint(ss);
  const backup=original.makeCopy('Ignite Living STAGING — Recovery backup '+run),backupBook=SpreadsheetApp.openById(backup.getId());
  expect(fingerprint(backupBook)===originalHash,'Spreadsheet backup preserves all nine tab contents');
  const damaged=backup.makeCopy('Ignite Living STAGING — Recovery damaged fixture '+run),damagedBook=SpreadsheetApp.openById(damaged.getId());
  const settings=damagedBook.getSheetByName('Settings'),rows=settings.getDataRange().getValues(),i=rows.findIndex(row=>row[0]==='bookingEnabled');
  if(i<0)throw new Error('Missing synthetic setting.');settings.getRange(i+1,2).setValue(false);SpreadsheetApp.flush();
  expect(fingerprint(damagedBook)!==originalHash,'Recovery drill detects altered fixture contents');
  const restored=backup.makeCopy('Ignite Living STAGING — Recovery restored fixture '+run),restoredBook=SpreadsheetApp.openById(restored.getId());
  expect(fingerprint(restoredBook)===originalHash&&restoredBook.getSheets().length===9,'Fresh restored copy matches intact backup');
  expect([backup,damaged,restored].every(privateFile),'Recovery spreadsheet copies remain owner-private');
  const proofs=msRows_('PaymentProofs'),proof=proofs.find(p=>p.fileId);if(!proof)throw new Error('Synthetic receipt required.');
  const receipt=DriveApp.getFileById(proof.fileId),receiptBackup=receipt.makeCopy('Ignite Living STAGING — Recovery receipt '+run+'.png');
  expect(digest(receipt.getBlob().getBytes())===digest(receiptBackup.getBlob().getBytes()),'Receipt backup preserves file bytes');
  expect(privateFile(receiptBackup),'Receipt backup remains owner-private');
  props.setProperty('STAGING_RECOVERY_FILES',JSON.stringify({backup:backup.getId(),damaged:damaged.getId(),restored:restored.getId(),receipt:receiptBackup.getId()}));
  const report={checks:passed.length,passed,completedAt:new Date().toISOString()};props.setProperty('STAGING_RECOVERY_RESULT',JSON.stringify(report));console.log(JSON.stringify(report));
}
