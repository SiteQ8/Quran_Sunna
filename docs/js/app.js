
// ═══ SETTINGS ═══
var fontSize = parseInt(localStorage.getItem('sunnati_fontSize') || '100');
var fsMult = fontSize / 100;
function setFS(v){fontSize=v;fsMult=v/100;localStorage.setItem('sunnati_fontSize',v);document.documentElement.style.setProperty('--fs',String(fsMult));document.getElementById('fsv').textContent=v+'%';document.getElementById('fsr').value=v}
document.documentElement.style.setProperty('--fs',String(fontSize/100));

// ═══ QURAN PROGRESS ═══
function getProgress(){try{return JSON.parse(localStorage.getItem('sunnati_quran_progress')||'{}')}catch(e){return {}}}
function saveProgress(surahNum){var p=getProgress();p.lastSurah=surahNum;p.lastDate=new Date().toISOString();p.completed=p.completed||[];if(p.completed.indexOf(surahNum)===-1)p.completed.push(surahNum);localStorage.setItem('sunnati_quran_progress',JSON.stringify(p));renderProgressBar()}
function renderProgressBar(){var p=getProgress();var done=p.completed?p.completed.length:0;var pct=Math.round(done/114*100);var el=document.getElementById('qprog');if(el)el.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:0 12px 10px"><div style="flex:1;height:6px;background:var(--s);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--g),#34d399);border-radius:3px"></div></div><span style="font-size:.6rem;color:var(--t3)">'+done+'/114 ('+pct+'%)</span></div>'}
function showKhatma(){var el=document.getElementById('khatma');if(el){el.style.display='flex';el.style.alignItems='center';el.style.justifyContent='center';setTimeout(function(){el.style.opacity='1'},50)}}
function hideKhatma(){var el=document.getElementById('khatma');if(el){el.style.opacity='0';setTimeout(function(){el.style.display='none'},300)}}

// ═══ NAV ═══
function nav(p){document.querySelectorAll('.pg').forEach(function(x){x.classList.remove('on')});document.querySelectorAll('.nv').forEach(function(x){x.classList.remove('on')});var pg=document.getElementById('pg-'+p);if(pg)pg.classList.add('on');var ni=document.querySelector('[data-p="'+p+'"]');if(ni)ni.classList.add('on');window.scrollTo(0,0)}
document.querySelectorAll('.nv').forEach(function(n){n.addEventListener('click',function(){nav(this.dataset.p)})});

// ═══ PRAYER TIMES ═══
var prayers=[],PN=['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'];
var PA={Fajr:'الفجر',Sunrise:'الشروق',Dhuhr:'الظهر',Asr:'العصر',Maghrib:'المغرب',Isha:'العشاء'};
var PC={Fajr:'#4a82c9',Sunrise:'#d68f2e',Dhuhr:'#d94f6b',Asr:'#7c52b5',Maghrib:'#d68f2e',Isha:'#1b7a45'};
var uLat=29.3759,uLng=47.9774;

// Current time sunnah
function gP(){var h=new Date().getHours();if(h<5)return 'isha';if(h<7)return 'fajr';if(h<11)return 'duha';if(h<14)return 'dhuhr';if(h<16)return 'asr';if(h<18)return 'maghrib';return 'isha'}
function rCS(){
  var p=gP(),d=CURRENT_SUNNAH[p];
  var lbl=document.getElementById('sp-lbl');
  if(lbl) lbl.textContent=d.sub;
  var el=document.getElementById('csn');if(!el)return;
  var colors=['var(--a1)','var(--a2)','var(--a3)','var(--a4)','var(--a5)','var(--a6)'];
  var icons=['⭐','📖','🤲','🕌','📿','💚'];
  var h='<div class="sn-scroll">';
  d.items.forEach(function(s,i){
    h+='<div class="sn-pill"><div class="sn-pill-top" style="background:'+colors[i%colors.length]+'"></div>';
    h+='<span class="sn-pill-icon">'+icons[i%icons.length]+'</span>';
    h+='<div class="sn-pill-txt">'+s+'</div>';
    h+='<div class="sn-pill-ref">'+d.l+'</div></div>';
  });
  h+='</div>';el.innerHTML=h;
  // Update section title
  var st=document.getElementById('sn-title');if(st)st.textContent=d.l;
}
rCS();

// Location
function rqL(){if(navigator.geolocation){navigator.geolocation.getCurrentPosition(function(p){uLat=p.coords.latitude;uLng=p.coords.longitude;document.getElementById('loc').textContent='\u{1F4CD} '+uLat.toFixed(2)+', '+uLng.toFixed(2);fetch('https://api.aladhan.com/v1/timings?latitude='+uLat+'&longitude='+uLng+'&method=9').then(function(r){return r.json()}).then(function(d){pP(d.data)}).catch(function(){fP()})},function(){fP()},{enableHighAccuracy:true,timeout:8000})}else fP()}
function fP(){document.getElementById('loc').textContent='\u{1F4CD} الكويت';fetch('https://api.aladhan.com/v1/timingsByCity?city=Kuwait&country=Kuwait&method=9').then(function(r){return r.json()}).then(function(d){pP(d.data)}).catch(function(){pPM({Fajr:'04:02',Sunrise:'05:22',Dhuhr:'11:52',Asr:'15:18',Maghrib:'18:22',Isha:'19:42'})})}
function pP(d){var t=d.timings,h=d.date.hijri;document.getElementById('hd').textContent=h.day+' '+h.month.ar+' '+h.year+' \u0647\u0640';if(d.meta&&d.meta.timezone){var z=d.meta.timezone.split('/');document.getElementById('loc').textContent='\u{1F4CD} '+z[z.length-1].replace(/_/g,' ')}pPM(t)}
function pPM(t){prayers=[];PN.forEach(function(n){var p=(t[n]||'00:00').split(':');prayers.push({n:n,ar:PA[n],h:parseInt(p[0]),m:parseInt(p[1]),ts:t[n],c:PC[n]})});rP();uC()}
function rP(){var now=new Date(),nm=now.getHours()*60+now.getMinutes(),ai=-1;for(var i=prayers.length-1;i>=0;i--){if(nm>=prayers[i].h*60+prayers[i].m){ai=i;break}}var h='';prayers.forEach(function(p,i){h+='<div class="pr'+(i===ai?' act':'')+'"><div class="prl"><div class="pd" style="background:'+p.c+'"></div><span class="pn">'+p.ar+'</span></div><span class="pt">'+p.ts+'</span></div>'});document.getElementById('pls').innerHTML=h}
function uC(){var n=new Date(),h=n.getHours(),m=n.getMinutes(),nm=h*60+m,np=null;for(var i=0;i<prayers.length;i++){if(prayers[i].h*60+prayers[i].m>nm){np=prayers[i];break}}if(!np&&prayers.length)np=prayers[0];if(np){document.getElementById('nn').textContent=np.ar;document.getElementById('nt').textContent=np.ts}setTimeout(uC,30000)}
rqL();

// Ayah of the day
(function(){var d=new Date().getDate(),s=Math.floor(d*114/31)+1,a=Math.floor(d*7/31)+1;fetch('https://api.alquran.cloud/v1/ayah/'+s+':'+a).then(function(r){return r.json()}).then(function(d){if(d.data){document.getElementById('ayd').textContent=d.data.text;document.getElementById('ayr').textContent=d.data.surah.name+' \u2014 \u0627\u0644\u0622\u064A\u0629 '+d.data.numberInSurah}}).catch(function(){document.getElementById('ayd').textContent='\u0627\u0644\u0652\u062D\u064E\u0645\u0652\u062F\u064F \u0644\u0650\u0644\u0651\u064E\u0647\u0650 \u0631\u064E\u0628\u0651\u0650 \u0627\u0644\u0652\u0639\u064E\u0627\u0644\u064E\u0645\u0650\u064A\u0646\u064E'})})();

// ═══ QURAN ═══
function rS(f){f=(f||'').trim();var p=getProgress();var h='';SURAHS.forEach(function(s){if(f&&s.ar.indexOf(f)===-1&&s.en.toLowerCase().indexOf(f.toLowerCase())===-1&&String(s.n).indexOf(f)===-1)return;var done=p.completed&&p.completed.indexOf(s.n)!==-1;var isLast=p.lastSurah===s.n;h+='<div class="sui'+(done?' sui-done':'')+'" onclick="oS('+s.n+')"><div class="sun'+(done?' sun-done':'')+'">'+s.n+'</div><div class="suinf"><div class="suar">'+s.ar+(isLast?' <span style="font-size:.5rem;background:#e8f5ee;color:var(--g);padding:1px 5px;border-radius:4px">\u0622\u062E\u0631 \u0642\u0631\u0627\u0621\u0629</span>':'')+'</div><div class="suen">'+s.en+'</div></div><div class="sum">'+s.ay+' \u0622\u064A\u0629 \u00B7 '+s.tp+(done?' \u2705':'')+'</div></div>'});document.getElementById('sl').innerHTML=h;renderProgressBar()}
rS();document.getElementById('qs').addEventListener('input',function(){rS(this.value)});

// Open surah — BISMILLAH FIX
function oS(n){document.getElementById('sl').style.display='none';document.getElementById('qs').style.display='none';var av=document.getElementById('av');av.style.display='block';var s=SURAHS.find(function(x){return x.n===n});
av.innerHTML='<div class="avb" onclick="cS()">\u2190 \u0627\u0644\u0639\u0648\u062F\u0629</div><div class="avh"><h2>'+s.ar+'</h2><p>'+s.en+' \u00B7 '+s.ay+' \u0622\u064A\u0629</p></div><div style="text-align:center;padding:20px;color:var(--t3)"><div class="spinner"></div>\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0645\u064A\u0644...</div>';
fetch('https://api.alquran.cloud/v1/surah/'+n).then(function(r){return r.json()}).then(function(d){
if(!d.data||!d.data.ayahs)return;var ayahs=d.data.ayahs;
var t='<div class="avb" onclick="cS()">\u2190 \u0627\u0644\u0639\u0648\u062F\u0629</div><div class="avh"><h2>'+s.ar+'</h2><p>'+s.en+' \u00B7 '+s.ay+' \u0622\u064A\u0629</p></div>';
if(n!==1&&n!==9)t+='<div class="bsm">\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0651\u064E\u0647\u0650 \u0627\u0644\u0631\u0651\u064E\u062D\u0652\u0645\u064E\u0640\u0670\u0646\u0650 \u0627\u0644\u0631\u0651\u064E\u062D\u0650\u064A\u0645\u0650</div>';
t+='<div class="quran-page">';
ayahs.forEach(function(a,i){
var txt=a.text;
if(i===0&&n!==1&&n!==9){
  txt=txt.replace(/^[^\s]*\u0628\u0650\u0633[^\s]*\s+[^\s]*\u0644\u0644\u0651\u064E[^\s]*\s+[^\s]*\u062D\u0652\u0645[^\s]*\s+[^\s]*\u062D\u0650[\u06CC\u064A]\u0645\u0650\s*/,'');
  if(!txt.trim())txt=a.text;
}
txt=txt.trim();if(txt)t+=txt+' <span class="ayn-mushaf">\u06DD'+toAr(a.numberInSurah)+' </span> '});
t+='</div>';
// Save progress button
t+='<div style="text-align:center;padding:16px 12px"><button onclick="saveProgress('+n+')" style="padding:10px 24px;border-radius:12px;background:var(--g);color:#fff;border:none;font-size:.82rem;font-weight:700;cursor:pointer;font-family:var(--am)">\u2714 \u062D\u0641\u0638 \u0627\u0644\u062A\u0642\u062F\u0645</button></div>';
// Khatma dua if surah 114
if(n===114)t+='<div style="text-align:center;padding:20px"><button onclick="showKhatma()" style="padding:12px 30px;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#eab308);color:#fff;border:none;font-size:.95rem;font-weight:800;cursor:pointer;font-family:var(--am);box-shadow:0 4px 16px rgba(245,158,11,.3)">\u{1F31F} \u062F\u0639\u0627\u0621 \u062E\u062A\u0645\u0629 \u0627\u0644\u0642\u0631\u0622\u0646</button></div>';
av.innerHTML=t
}).catch(function(){av.innerHTML='<div class="avb" onclick="cS()">\u2190</div><div style="text-align:center;padding:30px;color:var(--t3)">\u26A0\uFE0F \u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u0645\u064A\u0644</div>'})}
function toAr(n){return String(n).replace(/[0-9]/g,function(d){return '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'[d]})}
function cS(){document.getElementById('sl').style.display='';document.getElementById('qs').style.display='';document.getElementById('av').style.display='none'}

// ═══ AZKAR ═══
function shAz(k){var data=AZKAR_DB[k];if(!data)return;document.getElementById('azg').style.display='none';var el=document.getElementById('azc');el.style.display='block';
var h='<div style="display:flex;align-items:center;justify-content:space-between;padding:0 12px 10px"><span onclick="hAz()" style="cursor:pointer;color:var(--g);font-weight:600;font-size:.82rem">\u2192 \u0631\u062C\u0648\u0639</span><span style="font-family:var(--am);font-size:1.1rem;color:var(--g);font-weight:700">'+data.title+'</span><span style="font-size:.6rem;color:var(--t3)">'+data.items.length+'</span></div>';
if(k==='names'){h+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:0 10px">';data.items.forEach(function(d,i){h+='<div style="background:var(--s);border-radius:11px;padding:12px 6px;text-align:center;box-shadow:var(--sh)"><div style="font-family:var(--nk);font-size:.85rem;color:var(--g);font-weight:600">'+d.t+'</div><div style="font-size:.48rem;color:var(--t3);margin-top:1px">'+(i+1)+'</div></div>'});h+='</div>'}
else{data.items.forEach(function(d){h+='<div class="di"><div class="di-t">'+d.t+'</div><div class="di-r">'+d.r+'</div>';if(d.c>1)h+='<div class="di-c"><button class="di-b" onclick="dD(this)">\u2212</button><div><div class="di-n">'+d.c+'</div><div style="font-size:.52rem;color:var(--t3)">/ '+d.c+'</div></div></div>';h+='</div>'})}
el.innerHTML=h}
function hAz(){document.getElementById('azg').style.display='';document.getElementById('azc').style.display='none'}
function dD(b){var n=b.parentElement.querySelector('.di-n');var v=parseInt(n.textContent);if(v>0){n.textContent=v-1;if(v-1===0){n.style.color='var(--a1)';b.closest('.di').style.opacity='.3'}if(navigator.vibrate)navigator.vibrate(12)}}

// ═══ HADITH ═══
(function(){var h='',cls=['var(--a1)','var(--a2)','var(--a3)','var(--a4)','var(--a5)','var(--a6)'];
HADITHS.forEach(function(d,i){h+='<div class="cd" style="margin:0 10px 8px"><div class="cd-br" style="background:'+cls[i%cls.length]+'"></div><div style="font-family:var(--nk);font-size:.98rem;line-height:2;text-align:center;margin-bottom:6px">\u00AB'+d.t+'\u00BB</div><div style="font-size:.6rem;color:var(--t3);text-align:center">'+d.s+' \u2014 '+d.r+'</div></div>'});
document.getElementById('hdl').innerHTML=h})();

// ═══ RUQYAH ═══
(function(){var h='',cls=['var(--a1)','var(--a6)','var(--a3)','var(--a4)','var(--a5)'];
RUQYAH.forEach(function(d,i){h+='<div class="di"><div style="position:absolute;top:0;left:0;right:0;height:3px;background:'+cls[i%cls.length]+'"></div><div class="di-t">'+d.t+'</div><div class="di-r">'+d.r+'</div></div>'});
document.getElementById('rql').innerHTML=h})();

// ═══ DUAS ═══
(function(){var h='',cls=['var(--a1)','var(--a5)','var(--a2)'];
DUAS.forEach(function(cat,ci){h+='<div style="padding:0 12px;margin-bottom:6px"><div style="font-weight:700;font-size:.88rem;color:var(--g);margin-bottom:8px">'+cat.cat+'</div></div>';
cat.items.forEach(function(d){h+='<div class="di"><div style="position:absolute;top:0;left:0;right:0;height:3px;background:'+cls[ci%cls.length]+'"></div><div class="di-t">'+d.t+'</div><div class="di-r">'+d.r+'</div></div>'})});
document.getElementById('dul').innerHTML=h})();

// ═══ SUNNAH TRACKER ═══
function rSn(){var td=new Date().toDateString(),sv={};try{var s=localStorage.getItem('sn_'+td);if(s)sv=JSON.parse(s)}catch(e){}var t=0,d=0,h='';
SUNNAH_TRACKER.forEach(function(sec,si){h+='<div class="sn-s"><div class="sn-st">'+sec.s+'</div>';sec.i.forEach(function(item,ii){var k=si+'_'+ii,dn=sv[k]||false;if(dn)d++;t++;h+='<div class="sni'+(dn?' dn':'')+'" onclick="tS(this,\''+k+'\')"><div class="snc">'+(dn?'\u2713':'')+'</div><div class="snt">'+item+'</div></div>'});h+='</div>'});
document.getElementById('snl').innerHTML=h;document.getElementById('sd').textContent=d;document.getElementById('st2').textContent=t;var p=t?Math.round(d/t*100):0;document.getElementById('sp').textContent=p+'%';document.getElementById('sb').style.width=p+'%'}
function tS(el,k){el.classList.toggle('dn');var d=el.classList.contains('dn');el.querySelector('.snc').textContent=d?'\u2713':'';var td=new Date().toDateString(),sv={};try{var s=localStorage.getItem('sn_'+td);if(s)sv=JSON.parse(s)}catch(e){}sv[k]=d;try{localStorage.setItem('sn_'+td,JSON.stringify(sv))}catch(e){}var dc=document.querySelectorAll('.sni.dn').length,tc=document.querySelectorAll('.sni').length;document.getElementById('sd').textContent=dc;var p=tc?Math.round(dc/tc*100):0;document.getElementById('sp').textContent=p+'%';document.getElementById('sb').style.width=p+'%';if(navigator.vibrate)navigator.vibrate(10)}
rSn();

// ═══ TASBIH ═══
function tbT(){var el=document.getElementById('tc');el.textContent=parseInt(el.textContent)+1;if(navigator.vibrate)navigator.vibrate(8)}
function tbS(b,l){document.querySelectorAll('.tbpi').forEach(function(p){p.classList.remove('on')});b.classList.add('on');document.getElementById('tl').textContent=l;document.getElementById('tc').textContent='0'}

// ═══ QIBLA (location-based) ═══
function calcQibla(){var mL=21.4225*Math.PI/180,mN=39.8262*Math.PI/180,uL=uLat*Math.PI/180,uN=uLng*Math.PI/180;var qA=(Math.atan2(Math.sin(mN-uN),Math.cos(uL)*Math.tan(mL)-Math.sin(uL)*Math.cos(mN-uN))*180/Math.PI+360)%360;document.getElementById('qd').textContent=Math.round(qA)+'\u00B0';
if(window.DeviceOrientationEvent){window.removeEventListener('deviceorientation',window._qH);window._qH=function(e){if(e.alpha!==null){var h=e.alpha;if(typeof e.webkitCompassHeading==='number')h=e.webkitCompassHeading;document.getElementById('qr').style.transform='rotate('+(-(h-qA))+'deg)'}};window.addEventListener('deviceorientation',window._qH)}
return qA}
var qA=calcQibla();
// Recalc after location update
var _origRqL=rqL;rqL=function(){_origRqL();setTimeout(function(){qA=calcQibla()},2000)}

// Init progress
setTimeout(function(){renderProgressBar();rS()},500);
