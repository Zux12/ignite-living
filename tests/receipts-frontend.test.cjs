const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(t,handler){
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8'),{url:'https://living.igniteinnov.com/admin.html',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());
  const w=dom.window,d=w.document,calls=[];let prints=0;
  for(const file of ['receipt-model.js','receipts.js'])w.eval(fs.readFileSync(path.join(__dirname,'../assets/admin',file),'utf8'));
  w.print=()=>prints++;
  const ui=w.createReceiptWorkspace({canStart:()=>true,setWorking(){},rpc:async(method,input)=>{calls.push({method,input});if(handler)return handler(method,input,w);if(method==='rrList')return{receipts:[],total:0,matching:0};if(method==='rrIssue')return{receipt:{...w.IgniteReceipt.prepare(input.details),number:'ILR-2026-000001',requestId:input.requestId,savedAt:'2026-11-16T01:00:00Z'}};}});
  function fill(){for(const [k,v]of Object.entries({name:'<img src=x onerror=alert(1)>',phone:'0191234567',property:'Synthetic stay',checkin:'2027-01-01',checkout:'2027-01-03',paymentDate:'2026-11-16',method:'Bank transfer',rental:'1800',depositPaid:'500',otherPaid:'1300'}))d.getElementById('receipt-'+k).value=v;d.getElementById('receiptConfirmed').checked=true;}
  const submit=()=>d.getElementById('receiptForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return{w,d,calls,ui,fill,submit,get prints(){return prints;}};
}
test('draft previews do not issue numbers and customer text is escaped',t=>{const h=setup(t);h.fill();h.d.getElementById('receiptPreviewButton').click();assert.match(h.d.getElementById('receiptPreview').textContent,/DRAFT/);assert.equal(h.d.querySelector('#receiptPreview img:not(.receipt-logo):not(.receipt-review-qr)'),null);assert.equal(h.calls.length,0);assert.equal(h.d.getElementById('receiptSavedActions').hidden,true);});
test('duplicate save clicks issue once and only a saved receipt can print',async t=>{let resolve;const h=setup(t,async(method,input,w)=>{if(method==='rrList')return{receipts:[],total:0,matching:0};return new Promise(r=>resolve=()=>r({receipt:{...w.IgniteReceipt.prepare(input.details),number:'ILR-2026-000001',savedAt:'2026-11-16T01:00:00Z'}}));});h.fill();h.submit();h.submit();assert.equal(h.calls.filter(c=>c.method==='rrIssue').length,1);h.d.getElementById('receiptPrintButton').click();assert.equal(h.prints,0);resolve();await tick();h.d.getElementById('receiptPrintButton').click();assert.equal(h.prints,1);assert.match(h.d.getElementById('receiptPrint').textContent,/ILR-2026-000001/);assert.equal(h.d.getElementById('receipt-name').disabled,true);});
test('lost response retries the same immutable request ID and payload',async t=>{let count=0;const h=setup(t,async(method,input,w)=>{if(method==='rrList')return{receipts:[],total:0,matching:0};if(!count++)throw Error('Network lost');return{receipt:{...w.IgniteReceipt.prepare(input.details),number:'ILR-2026-000007',savedAt:'2026-11-16T01:00:00Z'}};});h.fill();h.submit();await tick();assert.match(h.d.getElementById('receiptSave').textContent,/Retry same/);assert.equal(h.d.getElementById('receipt-name').disabled,true);h.submit();await tick();const issued=h.calls.filter(c=>c.method==='rrIssue');assert.equal(issued.length,2);assert.equal(issued[0].input.requestId,issued[1].input.requestId);assert.equal(JSON.stringify(issued[0].input.details),JSON.stringify(issued[1].input.details));assert.match(h.d.getElementById('receiptPreviewStatus').textContent,/000007/);});
test('sign-out resets private drafts, receipt history and printable data',async t=>{const h=setup(t);h.fill();h.submit();await tick();h.d.getElementById('receiptPrintButton').click();h.ui.reset();assert.equal(h.d.getElementById('receipt-name').value,'');assert.equal(h.d.getElementById('receiptPrint').textContent,'');assert.equal(h.d.getElementById('receiptsWorkspace').hidden,true);});
test('late save response cannot restore data after sign-out',async t=>{let resolve;const h=setup(t,async(method,input,w)=>new Promise(r=>resolve=()=>r({receipt:{...w.IgniteReceipt.prepare(input.details),number:'ILR-2026-000001',savedAt:'2026-11-16T01:00:00Z'}})));h.fill();h.submit();h.ui.reset();resolve();await tick();assert.equal(h.d.getElementById('receipt-name').value,'');assert.equal(h.d.getElementById('receiptSavedActions').hidden,true);});
test('confirmation required and no offer is invented for an empty promotion',async t=>{const h=setup(t);h.fill();h.d.getElementById('receiptConfirmed').checked=false;h.submit();assert.equal(h.calls.length,0);h.d.getElementById('receiptPreviewButton').click();assert.equal(h.d.querySelector('#receiptPreview .receipt-promotion'),null);});

test('print waits for both logo and review QR, and abandons a pending print on sign-out',async t=>{
  const h=setup(t),pending=[];h.w.HTMLImageElement.prototype.decode=()=>new Promise(r=>pending.push(r));
  h.fill();h.submit();await tick();h.d.getElementById('receiptPrintButton').click();assert.equal(h.prints,0);
  assert.equal(pending.length,2);pending.shift()();await tick();assert.equal(h.prints,0);pending.shift()();await tick();assert.equal(h.prints,1);
  h.d.getElementById('receiptPrintButton').click();h.ui.reset();pending.splice(0).forEach(resolve=>resolve());await tick();assert.equal(h.prints,1);
});
test('a failed logo load keeps the saved receipt and lets the owner retry printing',async t=>{const h=setup(t);h.w.HTMLImageElement.prototype.decode=()=>Promise.reject(Error('offline'));h.fill();h.submit();await tick();h.d.getElementById('receiptPrintButton').click();await tick();assert.equal(h.prints,0);assert.match(h.d.getElementById('receiptMessage').textContent,/logo or review QR code could not load/);assert.equal(h.d.getElementById('receiptPrintButton').disabled,false);assert.match(h.d.getElementById('receiptPreviewStatus').textContent,/ILR-2026-000001/);});

test('all ticked offers fit the saved snapshot and print without changing receipt totals',async t=>{
  const h=setup(t);h.fill();h.d.getElementById('receiptIncludePromotion').click();
  for(const suffix of [10,20,30,40,50,'FreeDay'])h.d.getElementById('receiptPromo'+suffix).click();
  const date=h.d.getElementById('receiptFreeDayDate');date.value='2027-01-01';date.dispatchEvent(new h.w.Event('input',{bubbles:true}));
  assert.equal(date.required,true);assert.equal(date.disabled,false);
  h.submit();await tick();const issued=h.calls.find(c=>c.method==='rrIssue').input.details;
  assert.equal(issued.promotionText,'Return-stay discounts: 10%, 20%, 30%, 40%, 50%. 1 free day: 01 Jan 2027 only. Every 3 stays, get 1 free night. Valid for stays from 1 Jan 2027 (after Dec 2026).');
  assert.ok(issued.promotionText.length<=200);assert.equal(h.w.IgniteReceipt.prepare(issued).totals.charges,180000);
  h.d.getElementById('receiptPrintButton').click();assert.match(h.d.querySelector('#receiptPrint .receipt-promotion').textContent,/01 Jan 2027 only/);
  assert.equal(h.d.getElementById('receiptPromotionChoices').hidden,true);assert.equal(h.d.getElementById('receiptPromotionText').value,issued.promotionText);
});
test('free-day offer requires a real date after December 2026 before preview or issue',t=>{
  const h=setup(t);h.fill();h.d.getElementById('receiptIncludePromotion').click();h.d.getElementById('receiptPromoFreeDay').click();
  for(const value of ['', '2026-12-31', '2027-02-30']){
    h.d.getElementById('receiptFreeDayDate').value=value;h.d.getElementById('receiptPreviewButton').click();h.submit();
    assert.equal(h.calls.length,0);assert.equal(h.d.querySelector('#receiptPreview .receipt-paper'),null);
  }
  h.d.getElementById('receiptFreeDayDate').value='2028-02-29';h.d.getElementById('receiptPreviewButton').click();
  assert.match(h.d.querySelector('#receiptPreview .receipt-promotion').textContent,/29 Feb 2028 only/);
});
test('loyalty-only promotion, unticked offers and disabled free-day dates stay independent',t=>{
  const h=setup(t);h.fill();h.d.getElementById('receiptIncludePromotion').click();h.d.getElementById('receiptPreviewButton').click();
  let text=h.d.querySelector('#receiptPreview .receipt-promotion').textContent;assert.match(text,/Every 3 stays, get 1 free night/);assert.match(text,/from 1 Jan 2027/);assert.doesNotMatch(text,/discounts|1 free day/);
  h.d.getElementById('receiptPromo10').click();h.d.getElementById('receiptPromoFreeDay').click();h.d.getElementById('receiptPromoFreeDay').click();h.d.getElementById('receiptPreviewButton').click();
  text=h.d.querySelector('#receiptPreview .receipt-promotion').textContent;assert.match(text,/discounts: 10%\./);assert.doesNotMatch(text,/20%|1 free day/);assert.equal(h.d.getElementById('receiptFreeDayDate').required,false);
  h.d.getElementById('receiptPromoFreeDay').click();h.d.getElementById('receiptIncludePromotion').click();h.d.getElementById('receiptPreviewButton').click();
  assert.equal(h.d.querySelector('#receiptPreview .receipt-promotion'),null);assert.equal(h.d.getElementById('receiptFreeDayDate').disabled,true);
});
test('saved legacy promotions reopen unchanged and a new draft clears offer selections',async t=>{
  const h=setup(t,async(method,input,w)=>{
    if(method==='rrList')return{receipts:[{number:'ILR-2026-000001',name:'Synthetic guest',checkin:'2027-01-01',checkout:'2027-01-03',netReceived:180000}],total:1,matching:1};
    if(method==='rrGet')return{receipt:{...w.IgniteReceipt.prepare({name:'Synthetic guest',phone:'0191234567',property:'Synthetic stay',checkin:'2027-01-01',checkout:'2027-01-03',paymentDate:'2026-11-16',method:'Bank transfer',amounts:{rental:'1800',otherPaid:'1800'},includePromotion:true,promotionTitle:'Previous offer',promotionText:'Original saved terms.'}),number:input.number,savedAt:'2026-11-16T01:00:00Z'}};
  });
  h.d.getElementById('receiptIncludePromotion').click();h.d.getElementById('receiptPromo50').click();h.d.getElementById('showReceipts').click();await tick();h.d.querySelector('#receiptHistoryList button').click();await tick();
  assert.equal(h.d.getElementById('receiptPromotionText').value,'Original saved terms.');assert.doesNotMatch(h.d.querySelector('#receiptPreview .receipt-promotion').textContent,/2027|3 stays|50%/);
  h.d.getElementById('receiptNew').click();assert.equal(h.d.getElementById('receiptIncludePromotion').checked,false);assert.equal(h.d.getElementById('receiptPromo50').checked,false);assert.equal(h.d.getElementById('receiptFreeDayDate').value,'');assert.equal(h.d.getElementById('receiptFreeDayDate').disabled,true);assert.equal(h.d.getElementById('receiptPromotionText').value,'');
});


test('review links work in saved reprints without including private receipt data',async t=>{
  const h=setup(t);h.fill();h.submit();await tick();h.d.getElementById('receiptPrintButton').click();
  const url='https://living.igniteinnov.com/#leaveReviewHeading';
  for(const id of ['receiptPreview','receiptPrint']){
    const links=h.d.querySelectorAll('#'+id+' .receipt-review a');assert.equal(links.length,2);
    for(const link of links)assert.equal(link.href,url);
    assert.match(h.d.querySelector('#'+id+' .receipt-review').textContent,/name or anonymously/);
  }
  const svg=fs.readFileSync(path.join(__dirname,'../assets/brand/guest-review-qr-v1.svg'),'utf8');assert.ok(svg.includes(url));
  assert.match(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),/id="leaveReviewHeading"/);
});
test('RM1400 paid as RM300 deposit and RM1100 balance prints as fully settled',t=>{
  const h=setup(t);h.fill();for(const[k,v]of Object.entries({rental:'1400',depositPaid:'300',otherPaid:'1100'}))h.d.getElementById('receipt-'+k).value=v;
  h.d.getElementById('receiptPreviewButton').click();
  const rows=Object.fromEntries([...h.d.querySelectorAll('#receiptPreview tr')].map(row=>[row.querySelector('th').textContent,row.querySelector('td').textContent]));
  assert.equal(rows['Total stay charges'],'RM 1,400.00');assert.equal(rows['Booking deposit received'],'RM 300.00');assert.equal(rows['Balance payment received'],'RM 1,100.00');assert.equal(rows['Outstanding stay balance'],'RM 0.00');assert.equal(rows['NET AMOUNT RECEIVED'],'RM 1,400.00');
  h.ui.reset();for(const key of h.w.IgniteReceipt.amounts)assert.equal(h.d.getElementById('receipt-'+key).value,'0.00');
});
test('a failed review QR load prevents an incomplete print and can be retried',async t=>{
  const h=setup(t);h.w.HTMLImageElement.prototype.decode=function(){return this.classList.contains('receipt-review-qr')?Promise.reject(Error('offline')):Promise.resolve();};
  h.fill();h.submit();await tick();h.d.getElementById('receiptPrintButton').click();await tick();assert.equal(h.prints,0);assert.equal(h.d.getElementById('receiptPrintButton').disabled,false);
  h.w.HTMLImageElement.prototype.decode=()=>Promise.resolve();h.d.getElementById('receiptPrintButton').click();await tick();assert.equal(h.prints,1);
});
