// Apply a narrowly scoped patch to a private, UI-exported Apps Script source.
// No source identifiers or customer provisioning code are committed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir || path.resolve(inputDir) === path.resolve(outputDir)) throw new Error('Use distinct source and output directories.');
let code = fs.readFileSync(path.join(inputDir, 'Code.gs'), 'utf8');
const hash=crypto.createHash('sha256').update(code).digest('hex');
if (!['ab4956941af11a4f25b5727c9dd98b17507f108667f2aa31f2128ec4ee7aebee','38eedbbad76e8b19857bfb30959e3292dddfc6c52971e8c275f5fa3714259f4f'].includes(hash)) throw new Error('Source changed; review and rebase before patching.');
function replaceOne(from,to){if(code.split(from).length!==2)throw new Error('Patch anchor is not unique.');code=code.replace(from,to);}
replaceOne('    if (!bookingEnabled_()) {\n      reject_("Online booking requests are not open yet.");\n    }\n\n    const session', '    const session');
replaceOne('    // Serialise submissions and recheck availability before saving.', '    const identity = brIdentity_(input, session.customerId);\n\n    // Serialise submissions, replay retries, and recheck availability before saving.');
const before='      if (!bookingEnabled_()) {\n        reject_("Online booking requests are not open yet.");\n      }\n\n      msSession_(input.token);\n      const quote = checkAvailability_(input);\n\n      if (!quote.available) {\n        reject_("These dates are unavailable. Please choose other dates.");\n      }\n\n';
replaceOne(before, '      msSession_(input.token);\n');
replaceOne('      const now = new Date().toISOString();\n      const bookingId', '      const replay = brReplay_(sheet, headers, session.customerId, identity);\n      if (replay) return replay;\n      if (!bookingEnabled_()) reject_("Online booking requests are not open yet.");\n      const quote = checkAvailability_(input);\n      if (!quote.available) reject_("These dates are unavailable. Please choose other dates.");\n\n      const now = new Date().toISOString();\n      const bookingId');
const responseStart=code.indexOf('      return {\n        bookingId,',code.indexOf('function bookingDoPost_'));
const responseEnd=code.indexOf('\n      };',responseStart)+9;
if(responseStart<0||responseEnd<9)throw new Error('Response block missing.');
const response=code.slice(responseStart,responseEnd).replace('      return {','      const response = {');
code=code.slice(0,responseStart)+'      return response;'+code.slice(responseEnd);
replaceOne('      const record = {\n        bookingId,', response+'\n\n      const record = {\n        ...identity,\n        requestResult: JSON.stringify(response),\n        bookingId,');
fs.mkdirSync(outputDir,{recursive:true});
fs.writeFileSync(path.join(outputDir,'Code.gs'),code);
fs.copyFileSync(path.join(__dirname,'../backend/BookingRequests.gs'),path.join(outputDir,'BookingRequests.gs'));
for(const name of ['ManageStay.gs','GuestAccounts.gs','PaymentReview.gs','StayRequests.gs','OwnerDashboard.gs']){
 const source=path.join(inputDir,name);if(fs.existsSync(source))fs.copyFileSync(source,path.join(outputDir,name));
}
console.log('Prepared retry-safe backend; source files remain private.');
