/* NewsDork v3 — streaming-style shell. Static: talks to archive.org directly, no server. */
(function(){'use strict';
const ST={CNNW:['CNN','#E0262B','CNN'],FOXNEWSW:['Fox News','#2C5BD6','FOX'],MSNOW:['MS NOW','#8A55D6','MS NOW'],CNBC:['CNBC','#1597D3','CNBC'],BLOOMBERG:['Bloomberg','#D9822B','BBG'],FBC:['Fox Business','#2E9D54','FOX BIZ'],COM:['Comedy Central','#E2B019','COMEDY'],CSPAN:['C-SPAN','#8F8A7E','C-SPAN'],CSPAN2:['C-SPAN2','#A8A294','C-SPAN2']};
const ORDER=Object.keys(ST);
const KOFI='https://ko-fi.com/heyitsdork';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const clock=s=>{s=Math.max(0,Math.floor(s||0));const h=Math.floor(s/3600);return h?`${h}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`:`${Math.floor(s/60)}:${pad(s%60)}`};
const hm=s=>{const h=Math.floor(s/3600),m=Math.round(s%3600/60);return h?`${h}h ${pad(m)}m`:`${m}m`};
const TZ=Intl.DateTimeFormat().resolvedOptions().timeZone;
const tf=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'});
const dayKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(t);
const hourOf=t=>+new Intl.DateTimeFormat('en-US',{hour:'numeric',hourCycle:'h23',timeZone:TZ}).format(t);
const noonOf=s=>new Date(s+'T12:00:00').getTime();
const dayName=s=>{const diff=Math.round((noonOf(dayKey(Date.now()))-noonOf(s))/864e5);return diff===0?'Today':diff===1?'Yesterday':diff<7?new Intl.DateTimeFormat(undefined,{weekday:'long'}).format(noonOf(s)):new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(noonOf(s))};
const longDay=s=>new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(noonOf(s));
const ago=t=>{const m=Math.round((Date.now()-t)/6e4);return m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`};
const thumb=(d,sec)=>{const n=Math.round(Math.max(5,Math.min(sec,(d.dur||3600)-15))/5)*5;return `https://archive.org/download/${d.id}/${d.id}.thumbs/${d.id}_${String(n).padStart(6,'0')}.jpg`};
const store={get(k,d){try{const v=localStorage.getItem('nd3_'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem('nd3_'+k,JSON.stringify(v))}catch(e){}}};

/* ================= DATA ================= */
const REG=new Map();   // id -> item
const toItem=x=>{const t0=new Date(String(x.start_time).replace(' ','T')+'Z').getTime();const p=String(x.runtime||'0').split(':').map(Number);const dur=p.length===3?p[0]*3600+p[1]*60+p[2]:p.length===2?p[0]*60+p[1]:+p[0]||0;
 const it={id:x.identifier,st:x.identifier.split('_')[0],show:String(x.title||x.identifier).split(' : ')[0].trim(),t0,t1:t0+dur*1e3,dur,cc:[].concat(x.format||[]).includes('SubRip')};
 const old=REG.get(it.id);if(old)return old;REG.set(it.id,it);return it};
async function ia(q,{rows=400,page=1,sort='identifier desc'}={}){const u=new URLSearchParams({q,rows,page,output:'json'});['identifier','title','start_time','runtime','format'].forEach(f=>u.append('fl[]',f));u.append('sort[]',sort);
 const r=await fetch('https://archive.org/advancedsearch.php?'+u);if(!r.ok)throw new Error('search '+r.status);const j=await r.json();
 return{n:j.response.numFound,items:j.response.docs.filter(x=>x.start_time&&x.runtime).map(toItem)}}
const dayCache=new Map();
function fetchDay(s){ // all broadcasts that started on local day s
 if(dayCache.has(s))return dayCache.get(s);
 const pr=(async()=>{const a=new Date(noonOf(s)-864e5),b=new Date(noonOf(s)),c=new Date(noonOf(s)+864e5);
  const pre=[...new Set([a,b,c].map(x=>x.toISOString().slice(0,10).replace(/-/g,'')))];
  const q=`(${ORDER.map(k=>pre.map(p=>`identifier:${k}_${p}*`).join(' OR ')).join(' OR ')}) AND format:"h.264"`;
  const {items}=await ia(q,{rows:1000});return items.filter(x=>dayKey(x.t0)===s&&x.dur>600&&x.t1<=Date.now()+6e4)})();
 pr.catch(()=>dayCache.delete(s));dayCache.set(s,pr);return pr}
// C-SPAN reruns events under the same title: first airing wins, later ones are replays.
function markReplays(){const first={};for(const d of [...REG.values()].sort((a,b)=>a.t0-b.t0)){if(!d.st.startsWith('CSPAN')||/Public Affairs Events/i.test(d.show))continue;const k=d.show.toLowerCase();
 if(first[k]&&first[k]!==d&&d.t0-first[k].t0<7*864e5){d.replay=true;first[k].airs=(first[k].airs||1)+(d.counted?0:1);d.counted=true}else if(!first[k])first[k]=d}}

/* ================= PROGRESS ================= */
const prog=store.get('progress',{});
const saveProg=(d,t)=>{if(!d)return;if(t<30||t>d.dur-60)delete prog[d.id];else prog[d.id]={t:Math.floor(t),at:Date.now(),it:{id:d.id,st:d.st,show:d.show,t0:d.t0,dur:d.dur,cc:d.cc}};
 const keep=Object.entries(prog).sort((a,b)=>b[1].at-a[1].at).slice(0,30);for(const k in prog)if(!keep.find(x=>x[0]===k))delete prog[k];store.set('progress',prog)};

/* ================= CARDS ================= */
const short=st=>(ST[st]||[st,'#555',st])[2];
function card(d,o={}){REG.set(d.id,REG.get(d.id)||d);const p=prog[d.id];const pct=p?Math.min(100,p.t/d.dur*100):0;
 return `<div class="c${o.big?' big':''}" data-id="${esc(d.id)}"><div class="f"><img loading="lazy" alt="" src="${thumb(d,o.at??Math.min(200,d.dur/3))}"><span class="tag" data-net="${d.st}" style="background:${ST[d.st][1]}">${short(d.st)}</span>${d.replay?'<span class="new" style="background:#3A3D44">REPLAY</span>':Date.now()-d.t1<3*3600e3?'<span class="new">NEW</span>':''}${d.airs>1&&!d.replay?`<span class="new" style="background:#3A3D44;top:auto;bottom:8px;right:auto;left:8px">AIRED ${d.airs}×</span>`:''}${pct?`<div class="wp"><i style="width:${pct}%"></i></div>`:`<span class="dur">${hm(d.dur)}</span><div class="scrub"><i></i></div>`}</div><h3 data-show="${esc(d.show)}" data-st="${d.st}">${esc(d.show)}</h3><p>${o.sub||`${tf.format(d.t0)} · ${dayName(dayKey(d.t0))}`}</p></div>`}
const row=(title,list,o={})=>list.length?`<section class="row"><div class="rh"><h2>${title}</h2>${o.small?`<small>${o.small}</small>`:''}${o.more?`<a href="${o.more}">See all ›</a>`:''}</div><div class="rail">${list.map(d=>card(d,o.opts?o.opts(d):{})).join('')}</div></section>`:'';
document.addEventListener('click',e=>{const t=e.target;
 const tag=t.closest('.tag[data-net]');if(tag){e.preventDefault();location.hash='#/net/'+tag.dataset.net;return}
 const h3=t.closest('h3[data-show]');if(h3){location.hash=`#/show/${h3.dataset.st}/${encodeURIComponent(h3.dataset.show)}`;return}
 const c=t.closest('.c[data-id]');if(c){const p=prog[c.dataset.id];location.hash=`#/watch/${c.dataset.id}${p?'?t='+p.t:''}`}});
// hover-scrub: the Archive keeps a frame every 5 seconds. Each frame is preloaded off-screen and only
// swapped in once it has loaded, so the card never blanks; one request at a time, latest wins.
const FRAMES=new Set();
document.addEventListener('mousemove',e=>{const c=e.target.closest&&e.target.closest('.c[data-id]');if(!c)return;const d=REG.get(c.dataset.id);if(!d||!d.dur)return;const f=c.querySelector('.f'),img=f.querySelector('img'),bar=f.querySelector('.scrub i');
 if(!c._scrub){const s=c._scrub={orig:img.src,want:null,busy:false};FRAMES.add(s.orig);
  c.addEventListener('mouseleave',()=>{s.want=null;img.src=s.orig;if(bar)bar.style.width=0;c._scrub=null},{once:true})}
 const s=c._scrub,r=f.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));if(bar)bar.style.width=x*100+'%';
 const steps=Math.max(8,Math.min(40,Math.round(d.dur/60))); // ~1 frame per minute, 8 to 40 stops
 s.want=thumb(d,Math.round(x*steps)/steps*d.dur);pump(s,img)});
function pump(s,img){if(s.busy||!s.want)return;const u=s.want;if(u===img.src)return;
 if(FRAMES.has(u)){img.src=u;return}
 s.busy=true;const im=new Image();im.onload=()=>{FRAMES.add(u);s.busy=false;if(s.want===u)img.src=u;pump(s,img)};im.onerror=()=>{s.busy=false;if(s.want===u)s.want=null;else pump(s,img)};im.src=u}

// donate dialog
const DN=$('#donate');let dnFrom=null;
document.addEventListener('click',e=>{if(e.target.closest('[data-donate]')){dnFrom=document.activeElement;DN.hidden=false;DN.querySelector('.dn-x').focus()}
 else if(!DN.hidden&&(e.target===DN||e.target.closest('[data-close]'))){DN.hidden=true;dnFrom?.focus?.()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!DN.hidden){DN.hidden=true;dnFrom?.focus?.();e.stopImmediatePropagation()}},true);
$('#btc-copy').addEventListener('click',e=>{const t=$('#btc').textContent.trim();(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>{e.target.textContent='Copied ✓';setTimeout(()=>e.target.textContent='Copy',1800)},()=>{getSelection().selectAllChildren($('#btc'))})});

/* ================= HOME ================= */
const MAIN=$('#main'),HOME=$('#home'),VIEW=$('#view');
let HERO=[],hi=0,heroTimer=0;
function hero(){if(!HERO.length){$('#hin').innerHTML='';return}const d=HERO[hi];$('#hbg').style.backgroundImage=`url(${thumb(d,200)})`;
 $('#hin').innerHTML=`<span class="net"><i style="background:${ST[d.st][1]}"></i>${ST[d.st][0]} · ${dayName(dayKey(d.t0))}, ${tf.format(d.t0)}</span><h1>${esc(d.show)}</h1><div class="meta"><span>${hm(d.dur)}</span><span>${d.cc?'CC · transcript':'No captions'}</span><span>Archived ${ago(d.t1)}</span></div><div class="btns"><button class="b p" data-play="${d.id}">▶ Play</button><button class="b" data-play="${d.id}" data-tx="1">≡ Read along</button><button class="b" data-showpage="1">All episodes</button></div>`;
 $('#hin [data-showpage]').onclick=()=>location.hash=`#/show/${d.st}/${encodeURIComponent(d.show)}`;
 $('#hin').querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>{if(b.dataset.tx)store.set('tx',true);location.hash='#/watch/'+b.dataset.play});
 $('#dots').innerHTML=HERO.map((_,i)=>`<span class="${i===hi?'on':''}" data-i="${i}"></span>`).join('');
 $('#dots').querySelectorAll('span').forEach(s=>s.onclick=()=>{hi=+s.dataset.i;hero();armHero()})}
function armHero(){clearInterval(heroTimer);heroTimer=setInterval(()=>{if(!HOME.hidden&&HERO.length){hi=(hi+1)%HERO.length;hero()}},9000)}
const loaded=[];let cursor=0,busy=false,booted=false;
async function addDay(){const s=dayKey(cursor);cursor-=864e5;let list=[];try{list=await fetchDay(s)}catch(e){}
 markReplays();loaded.push(s);
 let h=`<div class="daysep" id="d-${s}"><h2>${dayName(s)}</h2><span>${longDay(s)} · ${list.filter(d=>!d.replay).length} broadcasts</span><hr></div>`;
 let any=false;for(const st of ORDER){const l=list.filter(d=>d.st===st&&!d.replay).sort((a,b)=>b.t0-a.t0);if(l.length){any=true;h+=row(ST[st][0],l,{small:`${l.length} shows`,more:'#/net/'+st})}}
 if(!any)h+=`<div class="empty">Nothing archived for this day yet.</div>`;MAIN.insertAdjacentHTML('beforeend',h)}
async function fill(){if(busy||HOME.hidden||!booted)return;busy=true;try{let n=0;while($('#loader').getBoundingClientRect().top<innerHeight+900&&n++<4)await addDay()}finally{busy=false}}
async function goDay(s){if(noonOf(s)>Date.now())s=dayKey(Date.now());if(!loaded.includes(s)&&noonOf(s)<cursor-864e5){cursor=noonOf(s);MAIN.insertAdjacentHTML('beforeend',`<div class="daysep"><span>…skipped ahead to ${longDay(s)}</span><hr></div>`)}
 let n=0;while(!loaded.includes(s)&&n++<60)await addDay();document.getElementById('d-'+s)?.scrollIntoView({block:'start'});scrollBy(0,-120)}
function pills(){const today=Date.now();$('#daypills').innerHTML=Array.from({length:5},(_,i)=>dayKey(today-i*864e5)).map((s,i)=>`<span class="pill${i===0?' on':''}" data-day="${s}">${dayName(s)}</span>`).join('');
 $('#daypills').querySelectorAll('[data-day]').forEach(p=>p.onclick=()=>{$('#daypills .on')?.classList.remove('on');p.classList.add('on');goDay(p.dataset.day)})}
async function boot(){
 pills();$('#pick').max=dayKey(Date.now());$('#pick').onchange=e=>e.target.value&&goDay(e.target.value);
 $('#chips').innerHTML=ORDER.map(k=>`<span class="chip" data-net="${k}" title="${ST[k][0]}" style="background:${ST[k][1]}">${short(k)}</span>`).join('');
 $('#chips').querySelectorAll('.chip').forEach(c=>c.onclick=()=>location.hash='#/net/'+c.dataset.net);
 const now=Date.now();const days=[0,1,2].map(i=>dayKey(now-i*864e5));
 const lists=await Promise.all(days.map(s=>fetchDay(s).catch(()=>[])));markReplays();
 const ALL=lists.flat();
 // Hero: newest finished primetime, one per network. C-SPAN never leads.
 const seen=new Set();HERO=[];
 for(const d of [...ALL].sort((a,b)=>b.t0-a.t0)){const et=+new Intl.DateTimeFormat('en-US',{hour:'numeric',hourCycle:'h23',timeZone:'America/New_York'}).format(d.t0);
  const prime=['CNNW','FOXNEWSW','MSNOW'].includes(d.st)?(et>=20&&et<=22):['CNBC','FBC'].includes(d.st)?(et>=9&&et<=19):d.st==='COM';
  if(seen.has(d.st)||!prime||d.dur<1500||now-d.t1>36*3600e3||d.replay)continue;seen.add(d.st);HERO.push(d);if(HERO.length===5)break}
 if(!HERO.length)HERO=ALL.filter(d=>!d.st.startsWith('CSPAN')&&d.dur>1500).sort((a,b)=>b.t0-a.t0).slice(0,4);
 hi=0;hero();armHero();
 const recent=ALL.filter(d=>!d.replay).sort((a,b)=>b.t1-a.t1);
 const prime=ALL.filter(d=>['CNNW','FOXNEWSW','MSNOW','COM'].includes(d.st)&&now-d.t0<36*3600e3&&d.dur>1500&&(()=>{const h=+new Intl.DateTimeFormat('en-US',{hour:'numeric',hourCycle:'h23',timeZone:'America/New_York'}).format(d.t0);return d.st==='COM'||(h>=17&&h<=23)})()).sort((a,b)=>b.t0-a.t0);
 const hearings=ALL.filter(d=>d.st.startsWith('CSPAN')&&!d.replay&&!/Washington Journal|Public Affairs/i.test(d.show)).sort((a,b)=>b.t0-a.t0);
 const markets=ALL.filter(d=>['CNBC','BLOOMBERG','FBC'].includes(d.st)).sort((a,b)=>b.t0-a.t0);
 MAIN.innerHTML='<div id="cont"></div>'+row('Just archived',recent.slice(0,16),{small:'newest first',opts:d=>({sub:`${ST[d.st][0]} · ${ago(d.t1)}`})})
  +row('Primetime',prime.slice(0,16),{small:'last 36 hours',opts:()=>({big:true})})
  +row('Hearings, debates &amp; briefings',hearings.slice(0,16),{small:'C-SPAN · first airings only',more:'#/net/CSPAN'})
  +row('Markets',markets.slice(0,16),{small:'CNBC · Bloomberg · Fox Business'});
 if(!ALL.length)MAIN.innerHTML=`<div class="empty">Couldn’t reach the Internet Archive just now. It’s usually back within a minute — reload to try again.</div>`;
 drawCont();cursor=now;booted=true;fill()}
function drawCont(){const el=$('#cont');if(!el)return;const cont=Object.values(prog).sort((a,b)=>b.at-a.at).map(p=>REG.get(p.it.id)||toItem({identifier:p.it.id,title:p.it.show,start_time:new Date(p.it.t0).toISOString().slice(0,19).replace('T',' '),runtime:clock(p.it.dur)}));
 el.innerHTML=row('Continue watching',cont.slice(0,12),{opts:d=>({sub:`${clock(d.dur-(prog[d.id]?.t||0))} left · ${ST[d.st][0]}`})})}
new IntersectionObserver(es=>{if(es[0].isIntersecting)fill()},{rootMargin:'900px'}).observe($('#loader'));
addEventListener('scroll',()=>{fill();document.querySelector('nav').classList.toggle('solid',scrollY>40)},{passive:true});
$('#q').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.value.trim())location.hash='#/search/'+encodeURIComponent(e.target.value.trim())});

/* ================= NETWORK / SHOW / SEARCH ================= */
async function netView(st){
 VIEW.innerHTML=`<div class="boot">Loading ${ST[st][0]}…</div>`;const tok=++netView.tok;
 const days=[0,1,2,3,4,5,6].map(i=>dayKey(Date.now()-i*864e5));
 const draw=lists=>{if(tok!==netView.tok)return;markReplays();const n=lists.length;
  const l=lists.flat().filter(d=>d.st===st&&!d.replay).sort((a,b)=>b.t0-a.t0);const by={};l.forEach(d=>(by[d.show]??=[]).push(d));
  const shows=Object.entries(by).sort((a,b)=>b[1].length-a[1].length||b[1][0].t0-a[1][0].t0);const top=l.find(d=>d.dur>2400)||l[0];
  VIEW.innerHTML=`<div class="net-hero"><div class="bg" style="${top?`background-image:url(${thumb(top,200)})`:''}"></div><div class="in"><div class="crumb"><a href="#/">Home</a> › Networks</div><span class="badge" style="background:${ST[st][1]}">${short(st)}</span><h1>${ST[st][0]}</h1><div class="stats"><span>${shows.length} shows in the last ${n} days</span><span>${l.length} broadcasts</span><span>Pick a show to go back years</span></div></div></div>
  <div class="tabs">${ORDER.map(k=>`<span class="${k===st?'on':''}" data-net="${k}">${ST[k][0]}</span>`).join('')}</div>
  <div class="shows">${shows.map(([name,eps])=>`<div class="sh" data-show="${esc(name)}"><div class="f"><img loading="lazy" alt="" src="${thumb(eps[0],Math.min(200,eps[0].dur/3))}"><div class="t">${esc(name)}</div></div><p>${eps.length} recent · last aired ${dayName(dayKey(eps[0].t0))}</p></div>`).join('')||'<div class="empty">Nothing archived recently.</div>'}</div>
  ${row('Latest from '+ST[st][0],l.slice(0,16))}`;
  VIEW.querySelectorAll('.tabs [data-net]').forEach(t=>t.onclick=()=>location.hash='#/net/'+t.dataset.net);
  VIEW.querySelectorAll('.sh').forEach(s=>s.onclick=()=>location.hash=`#/show/${st}/${encodeURIComponent(s.dataset.show)}`)};
 const first=await Promise.all(days.slice(0,3).map(s=>fetchDay(s).catch(()=>[])));draw(first);
 const rest=await Promise.all(days.slice(3).map(s=>fetchDay(s).catch(()=>[])));const y=scrollY;draw([...first,...rest]);scrollTo(0,y)}
netView.tok=0;
let listIO=null;
function pagedList(q,headHtml,countEl,opts){
 VIEW.innerHTML=headHtml+`<div class="eps" id="eps"></div><div class="loader" id="eploader">Loading…</div>`;
 let page=1,lastMon='',done=false,busy2=false;const eps=$('#eps');
 const more=async()=>{if(done||busy2||!document.getElementById('eps'))return;busy2=true;let r;try{r=await ia(q,{rows:36,page:page++})}catch(e){busy2=false;$('#eploader').textContent='The Archive didn’t answer. Scroll to retry.';page--;return}
  if(!document.getElementById('eps')){busy2=false;return}markReplays();if(countEl&&$(countEl))$(countEl).textContent=`${r.n.toLocaleString()} ${opts.noun} archived`;
  if(!r.items.length){done=true;$('#eploader').textContent=page>2?'That’s the very first one.':'Nothing found.';busy2=false;return}
  let h='';for(const d of r.items){const m=new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(d.t0);if(m!==lastMon){h+=`<div class="mon">${m}</div>`;lastMon=m}
   h+=card(d,{sub:`${new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(d.t0)} · ${tf.format(d.t0)} · ${hm(d.dur)}`})}
  eps.insertAdjacentHTML('beforeend',h);busy2=false;if($('#eploader').getBoundingClientRect().top<innerHeight+600)more()};
 listIO?.disconnect();listIO=new IntersectionObserver(es=>{if(es[0].isIntersecting)more()},{rootMargin:'700px'});listIO.observe($('#eploader'));more()}
function showView(st,name){const local=[...REG.values()].filter(d=>d.st===st&&d.show===name).sort((a,b)=>b.t0-a.t0);const top=local[0];
 const qn=name.replace(/[^\p{L}\p{N}\s'&.,-]/gu,' ').replace(/\s+/g,' ').trim();
 pagedList(`collection:TV-${st} AND title:("${qn}") AND format:"h.264"`,`<div class="net-hero"><div class="bg" style="${top?`background-image:url(${thumb(top,200)})`:''}"></div><div class="in"><div class="crumb"><a href="#/">Home</a> › <a href="#/net/${st}">${ST[st][0]}</a> › Shows</div><span class="badge" style="background:${ST[st][1]}">${short(st)}</span><h1>${esc(name)}</h1><div class="stats"><span id="epcount">Counting episodes…</span>${top?`<span>Usually ${tf.format(top.t0)}</span>`:''}</div>${top?`<div class="btns" style="margin-top:20px"><button class="b p" onclick="location.hash='#/watch/${top.id}'">▶ Play latest</button></div>`:''}</div></div><div class="tabs"><span class="on">All episodes, newest first</span></div>`,'#epcount',{noun:'episodes'})}
function searchView(q){const qq=q.replace(/[^\p{L}\p{N}\s'&.,-]/gu,' ').replace(/\s+/g,' ').trim();
 pagedList(`(${ORDER.map(k=>`collection:TV-${k}`).join(' OR ')}) AND title:(${qq}) AND format:"h.264"`,`<div class="net-hero" style="height:auto;min-height:0;padding-top:120px;padding-bottom:30px"><div class="in"><div class="crumb"><a href="#/">Home</a> › Search</div><h1>“${esc(q)}”</h1><div class="stats"><span id="hitcount">Searching…</span></div></div></div>`,'#hitcount',{noun:'broadcasts'})}

/* ================= WATCH ================= */
const W={eng:null,d:null,meta:null,cues:[],paras:[],tracks:[],paraIdx:-1,token:0,raf:0,idle:0,cc:store.get('cc',true),vol:store.get('vol',1),muted:false,lastSave:0,upTimer:0,capAbort:null};
const hooks={onTime:()=>{},onPlaying:on=>{$('#c-play').textContent=on?'❚❚':'▶';$('#w-big').hidden=on||!$('#w-err').hidden;if(on)$('#w-spin').hidden=true;armIdle()},
 onWaiting:on=>{$('#w-spin').hidden=!on},onEnded:()=>upNext(true),onError:msg=>{$('#w-spin').hidden=true;$('#w-err').hidden=false;$('#w-errmsg').textContent=msg},onRanges:()=>drawBuf()};
function makeEngine(){const seg=new URLSearchParams(location.search).get('engine')==='segments';
 if(!seg&&Engines.StreamEngine.supported()){$('#vid-b').classList.remove('is-active');$('#c-mode').textContent='';return new Engines.StreamEngine($('#vid-a'),hooks)}
 $('#c-mode').textContent='compat mode';return new Engines.SegmentEngine($('#vid-a'),$('#vid-b'),hooks)}
function stopWatch(){cancelAnimationFrame(W.raf);if(W.eng){saveProg(W.d,W.eng.time);try{W.eng.destroy()}catch(e){}}if(W.local&&W.local!==W.eng){try{W.local.destroy()}catch(e){}}W.eng=null;W.local=null;W.job=null;W.capAbort?.abort();clearTimeout(W.upTimer);
 for(const v of [$('#vid-a'),$('#vid-b')]){v.pause();v.removeAttribute('src');v.load();v.classList.remove('is-active')}}
async function openWatch(id,startAt){
 if(W.d&&W.d.id===id&&W.eng){if(startAt!=null)W.eng.seek(startAt);return}
 stopWatch();W.upAsked=false;const tok=++W.token;
 $('#watch').hidden=false;document.body.classList.add('watching');$('#watch').classList.toggle('tx-open',store.get('tx',false));$('#c-tx').setAttribute('aria-pressed',String(store.get('tx',false)));
 $('#w-err').hidden=true;$('#w-big').hidden=true;$('#w-spin').hidden=false;$('#upnext').hidden=true;$('#w-cc').innerHTML='';$('#tx').innerHTML='<div class="tmsg">Loading captions…</div>';$('#trk').innerHTML='';$('#tx-hits').textContent='';
 $('#w-arch').href='https://archive.org/details/'+id;$('#c-cc').setAttribute('aria-pressed',String(W.cc));
 let d=REG.get(id);setIdent(d||{id,st:id.split('_')[0],show:id.split('_').slice(3).join(' ')});
 let data;try{const r=await fetch('https://archive.org/metadata/'+encodeURIComponent(id));if(!r.ok)throw 0;data=await r.json()}catch(e){if(tok===W.token)hooks.onError('Couldn’t reach the Internet Archive for this broadcast.');return}
 if(tok!==W.token)return;const md=data.metadata||{},files=data.files||[];
 if(!d)d=toItem({identifier:id,title:md.title,start_time:md.start_time||'',runtime:md.runtime,format:files.map(f=>f.format)});
 const video=files.find(f=>f.name===id+'.mp4')||files.find(f=>/\.mp4$/i.test(f.name)&&!/thumb/i.test(f.name));
 if(!video){hooks.onError('This broadcast hasn’t finished processing at the Archive yet. Try again in a little while.');$('#tx').innerHTML='<div class="tmsg">No captions.</div>';return}
 const dur=parseFloat(video.length)||d.dur;if(!dur){hooks.onError('This broadcast has no recorded length, so it can’t be streamed.');return}
 d.dur=dur;W.d=d;W.meta=data;setIdent(d);
 W.eng=makeEngine();W.eng.setVolume(W.vol,W.muted);syncVol();
 const p=prog[id];const at=startAt??(p?p.t:0);
 W.job={id,file:video.name,duration:dur,title:d.show,network:(ST[d.st]||[d.st])[0],when:d.t0?`${dayName(dayKey(d.t0))} ${tf.format(d.t0)}`:'',thumb:sec=>thumb(d,sec)};
 if(window.NDCast&&NDCast.active){W.local=W.eng;W.eng.load({id,file:video.name,duration:dur,startAt:at,autoplay:false});W.eng=castFacade;$('#w-spin').hidden=true;showCasting(true);NDCast.load(W.job,at)}
 else W.eng.load({id,file:video.name,duration:dur,startAt:at});
 W.raf=requestAnimationFrame(loop);loadCaps(data,tok)}
function setIdent(d){$('#w-net').innerHTML=`<i style="background:${(ST[d.st]||[0,'#555'])[1]}"></i>${(ST[d.st]||[d.st])[0]}`;$('#w-title').textContent=d.show;
 $('#w-when').textContent=d.t0?`${longDay(dayKey(d.t0))} · ${tf.format(d.t0)}${d.dur?' · '+hm(d.dur):''}`:'';document.title=`${d.show} · NewsDork`}
async function loadCaps(data,tok){W.cues=[];W.paras=[];W.paraIdx=-1;W.tracks=Captions.captionFiles(data.files||[]);
 if(!W.tracks.length){$('#tx').innerHTML='<div class="tmsg">No captions for this broadcast.</div>';return}
 $('#trk').innerHTML=W.tracks.map((t,i)=>`<option value="${i}">${t.label}</option>`).join('');
 for(let i=0;i<W.tracks.length;i++){try{await useTrack(i,tok);$('#trk').value=i;return}catch(e){if(e.name==='AbortError'||tok!==W.token)return}}
 $('#tx').innerHTML='<div class="tmsg">Captions exist but couldn’t be loaded right now.</div>'}
async function useTrack(i,tok){W.capAbort?.abort();W.capAbort=new AbortController();$('#tx').innerHTML='<div class="tmsg">Loading captions…</div>';
 const cues=await Captions.fetchCaptions(W.meta,W.tracks[i],W.capAbort.signal);if(tok!==W.token)return;W.cues=cues;W.paras=Captions.paragraphs(cues);W.paraIdx=-1;renderTx()}
$('#trk').onchange=e=>useTrack(+e.target.value,W.token).catch(()=>{});
function renderTx(){const q=$('#tx-find').value.trim().toLowerCase();let hits=0;
 $('#tx').innerHTML=W.paras.map((p,i)=>{let t=esc(p.text);if(q&&p.text.toLowerCase().includes(q)){hits++;t=t.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),m=>`<mark>${m}</mark>`)}
  return (q&&!p.text.toLowerCase().includes(q))?'':`<div class="para${p.speaker?' sp1':''}" data-i="${i}" data-t="${p.start}"><span class="ts">${clock(p.start)}</span><span class="tx1">${t}</span></div>`}).join('')||'<div class="tmsg">No matches.</div>';
 $('#tx-hits').textContent=q?`${hits} moment${hits===1?'':'s'} mention “${$('#tx-find').value.trim()}”`:'';W.paraIdx=-1}
$('#tx-find').oninput=()=>renderTx();
$('#tx').onclick=e=>{const p=e.target.closest('.para');if(p&&W.eng){W.eng.seek(+p.dataset.t);W.eng.play()}};
let userScroll=0;$('#tx').addEventListener('wheel',()=>userScroll=Date.now(),{passive:true});
function loop(){W.raf=requestAnimationFrame(loop);const e=W.eng;if(!e)return;const t=e.time,dur=e.duration||W.d.dur;
 if(!dragging){const x=Math.min(1,t/dur)*100;$('#pl').style.width=x+'%';$('#kn').style.left=x+'%'}
 $('#c-time').textContent=`${clock(t)} / ${clock(dur)}`;
 const txt=W.cc&&W.cues.length?Captions.overlayText(W.cues,t):'';const cur=$('#w-cc').dataset.t||'';if(txt!==cur){$('#w-cc').dataset.t=txt;$('#w-cc').innerHTML=txt?`<span>${esc(Captions.softenCase?Captions.softenCase(txt):txt)}</span>`:''}
 if(W.paras.length){let i=W.paraIdx;if(i<0||!(W.paras[i].start<=t&&(W.paras[i+1]?.start??1e9)>t)){i=W.paras.findIndex((p,k)=>p.start<=t&&(W.paras[k+1]?.start??1e9)>t);
  if(i!==W.paraIdx){W.paraIdx=i;$('#tx .para.now')?.classList.remove('now');const el=$(`#tx .para[data-i="${i}"]`);if(el){el.classList.add('now');if(Date.now()-userScroll>5000&&$('#watch').classList.contains('tx-open'))el.scrollIntoView({block:'center',behavior:'smooth'})}}}}
 if(Date.now()-W.lastSave>5000){W.lastSave=Date.now();saveProg(W.d,t)}
 if(dur-t<20&&dur-t>0&&!e.paused&&!W.upAsked){W.upAsked=true;upNext(false)}}
function drawBuf(){if(!W.eng)return;const dur=W.eng.duration||1;$('#bufs').innerHTML=(W.eng.ranges()||[]).map(([a,b])=>`<div class="buf" style="left:${a/dur*100}%;width:${(b-a)/dur*100}%"></div>`).join('')}
// scrub bar with frame previews
let dragging=false;const sx=e=>{const r=$('#tr').getBoundingClientRect();return Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))};
$('#scrub').addEventListener('mousemove',e=>{if(!W.d)return;const x=sx(e),t=x*(W.eng?.duration||W.d.dur);$('#prev').style.left=Math.max(110,Math.min($('#scrub').clientWidth-110,x*$('#scrub').clientWidth))+'px';
 const u=thumb(W.d,t);if($('#prev-img').src!==u)$('#prev-img').src=u;$('#prev-t').textContent=clock(t);if(dragging){$('#pl').style.width=x*100+'%';$('#kn').style.left=x*100+'%'}});
$('#scrub').addEventListener('mousedown',e=>{dragging=true;const up=ev=>{dragging=false;removeEventListener('mouseup',up);if(W.eng){W.eng.seek(sx(ev)*W.eng.duration)}};addEventListener('mouseup',up)});
$('#scrub').addEventListener('touchend',e=>{const t=e.changedTouches[0];if(W.eng)W.eng.seek(sx(t)*W.eng.duration)});
const toggle=()=>{if(!W.eng)return;W.eng.paused?W.eng.play():W.eng.pause()};
$('#c-play').onclick=toggle;$('#w-big').onclick=toggle;$('#stage').addEventListener('dblclick',e=>{if(!e.target.closest('.w-bot,.w-top'))fs()});
$('#stage').addEventListener('click',e=>{if(e.target.tagName==='VIDEO')toggle()});
$('#c-back').onclick=()=>W.eng&&W.eng.seek(Math.max(0,W.eng.time-10));$('#c-fwd').onclick=()=>W.eng&&W.eng.seek(Math.min(W.eng.duration-1,W.eng.time+30));
function syncVol(){$('#c-vol').value=W.muted?0:W.vol;$('#c-mute').textContent=W.muted||W.vol===0?'🔇':'🔊'}
$('#c-vol').oninput=e=>{W.vol=+e.target.value;W.muted=W.vol===0;store.set('vol',W.vol);W.eng?.setVolume(W.vol,W.muted);syncVol()};
$('#c-mute').onclick=()=>{W.muted=!W.muted;W.eng?.setVolume(W.vol,W.muted);syncVol()};
$('#c-cc').onclick=()=>{W.cc=!W.cc;store.set('cc',W.cc);$('#c-cc').setAttribute('aria-pressed',String(W.cc))};
$('#c-tx').onclick=()=>{const on=!$('#watch').classList.contains('tx-open');$('#watch').classList.toggle('tx-open',on);store.set('tx',on);$('#c-tx').setAttribute('aria-pressed',String(on))};
const fs=()=>{document.fullscreenElement?document.exitFullscreen():$('#watch').requestFullscreen?.()};$('#c-fs').onclick=fs;
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),1800)}
$('#c-share').onclick=()=>{if(!W.eng)return;const u=location.href.split('#')[0]+`#/watch/${W.d.id}?t=${Math.floor(W.eng.time)}`;(navigator.clipboard?.writeText(u)||Promise.reject()).then(()=>toast('Link to this moment copied'),()=>prompt('Copy this link',u))};
$('#w-retry').onclick=()=>{const d=W.d||{id:location.hash.split('/')[2]};const t=W.eng?.time;W.d=null;openWatch(d.id.split('?')[0],t)};
let navs=0;addEventListener('hashchange',()=>navs++);
$('#w-back').onclick=()=>{navs>0?history.back():location.hash='#/'};
function armIdle(){const s=$('#stage');s.classList.remove('idle');clearTimeout(W.idle);W.idle=setTimeout(()=>{if(W.eng&&!W.eng.paused)s.classList.add('idle')},3000)}
$('#stage').addEventListener('mousemove',armIdle);
addEventListener('keydown',e=>{if($('#watch').hidden||e.target.matches('input,select,textarea'))return;const k=e.key.toLowerCase();
 if(k===' '||k==='k'){e.preventDefault();toggle()}else if(k==='arrowleft'){W.eng?.seek(Math.max(0,W.eng.time-10))}else if(k==='arrowright'){W.eng?.seek(W.eng.time+30)}
 else if(k==='f')fs();else if(k==='c')$('#c-cc').click();else if(k==='t')$('#c-tx').click();else if(k==='m')$('#c-mute').click();else if(k==='escape'&&!document.fullscreenElement)$('#w-back').click();armIdle()});
async function nextOf(d){const s=dayKey(d.t0);let l=[];try{l=[...(await fetchDay(s)),...(await fetchDay(dayKey(d.t0+864e5)))]}catch(e){}
 return l.filter(x=>x.st===d.st&&x.t0>d.t0&&!x.replay).sort((a,b)=>a.t0-b.t0)[0]}
async function upNext(ended){if(!W.d)return;const cur=W.d;const n=await nextOf(cur);if(!n||W.d!==cur)return;const u=$('#upnext');let left=10;
 u.innerHTML=`<img src="${thumb(n,200)}" alt=""><div class="in"><small>UP NEXT ON ${ST[n.st][0].toUpperCase()}</small><h4>${esc(n.show)} · ${tf.format(n.t0)}</h4><div class="row2"><button class="b p" id="un-go">▶ Play${ended?` in <span id="un-c">${left}</span>`:''}</button><button class="b" id="un-x">Dismiss</button></div></div>`;u.hidden=false;
 $('#un-go').onclick=()=>location.hash='#/watch/'+n.id;$('#un-x').onclick=()=>{u.hidden=true;clearInterval(W.upTimer)};
 if(ended){clearInterval(W.upTimer);W.upTimer=setInterval(()=>{left--;const c=$('#un-c');if(c)c.textContent=left;if(left<=0){clearInterval(W.upTimer);location.hash='#/watch/'+n.id}},1000)}}


/* ---- Chromecast (free Default Media Receiver; see cast.js) ---- */
const castFacade={name:'cast',get time(){return NDCast.time()},get paused(){return !NDCast.player||NDCast.player.isPaused},get duration(){return W.job?W.job.duration:0},
 seek(t){NDCast.seek(t)},play(){if(this.paused)NDCast.toggle()},pause(){if(!this.paused)NDCast.toggle()},setVolume(v,m){NDCast.setVolume(v,m)},ranges(){return[]},destroy(){},load(){}};
function showCasting(on,dev){$('#casting').hidden=!on;if(dev)$('#cast-dev').textContent='Casting to '+dev;$('#w-big').hidden=true;$('#w-spin').hidden=true;$('#w-cc').hidden=on}
if(window.NDCast){
 NDCast.on.ready=()=>{$('#c-cast').style.display='inline-block'};
 NDCast.on.start=dev=>{showCasting(true,dev);$('#cast-st').textContent='Connecting…';if(!W.job||W.eng===castFacade)return;const t=W.eng.time;W.local=W.eng;W.local.pause();W.eng=castFacade;NDCast.load(W.job,t)};
 NDCast.on.end=t=>{showCasting(false);if(W.eng!==castFacade)return;W.eng=W.local;W.local=null;if(W.eng){W.eng.seek(t);W.eng.play()}toast('Back on this screen')};
 if(NDCast.ready)NDCast.on.ready();
 NDCast.on.status=m=>{$('#cast-st').textContent=m};
 NDCast.on.state=playing=>{$('#c-play').textContent=playing?'❚❚':'▶'};
}

/* ================= ROUTER ================= */
let lastView='';
function route(){const raw=location.hash.slice(2);const [path,qs]=raw.split('?');const parts=path.split('/').map(decodeURIComponent);const k=parts[0];
 if(k==='watch'&&parts[1]){const t=new URLSearchParams(qs||'').get('t');openWatch(parts[1],t!=null?+t:null);return}
 if(!$('#watch').hidden){stopWatch();W.d=null;$('#watch').hidden=true;document.body.classList.remove('watching');document.title='NewsDork';if(document.fullscreenElement)document.exitFullscreen()}
 const key=path;if(key===lastView&&(k==='net'||k==='show'||k==='search'))return;lastView=key;
 if(k==='net'&&ST[parts[1]]){HOME.hidden=true;VIEW.hidden=false;scrollTo(0,0);netView(parts[1])}
 else if(k==='show'&&ST[parts[1]]){HOME.hidden=true;VIEW.hidden=false;scrollTo(0,0);showView(parts[1],parts.slice(2).join('/'))}
 else if(k==='search'&&parts[1]){HOME.hidden=true;VIEW.hidden=false;scrollTo(0,0);searchView(parts[1])}
 else{lastView='';HOME.hidden=false;VIEW.hidden=true;listIO?.disconnect();drawCont();if(!booted&&!boot.started){boot.started=true;boot()}}}
addEventListener('hashchange',route);
if(location.hash.startsWith('#/watch/')){boot.started=true;boot()}
route();
addEventListener('pagehide',()=>{if(W.eng)saveProg(W.d,W.eng.time)});
})();
