"use strict";
(() => {
  const fields=[['nightlyRate','1 night'],['twoNightTotal','2 nights'],['threeNightTotal','3 nights'],['additionalNightRate','extra night after 3 nights']];
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
    function today(){const now=Date.parse(data.serverTime)+Math.max(0,clock()-receivedAt);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
    function render(){if(!data)return;for(const property of data.properties){
      if(!fields.every(([key])=>Number.isFinite(property.standard?.[key])&&property.standard[key]>0))continue;
      const price=document.getElementById('propertyPrice-'+property.propertyId),term=document.getElementById('propertyOffer-'+property.propertyId),offer=validOffer(property.promotion)&&property.promotion.endDate>=today()?property.promotion:null;
      if(price&&term){price.replaceChildren();term.replaceChildren();const changed=offer&&fields.find(([key])=>offer.rates[key]<property.standard[key]);
        if(changed){const[key,label]=changed;price.append(node('span',offer.title,'promotion-badge'),node('del',money(property.standard[key]),'promotion-original'),node('strong',money(offer.rates[key])+' / '+label,'promotion-now'));term.append(node('span','Promotional nights: '+date(offer.startDate)+' – '+date(offer.endDate)),node('br'),node('span','Entire stay must be within these nights.'));}
        else{price.textContent=money(property.standard.nightlyRate)+' / 1 night';term.textContent='Rate shown after selecting dates';}
      }
      const packages=document.getElementById('promotionPackages-'+property.propertyId);if(packages){packages.replaceChildren(node('strong',offer?offer.title+' · promotional stay prices':'Standard stay prices'));const list=node('ul',undefined,'promotion-rate-list');for(const[key,label]of fields){const li=node('li');li.append(document.createTextNode(label+': '));if(offer&&offer.rates[key]<property.standard[key])li.append(node('del',money(property.standard[key])),node('strong',money(offer.rates[key])));else li.append(node('span',money(property.standard[key])));list.append(li);}packages.append(list);if(offer)packages.append(node('p','Promotional nights: '+date(offer.startDate)+' – '+date(offer.endDate)+'. Your entire stay must fall within these nights; check-out can be the following day.','promotion-validity'));packages.append(node('p','Cleaning is free. Up to 30 guests, with no extra charge per person. Select dates to confirm your total.','pricing-note'));}
    }}
    async function refresh(){if(loading)return;loading=true;try{const r=await fetchPricing();if(!Array.isArray(r.properties)||!Number.isFinite(Date.parse(r.serverTime)))throw Error('Invalid pricing');data=r;receivedAt=clock();render();}catch(_){render();}finally{loading=false;}}
    const timer=setInterval(()=>{render();if(data&&clock()-receivedAt>=300000)refresh();},60000),onVisible=()=>{if(!document.hidden)refresh();};document.addEventListener('visibilitychange',onVisible);refresh();
    return {refresh,render,stop(){clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);}};
  };
  if(document.getElementById('propertyPrice-IL001'))window.createPromotionPublic({fetchPricing:()=>callBookingApi('pricing')});
})();
