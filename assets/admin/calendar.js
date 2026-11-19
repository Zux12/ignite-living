"use strict";
window.createCalendarWorkspace = ({ rpc, canStart, setWorking, onSaved = () => {} }) => {
  const $ = id => document.getElementById(id), root = $("calendarWorkspace");
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const money = v => "RM " + Number(v).toLocaleString("en-MY", { minimumFractionDigits:2, maximumFractionDigits:2 });
  const day = d => d.toISOString().slice(0,10), add = (s,n) => day(new Date(Date.parse(s + "T00:00:00Z") + n * 86400000));
  const dateLabel = s => new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(s + "T00:00:00Z"));
  let epoch=0, working=false, data=null, quote=null, retry=null, cancellation=null, editing=null, month="", propertyId="";
  root.innerHTML = `<div class="calendar-heading"><div><p class="eyebrow">MAKE ROOM FOR YOUR NEXT GUEST</p><h2>Calendar &amp; manual booking</h2><p class="muted">Add phone, WhatsApp or walk-in reservations directly.</p></div><button id="calendarReload" type="button">Refresh calendar</button></div>
  <p id="calendarMessage" class="message" role="status" aria-live="polite"></p>
  <div class="calendar-layout"><div class="calendar-panel"><label for="calendarProperty">Property</label><select id="calendarProperty"></select>
  <div class="calendar-toolbar"><button id="calendarPrevious" type="button" aria-label="Previous month">←</button><h3 id="calendarMonth"></h3><button id="calendarNext" type="button" aria-label="Next month">→</button><button id="calendarToday" type="button">Today</button></div>
  <div class="calendar-legend"><span>○ Available</span><span class="calendar-booked-key">● Reserved</span><span>▧ Blocked</span><span class="calendar-pending-key">◐ Pending request</span></div>
  <p class="muted" id="calendarHint">Choose a check-in day, then a check-out day. Reserved stays include the check-out day. Check-in and check-out are labelled on each stay.</p>
  <div class="calendar-grid" id="calendarGrid" aria-label="Stay calendar" aria-describedby="calendarHint"></div>
  <h3>Stays this month</h3><div id="calendarStays"></div><div id="calendarCancel" hidden></div></div>
  <div class="calendar-form-panel"><h3 id="manualHeading">New manual booking</h3><button id="manualCloseEdit" type="button" hidden>Close edit</button><p id="manualEditInfo" class="muted" hidden></p><details id="manualHistory" hidden><summary>Existing booking notes</summary><p id="manualHistoryText"></p></details><form id="manualBookingForm"><div class="calendar-fields">
  <div><label for="manualName">Guest name</label><input id="manualName" name="customerName" maxlength="100" required autocomplete="off"></div>
  <div><label for="manualPhone">Handphone</label><input id="manualPhone" name="customerPhone" type="tel" maxlength="30" required autocomplete="off"></div>
  <div class="calendar-wide"><label for="manualEmail">Email (optional)</label><input id="manualEmail" name="customerEmail" type="email" maxlength="150" autocomplete="off"></div>
  <div><label for="manualCheckin">Check-in</label><input id="manualCheckin" name="checkin" type="date" required></div>
  <div><label for="manualCheckout">Check-out</label><input id="manualCheckout" name="checkout" type="date" required></div>
  <div><label for="manualOccupants">Guests</label><input id="manualOccupants" name="occupants" type="number" min="1" step="1" value="1" required></div>
  <div class="calendar-wide"><label id="manualNotesLabel" for="manualNotes">Notes (optional)</label><input id="manualNotes" name="notes" maxlength="500" autocomplete="off"></div></div>
  <p id="manualPriceHint" class="muted">Uses the current stay prices, including eligible promotions. Payments and receipts are recorded separately.</p>
  <button id="manualReview" type="submit">Check dates &amp; review price</button>
  <div id="manualQuote" class="calendar-quote" hidden></div>
  <label id="manualConfirmLabel" class="calendar-confirm" hidden><input id="manualConfirmed" type="checkbox"><span id="manualConfirmText">I confirm the guest, dates and price. Reserve these dates now.</span></label>
  <div class="actions"><button id="manualSave" class="primary" type="button" hidden>Save confirmed booking</button><button id="manualEdit" type="button" hidden>Edit details</button></div>
  <p id="manualMessage" role="status" aria-live="polite"></p></form></div></div>`;
  const fields=[...$("manualBookingForm").querySelectorAll("input")];
  function message(s) { $("calendarMessage").textContent=s; }
  function controls() {
    root.querySelectorAll("button,select,input").forEach(n=>n.disabled=working);
    if (!data || !data.properties.length) root.querySelectorAll("button,select,input").forEach(n=>{if(n.id!=="calendarReload")n.disabled=true;});
    if (retry) { root.querySelectorAll("button,select,input").forEach(n=>n.disabled=true); $("manualSave").disabled=working; }
    $("manualSave").disabled=working || !quote || !$("manualConfirmed").checked;
    $("manualSave").textContent=retry?(editing?"Retry same amendment":"Retry same booking"):(editing?"Save changes":"Save confirmed booking");
    if(editing)$("calendarProperty").disabled=true;
    root.querySelectorAll(".calendar-day").forEach(n=>{if(n.dataset.date < (data?.today || ""))n.disabled=true;});
    if (quote) fields.filter(n=>n.id!=="manualConfirmed").forEach(n=>n.disabled=true);
  }
  function invalidate() { quote=null; $("manualQuote").hidden=true; $("manualQuote").replaceChildren(); $("manualConfirmed").checked=false; $("manualConfirmLabel").hidden=true; $("manualSave").hidden=true; $("manualEdit").hidden=true; $("manualReview").hidden=false; $("manualMessage").textContent=""; controls(); }
  async function run(work, fail) {
    if (working || !canStart()) return;
    const e=epoch; working=true; setWorking(true); controls();
    try { await work(()=>e===epoch); }
    catch(error) { if(e===epoch) (fail || (err=>message(err.message)))(error); }
    finally { if(e===epoch) { working=false; setWorking(false); controls(); } }
  }
  function payload() { return Object.fromEntries([["propertyId",propertyId],...(editing?[["bookingId",editing.bookingId],["snapshot",editing.snapshot]]:[]),...fields.filter(n=>n.name).map(n=>[n.name,n.type==="number"?Number(n.value):n.value.trim()])]); }
  function rangeContains(r,s,inclusive=true) { return r.checkin<=s && (inclusive?r.checkout>=s:r.checkout>s); }
  function unavailable(ci,co) { return data.bookings.some(b=>b.bookingId!==editing?.bookingId && b.status!=="PENDING_REVIEW" && ci<=b.checkout && co>=b.checkin) || data.blocked.some(b=>ci<b.checkout&&co>=b.checkin); }
  function render() {
    const grid=$("calendarGrid"); grid.replaceChildren();
    $("calendarMonth").textContent=new Intl.DateTimeFormat("en-GB",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(month+"-01T00:00:00Z"));
    ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach(s=>grid.append(node("span",s,"calendar-weekday")));
    const first=month+"-01", offset=(new Date(first+"T00:00:00Z").getUTCDay()+6)%7;
    for(let i=0;i<offset;i++)grid.append(node("span"));
    const ci=$("manualCheckin").value,co=$("manualCheckout").value;
    for(let s=first;s.slice(0,7)===month;s=add(s,1)) {
      const reserved=data.bookings.filter(b=>b.status!=="PENDING_REVIEW"&&rangeContains(b,s)), blocked=data.blocked.some(b=>rangeContains(b,s,false)), pending=data.bookings.some(b=>b.status==="PENDING_REVIEW"&&rangeContains(b,s));
      const status=reserved.length?"Reserved":blocked?"Blocked":pending?"Pending request":"Available";
      const b=node("button",undefined,"calendar-day"+(reserved.length?" reserved":blocked?" blocked":pending?" pending":"")+(s===data.today?" today":""));
      b.type="button";b.dataset.date=s;b.setAttribute("aria-label",dateLabel(s)+", "+status);b.setAttribute("aria-pressed",String(s===ci||s===co||(ci&&co&&s>ci&&s<co)));
      b.append(node("strong",Number(s.slice(8))),node("span",status));
      const labels=[];if(reserved.some(r=>r.checkin===s))labels.push("Check-in");if(reserved.some(r=>r.checkout===s))labels.push("Check-out");
      if(!labels.length){if(s===ci)labels.push("Check-in");else if(s===co)labels.push("Check-out");}
      for(const label of labels)b.append(node("small",label));b.setAttribute("aria-label",dateLabel(s)+", "+[status,...labels].join(", "));
      b.disabled=working||!!retry||s<data.today;
      b.onclick=()=>{
        if(working||retry||!canStart())return;
        invalidate();
        if(ci&&!co&&s>ci){if(unavailable(ci,s)){message("These dates are unavailable, including the check-out day. Choose a different stay.");return;}$("manualCheckout").value=s;}
        else{if(unavailable(s,s)){message("This day is unavailable. Choose an available check-in day.");return;}$("manualCheckin").value=s;$("manualCheckout").value="";}
        syncDates();render();message($("manualCheckout").value?"Dates selected. Enter the guest details and review the price.":"Check-in selected. Choose your check-out day.");
      };grid.append(b);
    }
    const list=$("calendarStays");list.replaceChildren();
    if(!data.bookings.length&&!data.blocked.length)list.append(node("p","No stays or blocked nights this month.","muted"));
    for(const b of data.bookings.slice().sort((a,b)=>a.checkin.localeCompare(b.checkin))) {
      const row=node("div",undefined,"calendar-stay"), info=node("div");
      info.append(node("strong",b.customerName),node("p",dateLabel(b.checkin)+" → "+dateLabel(b.checkout)+" · "+b.occupants+" guests"),node("small",(b.manual?"Manual · ":"")+b.status.replaceAll("_"," ")+" · "+money(b.totalAmount)),node("small",b.bookingId));row.append(info);
      if(b.status==="CONFIRMED"&&b.checkin>=data.today){const edit=node("button","Edit booking");edit.type="button";edit.onclick=()=>openEdit(b);row.append(edit);}
      if(b.manual&&b.status==="CONFIRMED"&&b.amountPaid===0&&b.checkin>=data.today){const cancel=node("button","Cancel booking");cancel.type="button";cancel.onclick=()=>openCancel(b);row.append(cancel);}list.append(row);
    }
    for(const b of data.blocked)list.append(node("p","Blocked: "+dateLabel(b.checkin)+" → "+dateLabel(b.checkout),"calendar-stay"));
  }
  function syncDates() { $("manualCheckin").min=data?.today||"";$("manualCheckout").min=$("manualCheckin").value?add($("manualCheckin").value,1):data?.today||""; }
  async function fetchMonth(active) {
    const result=await rpc("mbList",{month,propertyId}); if(!active())return;
    if(!Array.isArray(result.properties)||!Array.isArray(result.bookings)||!Array.isArray(result.blocked))throw Error("Calendar data is incomplete. Refresh to retry.");
    data=result;month=result.month;propertyId=result.propertyId;
    const select=$("calendarProperty");select.replaceChildren();for(const p of data.properties){const option=node("option",p.propertyName);option.value=p.propertyId;select.append(option);}select.value=propertyId;
    $("manualOccupants").max=String(data.properties.find(p=>p.propertyId===propertyId)?.maxOccupants||1);syncDates();render();
    if(!data.properties.length)message("No properties are open for bookings yet.");
  }
  function activate() { return run(async active=>{message("Loading calendar…");await fetchMonth(active);if(active())message("Calendar updated. Reserved dates, including check-out days, are unavailable on the website.");},e=>{data=null;$("calendarGrid").replaceChildren();$("calendarStays").replaceChildren();message(e.message+" Refresh the calendar to retry.");}); }
  $("calendarReload").onclick=activate;
  function changeMonth(n){if(working||retry||!canStart())return;const d=new Date(month+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+n);month=day(d).slice(0,7);activate();}
  $("calendarPrevious").onclick=()=>changeMonth(-1);$("calendarNext").onclick=()=>changeMonth(1);
  $("calendarToday").onclick=()=>{if(!working&&!retry){month=data.today.slice(0,7);activate();}};
  $("calendarProperty").onchange=()=>{propertyId=$("calendarProperty").value;invalidate();activate();};
  $("manualBookingForm").oninput=e=>{if(e.target.id==="manualConfirmed"){controls();return;}if(!retry){invalidate();syncDates();if(data)render();}};
  $("manualBookingForm").onsubmit=e=>{e.preventDefault();if(!$("manualBookingForm").reportValidity()||retry)return;run(async active=>{
    $("manualMessage").textContent="Checking availability and price…";const input=payload(),raw=await rpc(editing?"mbPreviewEdit":"mbQuote",input),result=editing?{quote:raw}:raw;if(!active())return;
    quote={input,priceKey:result.quote.priceKey};const q=result.quote, box=$("manualQuote");box.replaceChildren(node("strong",q.nights+" night"+(q.nights===1?"":"s")+" · "+money(q.totalAmount)),node("p",input.customerName+" · "+input.customerPhone),node("p",dateLabel(q.checkin)+" → "+dateLabel(q.checkout)));
    if(editing){box.append(node("p","Agreed total: "+money(q.totalAmount)+" · unchanged"),node("p","Payments received: "+money(q.amountPaid)+" · Balance: "+money(q.balanceDue)));if(input.notes)box.append(node("p","Amendment note: "+input.notes));}
    if(q.promotion)box.append(node("p",q.promotion.title+" · Standard total "+money(q.originalTotalAmount)));
    if(!editing)box.append(node("p","Booking deposit due: "+money(q.bookingDeposit)),node("p","Balance after deposit payment: "+money(q.balanceAfterDeposit)),node("small","No payment recorded yet. Full outstanding balance: "+money(q.totalAmount)));
    box.hidden=false;$("manualConfirmLabel").hidden=false;$("manualSave").hidden=false;$("manualEdit").hidden=false;$("manualReview").hidden=true;$("manualMessage").textContent=editing?"Review the amendment, then confirm to save changes.":"Review these details, then confirm to reserve the dates.";
  },e=>{$("manualMessage").textContent=e.message;});};
  $("manualEdit").onclick=()=>{if(!working&&!retry)invalidate();};
  $("manualSave").onclick=async()=>{
    if(!quote||!$("manualConfirmed").checked)return;
    let saved=false;
    await run(async active=>{
      retry=retry||{...quote.input,priceKey:quote.priceKey,requestId:crypto.randomUUID(),confirmed:true};controls();
      $("manualMessage").textContent=editing?"Saving booking changes…":"Saving confirmed booking…";const result=await rpc(editing?"mbSaveEdit":"mbCreate",retry);if(!active())return;
      saved=true;retry=null;message(result.message);clearEdit();$("manualBookingForm").reset();invalidate();$("manualMessage").textContent=result.message+" Reference: "+result.bookingId;
      try { await fetchMonth(active); } catch (_) { if(active())message("Booking saved. Refresh the calendar to see the latest records."); }
    },e=>{if(e.code==="ADMIN_ACTION_FAILED"){retry=null;invalidate();$("manualMessage").textContent=e.message+" Review the details again.";}else $("manualMessage").textContent=e.message+" The save is unconfirmed. Use the retry button to safely check or finish it.";});
    if(saved)onSaved();
  };
  function clearEdit() {
    editing=null;$("manualCloseEdit").hidden=true;$("manualEditInfo").hidden=true;$("manualHistory").hidden=true;$("manualHistoryText").textContent="";
    $("manualHeading").textContent="New manual booking";$("manualNotesLabel").textContent="Notes (optional)";
    $("manualPriceHint").textContent="Uses the current stay prices, including eligible promotions. Payments and receipts are recorded separately.";
    $("manualConfirmText").textContent="I confirm the guest, dates and price. Reserve these dates now.";
    $("manualReview").textContent="Check dates & review price";
  }
  function openEdit(b) {
    if(retry)return;
    run(async active=>{
      message("Loading booking details…");const result=await rpc("mbOpenEdit",{bookingId:b.bookingId});if(!active())return;
      editing=result;$("manualBookingForm").reset();invalidate();$("calendarCancel").hidden=true;
      for(const n of fields)if(n.name)n.value=result[n.name]??"";
      $("manualHeading").textContent="Edit booking";$("manualCloseEdit").hidden=false;$("manualEditInfo").hidden=false;$("manualEditInfo").textContent=result.bookingId;
      $("manualHistory").hidden=!result.history;$("manualHistoryText").textContent=result.history;
      $("manualNotesLabel").textContent="Amendment note (optional)";
      $("manualPriceHint").textContent="The agreed price of "+money(result.totalAmount)+" stays unchanged when you amend these details. Payments and receipts are managed separately.";
      $("manualConfirmText").textContent="I confirm these changes. Keep the agreed price and save the amendment.";
      $("manualReview").textContent="Review changes";syncDates();render();message("Booking loaded. Amend the details and review your changes.");
      $("manualHeading").scrollIntoView?.({block:"start"});$("manualName").focus();
    });
  }
  $("manualCloseEdit").onclick=()=>{if(working||retry)return;clearEdit();$("manualBookingForm").reset();invalidate();syncDates();render();};
  function openCancel(b){
    if(working||retry||!canStart())return;cancellation=b;const box=$("calendarCancel");box.replaceChildren(node("h3","Cancel "+b.customerName+"’s booking?"),node("p",dateLabel(b.checkin)+" → "+dateLabel(b.checkout)+". This releases the nights."));
    const form=node("form"),label=node("label","Reason"),reason=node("input"),confirmLabel=node("label",undefined,"calendar-confirm"),check=node("input"),submit=node("button","Confirm cancellation"),close=node("button","Keep booking");
    label.htmlFor=reason.id="calendarCancelReason";reason.required=true;reason.maxLength=300;check.type="checkbox";check.required=true;check.id="calendarCancelConfirmed";confirmLabel.append(check,document.createTextNode("No money was collected for this booking. Cancel it."));submit.type="submit";close.type="button";close.onclick=()=>{box.hidden=true;cancellation=null;};form.append(label,reason,confirmLabel,submit,close);box.append(form);box.hidden=false;
    const status=node("p", "", "message");status.id="calendarCancelMessage";status.setAttribute("role","status");status.setAttribute("aria-live","polite");form.append(status);
    form.onsubmit=async e=>{
      e.preventDefault();if(!form.reportValidity())return;
      const input={bookingId:b.bookingId,reason:reason.value,confirmed:check.checked};let saved=false;
      await run(async active=>{
        status.textContent="Cancelling booking…";
        const result=await rpc("mbCancel",input);if(!active())return;
        saved=true;cancellation=null;message(result.message);
        box.replaceChildren(node("h3","Booking cancelled"),node("p",b.customerName+" · "+dateLabel(b.checkin)+" → "+dateLabel(b.checkout)),node("p","The nights have been released."));
        try{await fetchMonth(active);}catch(_){if(active())box.append(node("p","Cancellation saved. Refresh the calendar to see the latest availability."));}
      },error=>{status.textContent=error.message+(error.code==="ADMIN_ACTION_FAILED"?"":" Cancellation could not be confirmed. Retry to check or complete it.");});
      if(saved)onSaved();
    };
    box.scrollIntoView?.({block:"nearest"});reason.focus();
  }
  controls();
  return { activate, reset(){epoch++;working=false;data=null;quote=null;retry=null;cancellation=null;clearEdit();month="";propertyId="";$("manualBookingForm").reset();invalidate();for(const id of ["calendarGrid","calendarStays","calendarProperty","calendarCancel","calendarMonth"])$(id).replaceChildren();$("calendarCancel").hidden=true;message("");controls();} };
};
