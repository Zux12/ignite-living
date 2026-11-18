"use strict";
(() => {
  const fields=[['nightlyRate','1 night — total'],['twoNightTotal','2 nights — total'],['threeNightTotal','3 nights — total'],['additionalNightRate','extra night after 3 nights']];
  const money=value=>'RM '+Number(value).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
  const date=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  function validOffer(o){return o&&typeof o.title==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(o.startDate)&&/^20\d{2}-\d{2}-\d{2}$/.test(o.endDate)&&fields.every(([key])=>Number.isFinite(o.rates?.[key])&&o.rates[key]>0);}
  window.renderPromotionQuote=(quote,container)=>{
    container.replaceChildren();container.hidden=true;
    if(!quote.promotion||!Number.isFinite(quote.originalTotalAmount)||quote.originalTotalAmount<=quote.totalAmount)return;
    container.hidden=false;const title=node('strong',quote.promotion.title+' applied');container.append(title,node('p'));
    const amounts=node('div');amounts.append(node('del',money(quote.originalTotalAmount)),node('strong',money(quote.totalAmount)));container.append(amounts,node('span','You save '+money(quote.originalTotalAmount-quote.totalAmount)+'. Promotional nights: '+date(quote.promotion.startDate)+' – '+date(quote.promotion.endDate)+'.'));
  };
  window.createPromotionPublic=({fetchPricing,clock=()=>Date.now()})=>{
    let data=null,receivedAt=0,loading=false;
    const cards=[...document.querySelectorAll('[id^="propertyPrice-"]')];
    function status(failed=false){
      for(const price of cards){
        const id=price.id.slice('propertyPrice-'.length),term=document.getElementById('propertyOffer-'+id),packages=document.getElementById('promotionPackages-'+id);
        for(const host of [price,packages].filter(Boolean)){
          host.replaceChildren(node('span',failed?'Prices couldn’t load':'Loading prices…','promotion-loading'));
          host.setAttribute('aria-busy',String(!failed));
          if(failed){const retry=node('button','Retry prices','promotion-retry');retry.type='button';retry.onclick=refresh;host.append(retry);}
        }
        if(term)term.textContent=failed?'Select your dates to get a confirmed quote.':'Checking the latest rates and offers.';
      }
    }
    function today(){const now=Date.parse(data.serverTime)+Math.max(0,clock()-receivedAt);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
    function render(){if(!data)return;for(const property of data.properties){
      if(!fields.every(([key])=>Number.isFinite(property.standard?.[key])&&property.standard[key]>0))continue;
      const price=document.getElementById('propertyPrice-'+property.propertyId),term=document.getElementById('propertyOffer-'+property.propertyId),offer=validOffer(property.promotion)&&property.promotion.endDate>=today()?property.promotion:null;
      if(price&&term){
        price.replaceChildren();term.replaceChildren();
        price.setAttribute('aria-busy','false');
        const primary=node('div',undefined,'promotion-card-primary');
        const discounted=offer&&offer.rates.nightlyRate<property.standard.nightlyRate;
        if(offer)primary.append(node('span',offer.title,'promotion-badge'));
        primary.append(node('span','1-night stay — total','promotion-stay-label'));
        if(discounted)primary.append(node('del',money(property.standard.nightlyRate),'promotion-original'));
        primary.append(node('strong',money(discounted?offer.rates.nightlyRate:property.standard.nightlyRate),'promotion-now'));
        primary.append(node('span','For the entire property','promotion-stay-caption'));
        const comparison=node('ul',undefined,'promotion-card-packages');
        for(const[key,label]of fields.slice(1)){
          const row=node('li'),amounts=node('span',undefined,'promotion-card-amount');row.append(node('span',label));
          const lower=offer&&offer.rates[key]<property.standard[key];
          if(lower)amounts.append(node('del',money(property.standard[key])));
          amounts.append(node('strong',money(lower?offer.rates[key]:property.standard[key])));row.append(amounts);comparison.append(row);
        }
        price.append(primary,comparison);
        if(offer)term.append(node('span','Promotional nights: '+date(offer.startDate)+' – '+date(offer.endDate)),node('br'),node('span','Entire stay must be within these nights.'));
        else term.textContent='Select your dates to check availability and confirm the total.';
      }
      const packages=document.getElementById('promotionPackages-'+property.propertyId);if(packages){packages.setAttribute('aria-busy','false');packages.replaceChildren(node('strong',offer?offer.title+' · promotional stay prices':'Standard stay prices'));const list=node('ul',undefined,'promotion-rate-list');for(const[key,label]of fields){const li=node('li');li.append(document.createTextNode(label+': '));if(offer&&offer.rates[key]<property.standard[key])li.append(node('del',money(property.standard[key])),node('strong',money(offer.rates[key])));else li.append(node('span',money(property.standard[key])));list.append(li);}packages.append(list);if(offer)packages.append(node('p','Promotional nights: '+date(offer.startDate)+' – '+date(offer.endDate)+'. Your entire stay must fall within these nights; check-out can be the following day.','promotion-validity'));packages.append(node('p','Cleaning is free. Up to 30 guests, with no extra charge per person. Select dates to confirm your total.','pricing-note'));}
    }}
    async function refresh(){if(loading)return;loading=true;if(!data)status();try{const r=await fetchPricing();if(!Array.isArray(r.properties)||!Number.isFinite(Date.parse(r.serverTime))||!cards.every(card=>r.properties.some(p=>p?.propertyId===card.id.slice('propertyPrice-'.length)&&fields.every(([key])=>Number.isFinite(p.standard?.[key])&&p.standard[key]>0))))throw Error('Invalid pricing');data=r;receivedAt=clock();render();}catch(_){if(data)render();else status(true);}finally{loading=false;}}
    const timer=setInterval(()=>{render();if(!data||clock()-receivedAt>=300000)refresh();},60000),onVisible=()=>{if(!document.hidden)refresh();};document.addEventListener('visibilitychange',onVisible);refresh();
    return {refresh,render,stop(){clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);}};
  };
  if(document.getElementById('propertyPrice-IL001'))window.createPromotionPublic({fetchPricing:()=>callBookingApi('pricing')});
})();
