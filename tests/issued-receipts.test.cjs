const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const details = () => ({name:'SYNTHETIC CUSTOMER',phone:'0191234567',property:'Synthetic stay',checkin:'2027-01-01',checkout:'2027-01-03',paymentDate:'2026-11-16',method:'Bank transfer',reference:'TEST ONLY',amounts:{rental:'1800',extras:'100',discount:'200',depositPaid:'500',otherPaid:'1200',paymentRefund:'0',securityPaid:'300',securityRefund:'100'}});
function harness() {
  const state = {rows:[],sheet:false,locked:false,allow:true,failBefore:false,failAfter:false,props:new Map()};
  const sheet = {
    getLastRow:()=>state.rows.length,setFrozenRows(){},getDataRange:()=>({getValues:()=>structuredClone(state.rows)}),
    getRange:(row,col,height,width)=>({setNumberFormat(){return this;},setValues(values){
      assert.equal(state.locked,true); if(row>1&&state.failBefore){state.failBefore=false;throw Error('lost before write');}
      state.rows[row-1]=structuredClone(values[0]); if(row>1&&state.failAfter){state.failAfter=false;throw Error('response lost after write');} return this;
    },getValues:()=>[structuredClone(state.rows[row-1])]}),
  };
  const ss = {getSheetByName:()=>state.sheet?sheet:null,insertSheet:()=>{state.sheet=true;return sheet;}};
  const c=vm.createContext({Date,console,Set,SpreadsheetApp:{flush(){}},Utilities:{formatDate:()=> '2026'},PropertiesService:{getScriptProperties:()=>({getProperty:k=>state.props.get(k)||null,setProperty:(k,v)=>state.props.set(k,v)})},prOwner_:()=>{if(!state.allow)throw Error('Owner denied');return {ss,email:'owner@example.invalid'};},msLocked_:fn=>{if(state.locked)throw Error('Busy');state.locked=true;try{return fn();}finally{state.locked=false;}}});
  for(const file of ['assets/admin/receipt-model.js','backend/IssuedReceipts.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c);
  const issue=(d=details(),requestId=crypto.randomUUID())=>c.rrIssue_({details:d,requestId,confirmed:true});
  return {c,state,issue};
}
test('integer-sen calculations separate discounts, booking deposit, security and refunds',()=>{
  const h=harness(),r=h.issue().receipt;
  assert.deepEqual(JSON.parse(JSON.stringify(r.totals)),{charges:170000,stayPaid:170000,balanceDue:0,creditDue:0,securityHeld:20000,grossReceived:200000,totalRefund:10000,netReceived:190000});
  const d=details();Object.assign(d.amounts,{rental:'0.30',extras:'0.00',discount:'0.10',depositPaid:'0.10',otherPaid:'0.10',securityPaid:'0',securityRefund:'0'});
  assert.equal(h.issue(d).receipt.totals.balanceDue,0);
});
test('sequential numbers and immutable receipt snapshots survive a fresh request',()=>{
  const h=harness(),d=details(),one=h.issue(d).receipt;d.name='Changed draft';
  const two=h.issue().receipt;assert.equal(one.number,'ILR-2026-000001');assert.equal(two.number,'ILR-2026-000002');
  assert.equal(h.c.rrGet_({number:one.number}).receipt.details.name,'SYNTHETIC CUSTOMER');assert.equal(h.c.rrList_({query:one.number}).matching,1);
});
test('repeated and uncertain saves recover the original number without a second row',()=>{
  const h=harness(),id=crypto.randomUUID();h.state.failAfter=true;
  assert.throws(()=>h.issue(details(),id),/response lost/);const retry=h.issue(details(),id);
  assert.equal(retry.duplicate,true);assert.equal(retry.receipt.number,'ILR-2026-000001');assert.equal(h.state.rows.length,2);
  assert.equal(h.issue(details(),id).receipt.number,retry.receipt.number);
  const different=details();different.amounts.rental='1900';assert.throws(()=>h.issue(different,id),/different details/);
});
test('reserved numbers are not reused after a failed write or deleted row',()=>{
  const h=harness();h.state.failBefore=true;assert.throws(()=>h.issue(),/lost before/);
  assert.equal(h.issue().receipt.number,'ILR-2026-000002');h.state.rows.pop();assert.equal(h.issue().receipt.number,'ILR-2026-000003');
});
test('invalid dates, excess refunds, invalid amounts and zero payments cannot consume a number',()=>{
  const h=harness();for(const mutate of [d=>d.checkin='2027-02-30',d=>d.checkout=d.checkin,d=>d.amounts.discount='9999',d=>d.amounts.paymentRefund='9999',d=>d.amounts.securityRefund='9999',d=>d.amounts.rental='1.234',d=>d.amounts.rental='-10',d=>d.phone='abc',d=>Object.assign(d.amounts,{depositPaid:'0',otherPaid:'0',securityPaid:'0',securityRefund:'0'})]){const d=details();mutate(d);assert.throws(()=>h.issue(d));}
  assert.equal(h.state.rows.length,0);assert.equal(h.state.props.size,0);
});
test('owner checks and script lock protect all receipt reads and writes',()=>{
  const h=harness();h.state.allow=false;assert.throws(()=>h.issue(),/Owner denied/);assert.throws(()=>h.c.rrList_({}),/Owner denied/);assert.throws(()=>h.c.rrGet_({number:'ILR-2026-000001'}),/Owner denied/);h.state.allow=true;h.state.locked=true;assert.throws(()=>h.issue(),/Busy/);assert.equal(h.state.rows.length,0);
});
test('customer text is contained in JSON, never interpreted as a sheet formula',()=>{
  const h=harness(),d=details();d.name='=IMPORTXML("https://example.invalid", "x")';d.notes='<script>test</script>';h.issue(d);
  const row=h.state.rows[1];assert.ok(row.every(value=>!String(value).startsWith('=')));assert.equal(JSON.parse(row[4]).details.name,d.name);
});
test('promotion is opt-in and reprinting retains its original text',()=>{
  const h=harness(),d=details();d.promotionText='Unapproved draft';assert.equal(h.issue(d).receipt.details.promotionText,'');d.includePromotion=true;d.promotionTitle='Come back';d.promotionText='Synthetic offer';const r=h.issue(d).receipt;assert.equal(h.c.rrGet_({number:r.number}).receipt.details.promotionText,'Synthetic offer');
});
test('corrupt or duplicate stored numbers stop further issuance',()=>{
  const h=harness();h.issue();h.state.rows.push(structuredClone(h.state.rows[1]));assert.throws(()=>h.issue(),/Duplicate or invalid/);assert.equal(h.state.props.get('RECEIPT_LAST_2026'),'1');
});
test('history search caps output and empty reads do not create a receipt register',()=>{
  const h=harness();assert.equal(h.c.rrList_({}).total,0);assert.equal(h.state.sheet,false);for(let i=0;i<105;i++)h.issue();const list=h.c.rrList_({});assert.equal(list.total,105);assert.equal(list.receipts.length,100);assert.equal(list.receipts[0].number,'ILR-2026-000105');
});
