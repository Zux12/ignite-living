// Narrow patches against the freshly reviewed private production source; no private files are committed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [source,output]=process.argv.slice(2);
if(!source||!output||path.resolve(source)===path.resolve(output))throw Error('Use distinct private source/output directories.');
const expected={'Code.gs':'210e221d044f367eb4cce583320951f19eae1896a88261699a4f4b565a538547','ManageStay.gs':'8a4cfd23078d5fe766bcdb809e59af44572738a968574364285736d2c8e4e681','AdminApi.gs':'f0d44eb19b45d8d6159ad38fe4cbb99514b484e60e16224e2dc2f8c14f69505a'};
for(const[name,hash]of Object.entries(expected))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')!==hash)throw Error(name+' changed: review the current source first.');
fs.mkdirSync(output,{recursive:true,mode:0o700});
function patch(s,from,to){if(s.split(from).length!==2)throw Error('Pricing patch anchor changed.');return s.replace(from,to);}
let code=fs.readFileSync(path.join(source,'Code.gs'),'utf8');
code=patch(code,'    if (input.action === "quote") {','    if (input.action === "pricing") return ppPublic_();\n\n    if (input.action === "quote") {');
code=patch(code,'    ...calculatePrice_(property, nights)','    ...ppQuote_(property, nights, checkin, checkout)');
code=patch(code,'      const quote = checkAvailability_(input);','      const quote = checkAvailability_(input);\n      ppAssertQuote_(input, quote);');
code=patch(code,'        status: "PENDING_REVIEW",\n        totalAmount: quote.totalAmount,','        status: "PENDING_REVIEW",\n        totalAmount: quote.totalAmount,\n        originalTotalAmount: quote.originalTotalAmount,\n        promotion: quote.promotion,');
fs.writeFileSync(path.join(output,'Code.gs'),code,{mode:0o600});
for(const name of ['AdminApi.gs','PromotionalPricing.gs'])fs.copyFileSync(path.join(__dirname,'../backend',name),path.join(output,name));
console.log('Prepared promotion module, owner API and narrow pricing/quote-consent hooks.');
