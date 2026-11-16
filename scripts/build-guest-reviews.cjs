// Patch a verified version-10 snapshot. Never put private project files in this repository.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [source,output]=process.argv.slice(2);if(!source||!output||path.resolve(source)===path.resolve(output))throw Error('Use separate source and output directories');
const expected={'AdminApi.gs':'fa3d2d687ed771a3e5fc1cea31bd7c575afd125d15134f2d2c8f641c5ef63dc2','ManageStay.gs':'7a309b3bb8afe67a41fb1cab7ba12de32d271ba5f114320dedfce67e2059d032'};
for(const[file,hash]of Object.entries(expected))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex')!==hash)throw Error(file+' changed; review current source before patching');
fs.cpSync(source,output,{recursive:true});
for(const file of ['AdminApi.gs','GuestReviews.gs'])fs.copyFileSync(path.join(__dirname,'../backend',file),path.join(output,file));
const file=path.join(output,'ManageStay.gs'),text=fs.readFileSync(file,'utf8'),anchor="  if (String(input.action||'').startsWith('admin.')) return adminDoPost_(input);";
if(text.split(anchor).length!==2)throw Error('Router anchor missing or duplicated');
fs.writeFileSync(file,""+text.replace(anchor,"  if (String(input.action||'').startsWith('reviews.')) return guestReviewsDoPost_(input);\n"+anchor));
console.log('Prepared guest reviews with verified existing source; existing modules preserved.');
