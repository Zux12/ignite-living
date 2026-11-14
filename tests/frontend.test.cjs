process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const profile = { customerId: 'synthetic-customer', customerName: 'Synthetic Guest', phone: '+60123456789', email: 'guest@example.invalid' };
const quote = { ok: true, available: true, propertyName: 'Mayang Sari Beach Cottage', nights: 1, totalAmount: 1200, bookingDeposit: 500, balanceAfterDeposit: 700 };

async function setup(t, responder, now = '2026-11-14T16:30:00Z', configure = () => {}) {
  const requests = [];
  const dom = new JSDOM(html, {
    url: 'https://ignite-living.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    // No external resources are loaded. Every fetch is intercepted in memory.
    beforeParse(w) {
      const RealDate = w.Date;
      w.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return new RealDate(now).getTime(); }
      };
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.fetch = async (url, options = {}) => {
        const input = options.body ? JSON.parse(options.body) : Object.fromEntries(new URL(url).searchParams);
        requests.push(input);
        const value = responder ? await responder(input, options, w) : input.action === 'status' ? { ok: true, bookingEnabled: true } : quote;
        return { ok: true, json: async () => value };
      };
      configure(w);
    }
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  return { w: dom.window, d: dom.window.document, requests };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function select(d, checkin = '2026-12-01', checkout = '2026-12-02') {
  d.getElementById('modalCheckin').value = checkin;
  d.getElementById('modalCheckout').value = checkout;
}
async function signIn(w, d) {
  w.manageStay();
  d.getElementById('stayIdentifier').value = 'guest@example.invalid';
  d.getElementById('stayPassword').value = 'synthetic-password-only';
  d.getElementById('stayLoginForm').requestSubmit();
  await tick();
}
function accountResponse(input) {
  if (input.action === 'stay.login') return { ok: true, token: 'synthetic-token', mustChangePassword: false };
  if (input.action === 'stay.list') return { ok: true, profile, bookings: [], requests: [], bank: {} };
  if (input.action === 'stay.logout') return { ok: true };
  if (input.action === 'status') return { ok: true, bookingEnabled: true };
  return quote;
}

const syntheticBooking = {
  bookingId: 'SYNTHETIC-BOOKING', propertyName: 'Synthetic Test Home',
  bookingStatus: 'CONFIRMED', paymentStatus: 'UNPAID', checkin: '2027-01-01', checkout: '2027-01-03',
  occupants: 2, rentalAmount: 1800, cleaningFee: 0, changeFees: 0, totalAmount: 1800,
  bookingDeposit: 500, amountPaid: 0, balanceDue: 1800, proofs: []
};
async function uploadSetup(t, responder, configure) {
  const h = await setup(t, (input, options, w) => {
    const overridden = responder?.(input, options, w);
    if (overridden !== undefined) return overridden;
    if (input.action === 'stay.list') return { ok: true, profile, bookings: [syntheticBooking], requests: [], bank: {} };
    return accountResponse(input);
  }, undefined, w => {
    // FileReader is controlled locally; this harness never uploads files or calls Google.
    w.FileReader = class {
      readAsDataURL() { this.result = 'data:application/pdf;base64,JVBERi0xLjQK'; queueMicrotask(() => this.onload?.()); }
    };
    configure?.(w);
  });
  await signIn(h.w, h.d);
  h.form = h.d.querySelector('#stayBookings form');
  h.form.elements.amount.value = '500';
  h.form.elements.paymentDate.value = '2026-11-14';
  h.file = h.form.elements.receipt;
  Object.defineProperty(h.file, 'files', { configurable: true, value: [{ name: 'synthetic.pdf', size: 9 }] });
  // Synthetic file lists cannot satisfy native file-input validation in jsdom.
  h.submit = () => h.form.dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  return h;
}

test('rapid duplicate receipt clicks send one upload and keep unavailable payment methods disabled', async t => {
  let release;
  const h = await uploadSetup(t, input => input.action === 'stay.upload' ? new Promise(resolve => { release = resolve; }) : undefined);
  h.submit(); h.submit(); await tick();
  assert.equal(h.requests.filter(r => r.action === 'stay.upload').length, 1);
  assert.equal(h.d.getElementById('stayClose').disabled, true);
  release({ ok: true, proofId: 'SYNTHETIC-PROOF', message: 'Payment proof received.' }); await tick();
  assert.equal(h.d.getElementById('stayClose').disabled, false);
  assert.ok([...h.d.querySelectorAll('.stay-methods button')].every(b => b.disabled));
});

test('lost upload response preserves retry identity and tells the guest to refresh bookings', async t => {
  let first = true;
  const h = await uploadSetup(t, input => {
    if (input.action !== 'stay.upload') return;
    if (first) { first = false; throw new TypeError('Failed to fetch'); }
    return { ok: true, proofId: 'SYNTHETIC-PROOF', message: 'This payment proof is already on file.' };
  });
  h.submit(); await tick();
  assert.match(h.d.getElementById('stayMessage').textContent, /could not confirm.*saved.*refresh bookings/i);
  assert.equal(h.d.getElementById('stayRefresh').disabled, false);
  h.submit(); await tick();
  const uploads = h.requests.filter(r => r.action === 'stay.upload');
  assert.equal(uploads.length, 2); assert.equal(uploads[0].uploadId, uploads[1].uploadId);
  assert.match(h.d.getElementById('stayMessage').textContent, /already on file.*SYNTHETIC-PROOF/);
});

test('upload timeout releases controls and gives recovery guidance without an automatic retry', async t => {
  const h = await uploadSetup(t, (input, options, w) => input.action === 'stay.upload' ? new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new w.DOMException('Synthetic timeout', 'AbortError')), { once: true });
  }) : undefined, w => {
    const timeout = w.setTimeout.bind(w);
    w.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 180000 ? 5 : ms, ...args);
  });
  h.submit(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.requests.filter(r => r.action === 'stay.upload').length, 1);
  assert.equal(h.d.getElementById('stayClose').disabled, false);
  assert.match(h.d.getElementById('stayMessage').textContent, /refresh (your )?bookings/i);
});

test('aborted file reading releases the form without sending any receipt', async t => {
  const h = await uploadSetup(t, undefined, w => {
    w.FileReader = class { readAsDataURL() { queueMicrotask(() => this.onabort?.()); } };
  });
  h.submit(); await tick();
  assert.equal(h.requests.filter(r => r.action === 'stay.upload').length, 0);
  assert.equal(h.d.getElementById('stayClose').disabled, false);
  assert.match(h.d.getElementById('stayMessage').textContent, /cancelled.*choose.*again/i);
});

test('unreadable, oversized and unsupported receipts do not reach the API', async t => {
  for (const scenario of ['read error', 'size', 'type']) {
    const h = await uploadSetup(t, undefined, w => {
      if (scenario === 'read error') w.FileReader = class { readAsDataURL() { queueMicrotask(() => this.onerror?.()); } };
    });
    if (scenario !== 'read error') Object.defineProperty(h.file, 'files', { value: [{ name: scenario === 'type' ? 'synthetic.heic' : 'synthetic.pdf', size: scenario === 'size' ? 5 * 1024 * 1024 + 1 : 9 }] });
    h.submit(); await tick();
    assert.equal(h.requests.filter(r => r.action === 'stay.upload').length, 0, scenario);
    assert.equal(h.d.getElementById('stayClose').disabled, false, scenario);
    assert.match(h.d.getElementById('stayMessage').textContent, /Unable to read|5 MB|JPG, PNG or PDF/);
  }
});

test('confirmed proof reference survives a failed follow-up booking refresh', async t => {
  let uploaded = false;
  const h = await uploadSetup(t, input => {
    if (input.action === 'stay.upload') { uploaded = true; return { ok: true, proofId: 'SYNTHETIC-PROOF', message: 'Payment proof received.' }; }
    if (input.action === 'stay.list' && uploaded) throw new TypeError('Failed to fetch');
  });
  h.submit(); await tick();
  assert.match(h.d.getElementById('stayMessage').textContent, /Payment proof received.*SYNTHETIC-PROOF.*could not refresh/i);
  assert.equal(h.d.getElementById('stayRefresh').disabled, false);
});

test('expired session during upload clears guest data and the selected file', async t => {
  const h = await uploadSetup(t, input => input.action === 'stay.upload' ? { ok: false, code: 'AUTH_REQUIRED', message: 'Please sign in again.' } : undefined);
  h.submit(); await tick();
  assert.equal(h.w.stayBookingToken(), '');
  assert.equal(h.d.getElementById('guestEmail').value, '');
  assert.equal(h.d.querySelector('#stayBookings input[type=file]'), null);
  assert.equal(h.d.getElementById('stayMessage').textContent, 'Please sign in again.');
});

test('server refusal is shown without claiming an upload succeeded', async t => {
  const h = await uploadSetup(t, input => input.action === 'stay.upload' ? { ok: false, message: 'This booking is not accepting payment proof.' } : undefined);
  h.submit(); await tick();
  assert.match(h.d.getElementById('stayMessage').textContent, /^This booking is not accepting payment proof\./);
  assert.equal(h.d.getElementById('stayClose').disabled, false);
});

test('HTTP failures, malformed JSON and missing acknowledgements remain uncertain uploads', async t => {
  for (const failure of ['http', 'json', 'missing']) {
    const h = await uploadSetup(t, undefined, w => {
      const fetch = w.fetch;
      w.fetch = (url, options = {}) => {
        if (options.body && JSON.parse(options.body).action === 'stay.upload') {
          if (failure === 'http') return Promise.resolve({ ok: false });
          return Promise.resolve({ ok: true, json: async () => { if (failure === 'json') throw new w.SyntaxError('Synthetic malformed response'); return { ok: true }; } });
        }
        return fetch(url, options);
      };
    });
    h.submit(); await tick();
    assert.match(h.d.getElementById('stayMessage').textContent, /could not confirm.*saved.*Refresh bookings/, failure);
    assert.equal(h.d.getElementById('stayClose').disabled, false, failure);
  }
});

test('session expiry after a confirmed upload clears private details but retains its acknowledgement', async t => {
  let uploaded = false;
  const h = await uploadSetup(t, input => {
    if (input.action === 'stay.upload') { uploaded = true; return { ok: true, proofId: 'SYNTHETIC-PROOF', message: 'Payment proof received.' }; }
    if (input.action === 'stay.list' && uploaded) return { ok: false, code: 'AUTH_REQUIRED', message: 'Please sign in again.' };
  });
  h.submit(); await tick();
  assert.equal(h.w.stayBookingToken(), '');
  assert.equal(h.d.querySelector('#stayBookings input[type=file]'), null);
  assert.match(h.d.getElementById('stayMessage').textContent, /SYNTHETIC-PROOF.*Sign in again/);
});

test('generic backend storage failure also requires checking for an existing proof', async t => {
  const h = await uploadSetup(t, input => input.action === 'stay.upload' ? { ok: false, code: '', message: 'Unable to complete this action. Please contact Ignite Living.' } : undefined);
  h.submit(); await tick();
  assert.match(h.d.getElementById('stayMessage').textContent, /contact Ignite Living.*Refresh bookings.*existing proof/);
  assert.equal(h.d.getElementById('stayClose').disabled, false);
});

test('booking retry identity survives page reload and is bound to customer and selection', async t => {
  const first=await setup(t), data={propertyId:'IL001',checkin:'2026-12-01',checkout:'2026-12-02',occupants:2,agreementVersion:'2.0'};
  const id=first.w.bookingRequestId(profile,data);
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.w.bookingRequestId(profile,data),id);
  const stored=first.w.sessionStorage.getItem('ignite.bookingRequest');
  assert.ok(!stored.includes(profile.email));assert.ok(!stored.includes(profile.phone));
  const reloaded=await setup(t);reloaded.w.sessionStorage.setItem('ignite.bookingRequest',stored);
  assert.equal(reloaded.w.bookingRequestId(profile,data),id);
  assert.notEqual(reloaded.w.bookingRequestId(profile,{...data,occupants:3}),id);
  assert.notEqual(first.w.bookingRequestId({...profile,customerId:'other-synthetic-customer'},data),id);
});

test('booking retry identity can be cleared and works without browser storage', async t => {
  const {w}=await setup(t), data={propertyId:'IL001',checkin:'2026-12-01',checkout:'2026-12-02',occupants:2,agreementVersion:'2.0'};
  const before=w.bookingRequestId(profile,data);w.clearBookingRequestIdentity();
  assert.equal(w.sessionStorage.getItem('ignite.bookingRequest'),null);
  assert.notEqual(w.bookingRequestId(profile,data),before);
  w.clearBookingRequestIdentity();Object.defineProperty(w,'sessionStorage',{get(){throw new Error('Storage disabled');}});
  const id=w.bookingRequestId(profile,data);assert.equal(w.bookingRequestId(profile,data),id);
});

test('date minimum follows Malaysia after midnight, independent of browser timezone', async t => {
  const { d } = await setup(t);
  assert.equal(d.getElementById('searchCheckin').min, '2026-11-15');
  assert.equal(d.getElementById('modalCheckin').min, '2026-11-15');
  assert.equal(d.getElementById('searchCheckout').min, '2026-11-16');
});
test('search rejects past and incomplete date ranges without replacing the selection', async t => {
  const { w, d } = await setup(t);
  d.getElementById('searchCheckin').value = '2026-11-14';
  d.getElementById('searchCheckout').value = '2026-11-16';
  w.searchProperties();
  assert.equal(w.searchSelection, undefined);
  assert.match(d.getElementById('toast').textContent, /past|today/i);
  d.getElementById('searchCheckin').value = '2026-12-01';
  d.getElementById('searchCheckout').value = '';
  w.searchProperties();
  assert.equal(w.searchSelection, undefined);
});
test('past rental dates are rejected before sending an API request', async t => {
  const { w, d, requests } = await setup(t);
  w.openProperty('IL001'); select(d, '2026-11-14', '2026-11-16');
  await w.checkRentalPeriod();
  assert.equal(requests.length, 0);
  assert.match(d.getElementById('connectionMessage').textContent, /past|today/i);
});
test('transferred search dates update the checkout minimum', async t => {
  const { w, d } = await setup(t);
  w.searchSelection = { checkin: '2026-12-01', checkout: '2026-12-04', guests: '30' };
  w.openProperty('IL001');
  assert.equal(d.getElementById('modalCheckout').min, '2026-12-02');
  assert.equal(d.getElementById('modalGuests').value, '30');
});
test('location-only search remains available and Coming Soon properties have no booking panel', async t => {
  const { w, d, requests } = await setup(t);
  d.getElementById('searchLocation').value = 'Johor'; w.searchProperties();
  assert.equal(d.getElementById('resultCount').textContent, '1 property');
  for (const id of ['IL002', 'IL003']) {
    w.openProperty(id);
    assert.equal(d.getElementById('rentalPanel').style.display, 'none');
    await w.checkRentalPeriod();
  }
  assert.equal(requests.length, 0);
});
test('property and terms dialogs move focus, expose semantics and restore focus on close', async t => {
  const { w, d } = await setup(t);
  const trigger = d.querySelector('[onclick="openProperty(\'IL001\')"]'); trigger.focus();
  w.openProperty('IL001');
  const property = d.getElementById('propertyModal');
  assert.equal(property.getAttribute('role'), 'dialog');
  assert.equal(property.getAttribute('aria-modal'), 'true');
  assert.ok(property.contains(d.activeElement));
  const termsLink = d.querySelector('[onclick="showTerms(event)"]'); termsLink.focus(); termsLink.click();
  assert.ok(d.getElementById('termsModal').contains(d.activeElement));
  assert.equal(d.getElementById('acceptTerms').checked, false);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(d.getElementById('termsModal').classList.contains('open'), false);
  assert.equal(property.classList.contains('open'), true);
  assert.equal(d.body.style.overflow, 'hidden');
  assert.equal(d.activeElement, termsLink);
  w.closeProperty(); assert.equal(d.activeElement, trigger);
});
test('signing out clears the booking contact fields and prior confirmation', async t => {
  const { w, d } = await setup(t, accountResponse);
  await signIn(w, d);
  assert.equal(d.getElementById('guestName').value, profile.customerName);
  d.getElementById('confirmName').textContent = profile.customerName;
  d.getElementById('confirmReference').textContent = 'SYNTHETIC-BOOKING';
  d.getElementById('stayLogout').click(); await tick();
  assert.equal(w.stayBookingToken(), '');
  assert.equal(w.stayBookingProfile(), null);
  for (const id of ['guestName','guestPhone','guestEmail','stayIdentifier','account-customerName','account-phone','account-email']) assert.equal(d.getElementById(id).value, '', id);
  for (const id of ['confirmName','confirmReference']) assert.equal(d.getElementById(id).textContent, '', id);
});
test('an expired session clears guest data and returns to sign-in', async t => {
  let expired = false;
  const { w, d } = await setup(t, input => expired && input.action === 'stay.list' ? { ok: false, code: 'AUTH_REQUIRED', message: 'Please sign in again.' } : accountResponse(input));
  await signIn(w, d); expired = true;
  d.getElementById('stayRefresh').click(); await tick();
  assert.equal(w.stayBookingToken(), '');
  assert.equal(d.getElementById('guestEmail').value, '');
  assert.equal(d.getElementById('stayLogin').classList.contains('stay-hidden'), false);
});
test('stale quotations cannot reveal a booking step for changed dates', async t => {
  let release;
  const { w, d } = await setup(t, input => input.action === 'quote' ? new Promise(resolve => { release = resolve; }) : { ok: true, bookingEnabled: true });
  w.openProperty('IL001'); select(d);
  const pending = w.checkRentalPeriod();
  d.getElementById('modalCheckout').value = '2026-12-03';
  d.getElementById('modalCheckout').dispatchEvent(new w.Event('change'));
  release(quote); await pending;
  assert.equal(d.getElementById('bookingStep').classList.contains('visible'), false);
});
test('unavailable dates and API failure never enable booking', async t => {
  const { w, d } = await setup(t, () => ({ ok: true, available: false }));
  w.openProperty('IL001'); select(d); await w.checkRentalPeriod();
  assert.match(d.getElementById('connectionMessage').textContent, /unavailable/i);
  assert.equal(d.getElementById('bookingStep').classList.contains('visible'), false);
  w.fetch = async () => { throw new Error('Synthetic network outage'); };
  await w.checkRentalPeriod();
  assert.match(d.getElementById('connectionMessage').textContent, /Unable to check/i);
  assert.equal(d.querySelector('.check-button').disabled, false);
});
test('unauthenticated customers cannot submit a booking', async t => {
  const { w, d, requests } = await setup(t);
  w.openProperty('IL001'); select(d); await w.checkRentalPeriod();
  d.getElementById('acceptTerms').checked = true;
  await w.continueBooking();
  assert.equal(requests.some(r => r.action === 'requestBooking'), false);
  assert.equal(d.getElementById('stayModal').classList.contains('open'), true);
});
test('rapid duplicate clicks send one booking request and an uncertain save blocks retries', async t => {
  let rejectSave;
  const { w, d, requests } = await setup(t, input => input.action === 'requestBooking' ? new Promise((resolve, reject) => { rejectSave = reject; }) : accountResponse(input));
  await signIn(w, d); d.getElementById('stayClose').click();
  w.openProperty('IL001'); select(d); await w.checkRentalPeriod();
  d.getElementById('acceptTerms').checked = true;
  const pending = w.continueBooking(); await w.continueBooking();
  assert.equal(requests.filter(r => r.action === 'requestBooking').length, 1);
  rejectSave(new Error('Synthetic timeout')); await pending; await w.continueBooking();
  assert.equal(requests.filter(r => r.action === 'requestBooking').length, 1);
  assert.match(d.getElementById('connectionMessage').textContent, /could not confirm/i);
});

test('Tab and Shift+Tab stay inside the top booking dialog', async t => {
  const {w,d}=await setup(t);w.openProperty('IL001');w.showTerms();
  const buttons=[...d.getElementById('termsModal').querySelectorAll('button')];
  for(const button of buttons)button.getClientRects=()=>[{width:100,height:40}];
  buttons.at(-1).focus();
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(d.activeElement,buttons[0]);
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(d.activeElement,buttons.at(-1));
});
test('successful synthetic booking opens confirmation and restores the original trigger', async t => {
  const {w,d}=await setup(t,input=>input.action==='requestBooking'?{...quote,bookingId:'SYNTHETIC-BOOKING',status:'PENDING_REVIEW'}:accountResponse(input));
  await signIn(w,d);d.getElementById('stayClose').click();
  const trigger=d.querySelector('[onclick="openProperty(\'IL001\')"]');trigger.focus();
  w.openProperty('IL001');select(d);await w.checkRentalPeriod();
  d.getElementById('acceptTerms').checked=true;await w.continueBooking();
  assert.equal(d.getElementById('propertyModal').classList.contains('open'),false);
  assert.ok(d.getElementById('confirmationModal').contains(d.activeElement));
  assert.equal(d.getElementById('confirmReference').textContent,'SYNTHETIC-BOOKING');
  w.closeConfirmation();assert.equal(d.activeElement,trigger);assert.equal(d.body.style.overflow,'');
});
test('checkout minimum handles year boundaries and clearing the check-in selection', async t => {
  const {w,d}=await setup(t);
  d.getElementById('searchCheckin').value='2026-12-31';
  d.getElementById('searchCheckout').value='2026-12-31';
  w.updateCheckoutMinimum('searchCheckin','searchCheckout');
  assert.equal(d.getElementById('searchCheckout').min,'2027-01-01');
  assert.equal(d.getElementById('searchCheckout').value,'');
  d.getElementById('searchCheckin').value='';w.updateCheckoutMinimum('searchCheckin','searchCheckout');
  assert.equal(d.getElementById('searchCheckout').min,'2026-11-16');
});
test('invalid account registration is rejected locally without a network write', async t => {
  const {w,d,requests}=await setup(t);w.registerStay();
  d.getElementById('account-customerName').value='Synthetic Guest';
  d.getElementById('account-password').value='synthetic-password-only';
  d.getElementById('account-repeat').value='synthetic-password-only';
  d.getElementById('stayProfileEditor').querySelector('form').requestSubmit();await tick();
  assert.match(d.getElementById('stayMessage').textContent,/phone number or email/i);
  assert.equal(requests.length,0);
});
