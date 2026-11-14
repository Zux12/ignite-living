process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const profile = { customerId: 'synthetic-customer', customerName: 'Synthetic Guest', phone: '+60123456789', email: 'guest@example.invalid' };
const quote = { ok: true, available: true, propertyName: 'Mayang Sari Beach Cottage', nights: 1, totalAmount: 1200, bookingDeposit: 500, balanceAfterDeposit: 700 };

async function setup(t, responder, now = '2026-11-14T16:30:00Z') {
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
        const value = responder ? await responder(input) : input.action === 'status' ? { ok: true, bookingEnabled: true } : quote;
        return { ok: true, json: async () => value };
      };
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
  const termsLink = d.querySelector('[onclick="showTerms(event)"]'); termsLink.focus(); w.showTerms();
  assert.ok(d.getElementById('termsModal').contains(d.activeElement));
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
