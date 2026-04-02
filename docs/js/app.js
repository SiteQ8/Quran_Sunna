
// ═══ SETTINGS ═══
var fontSize = parseInt(localStorage.getItem('sunnati_fontSize') || '100');
var fsMult = fontSize / 100;
function setFS(v){
  fontSize=v;fsMult=v/100;localStorage.setItem('sunnati_fontSize',v);
  document.documentElement.style.setProperty('--fs',String(fsMult));
  // Apply to ALL text elements including tasbih
  var sel='.quran-page,.ayt,.di-t,.cd,.khatma-dua,.tbn,.tbl,.tbpi,.sni .sn-t,.di-r';
  document.querySelectorAll(sel).forEach(function(el){
    var orig=el.getAttribute('data-base-fs');
    if(!orig){orig=parseFloat(getComputedStyle(el).fontSize);el.setAttribute('data-base-fs',orig)}
    el.style.fontSize=(orig*fsMult)+'px';
  });
  var prev=document.getElementById('fs-preview');
  if(prev)prev.style.fontSize=(fsMult*1.1)+'rem';
  var fsv=document.getElementById('fsv');if(fsv)fsv.textContent=v+'%';
  var fsr=document.getElementById('fsr');if(fsr)fsr.value=v;
}
document.documentElement.style.setProperty('--fs',String(fontSize/100));

// ═══ QURAN PROGRESS ═══
function getProgress(){try{return JSON.parse(localStorage.getItem('sunnati_quran_progress')||'{}')}catch(e){return {}}}
function saveProgress(surahNum,ayahNum){
  var p=getProgress();p.lastSurah=surahNum;p.lastDate=new Date().toISOString();
  p.completed=p.completed||[];p.ayahs=p.ayahs||{};
  if(ayahNum){
    if(!p.ayahs[surahNum])p.ayahs[surahNum]=[];
    if(p.ayahs[surahNum].indexOf(ayahNum)===-1)p.ayahs[surahNum].push(ayahNum);
    p.lastAyah=ayahNum;
    // If all ayahs of surah are read, mark surah complete
    var s=SURAHS.find(function(x){return x.n===surahNum});
    if(s&&p.ayahs[surahNum].length>=s.ay&&p.completed.indexOf(surahNum)===-1)p.completed.push(surahNum);
  }else{
    if(p.completed.indexOf(surahNum)===-1)p.completed.push(surahNum);
  }
  localStorage.setItem('sunnati_quran_progress',JSON.stringify(p));renderProgressBar();
}
function renderProgressBar(){
  var p=getProgress();var done=p.completed?p.completed.length:0;var pct=Math.round(done/114*100);
  var totalAyahs=0;if(p.ayahs){for(var k in p.ayahs)totalAyahs+=p.ayahs[k].length}
  var info=done+'/114 \u0633\u0648\u0631\u0629 ('+pct+'%)';
  if(totalAyahs>0)info+=' \u00B7 '+totalAyahs+' \u0622\u064A\u0629';
  if(p.lastSurah){var ls=SURAHS.find(function(x){return x.n===p.lastSurah});if(ls)info+=' \u00B7 \u0622\u062E\u0631: '+ls.ar}
  var el=document.getElementById('qprog');
  if(el)el.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:0 12px 10px"><div style="flex:1;height:6px;background:var(--s);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--g),#34d399);border-radius:3px"></div></div><span style="font-size:.55rem;color:var(--t3)">'+info+'</span></div>';
  var el2=document.getElementById('qprog2');if(el2)el2.innerHTML=el.innerHTML;
}
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
function gP(){
  var now=new Date(),nm=now.getHours()*60+now.getMinutes();
  if(!prayers||!prayers.length) return _gPFallback();
  var fajr=prayers[0],sunrise=prayers[1],dhuhr=prayers[2],asr=prayers[3],maghrib=prayers[4],isha=prayers[5];
  var fM=fajr.h*60+fajr.m, srM=sunrise.h*60+sunrise.m, dhM=dhuhr.h*60+dhuhr.m;
  var asM=asr.h*60+asr.m, mgM=maghrib.h*60+maghrib.m, isM=isha.h*60+isha.m;
  if(nm<fM) return 'isha';
  if(nm<srM) return 'fajr';
  if(nm<dhM) return 'duha';
  if(nm<asM) return 'dhuhr';
  if(nm<mgM) return 'asr';
  if(nm<isM) return 'maghrib';
  return 'isha';
}
function _gPFallback(){var h=new Date().getHours();if(h<5)return 'isha';if(h<7)return 'fajr';if(h<11)return 'duha';if(h<14)return 'dhuhr';if(h<16)return 'asr';if(h<18)return 'maghrib';return 'isha'}
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
function pPM(t){prayers=[];PN.forEach(function(n){var p=(t[n]||'00:00').split(':');prayers.push({n:n,ar:PA[n],h:parseInt(p[0]),m:parseInt(p[1]),ts:t[n],c:PC[n]})});rP();uC();rCS()}
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
var prog=getProgress();
var t='<div class="avb" onclick="cS()">\u2190 \u0627\u0644\u0639\u0648\u062F\u0629</div><div class="avh"><h2>'+s.ar+'</h2>';
// Audio + Virtue
t+='<div style="display:flex;gap:6px;padding:6px 12px;justify-content:center;flex-wrap:wrap;align-items:center"><button onclick="playQuranAudio('+n+')" style="padding:6px 14px;border-radius:8px;background:var(--g);color:#fff;border:none;font-size:.72rem;cursor:pointer;font-family:var(--am)">🎧 \u0627\u0633\u062A\u0645\u0639</button><select onchange="currentReciter=parseInt(this.value);playQuranAudio('+n+')" style="padding:5px 8px;border-radius:8px;border:1px solid var(--bd);font-size:.62rem;font-family:var(--am);background:var(--s);max-width:160px">';
RECITERS.forEach(function(r,i){t+='<option value="'+i+'"'+(i===currentReciter?' selected':'')+'>'+r.flag+' '+r.name+'</option>'});
t+='</select></div>';
if(SURAH_VIRTUES[n])t+='<div style="background:var(--gl);border-radius:10px;padding:10px;margin:4px 12px 8px;font-size:.68rem;color:var(--g);text-align:center;border:1px solid var(--bd)">\u2728 '+SURAH_VIRTUES[n]+'</div>';
if(n!==1&&n!==9)t+='<div class="bsm">\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0651\u064E\u0647\u0650 \u0627\u0644\u0631\u0651\u064E\u062D\u0652\u0645\u064E\u0640\u0670\u0646\u0650 \u0627\u0644\u0631\u0651\u064E\u062D\u0650\u064A\u0645\u0650</div>';
t+='<div class="quran-page">';
ayahs.forEach(function(a,i){
var txt=a.text;
if(i===0&&n!==1&&n!==9){
  txt=txt.replace(/^[^\s]*\u0628\u0650\u0633[^\s]*\s+[^\s]*\u0644\u0644\u0651\u064E[^\s]*\s+[^\s]*\u062D\u0652\u0645[^\s]*\s+[^\s]*\u062D\u0650[\u06CC\u064A]\u0645\u0650\s*/,'');
  if(!txt.trim())txt=a.text;
}
txt=txt.trim();if(txt){
var ayahRead=prog.ayahs&&prog.ayahs[n]&&prog.ayahs[n].indexOf(a.numberInSurah)!==-1;
t+=txt+' <span class="ayn-mushaf" style="'+(ayahRead?'color:#10b981;font-weight:900':'')+'" onclick="event.stopPropagation();saveProgress('+n+','+a.numberInSurah+');this.style.color=\'#10b981\';this.style.fontWeight=\'900\'" title="\u062D\u0641\u0638 \u0627\u0644\u0622\u064A\u0629">\u06DD'+toAr(a.numberInSurah)+' </span> '}});
t+='</div>';
// Save progress button
t+='<div style="text-align:center;padding:16px 12px"><button onclick="saveProgress('+n+')" style="padding:10px 24px;border-radius:12px;background:var(--g);color:#fff;border:none;font-size:.82rem;font-weight:700;cursor:pointer;font-family:var(--am)">\u2714 \u062D\u0641\u0638 \u0627\u0644\u0633\u0648\u0631\u0629 \u0643\u0627\u0645\u0644\u0629</button></div>';
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
function tbAdd(){
  var txt=prompt('أدخل الذكر المخصص:');
  if(txt&&txt.trim()){
    var pool=document.getElementById('tb-pool');
    if(pool){
      var d=document.createElement('div');d.className='tbpi';
      d.textContent=txt.trim();
      d.onclick=function(){tbS(this,txt.trim())};
      pool.appendChild(d);
    }
  }
}
function tbS(b,l){document.querySelectorAll('.tbpi').forEach(function(p){p.classList.remove('on')});b.classList.add('on');document.getElementById('tl').textContent=l;document.getElementById('tc').textContent='0'}

// ═══ QIBLA (location-based) ═══
function calcQibla(){
  var mL=21.4225*Math.PI/180,mN=39.8262*Math.PI/180;
  var uL=uLat*Math.PI/180,uN=uLng*Math.PI/180;
  var qA=(Math.atan2(Math.sin(mN-uN),Math.cos(uL)*Math.tan(mL)-Math.sin(uL)*Math.cos(mN-uN))*180/Math.PI+360)%360;
  var el=document.getElementById('qd');
  if(el)el.textContent=Math.round(qA)+'\u00B0 '+(qA>180?'\u2190':'\u2192');
  var loc=document.getElementById('qloc');
  if(loc)loc.textContent='\u{1F4CD} '+uLat.toFixed(4)+', '+uLng.toFixed(4);
  window._qiblaAngle=qA;
  return qA;
}
function initCompass(){
  function handler(e){
    var heading=e.alpha;
    if(typeof e.webkitCompassHeading==='number')heading=e.webkitCompassHeading;
    if(heading===null||heading===undefined)return;
    var qA=window._qiblaAngle||calcQibla();
    var rot=qA-heading;
    var rEl=document.getElementById('qr');
    if(rEl)rEl.style.transform='rotate('+rot+'deg)';
  }
  if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
    var btn=document.getElementById('qibla-perm');
    if(btn){btn.style.display='block';btn.onclick=function(){
      DeviceOrientationEvent.requestPermission().then(function(r){
        if(r==='granted'){window.addEventListener('deviceorientationabsolute',handler,true);window.addEventListener('deviceorientation',handler);btn.textContent='\u2705 \u062A\u0645 \u0627\u0644\u062A\u0641\u0639\u064A\u0644';btn.disabled=true}
      }).catch(function(e){alert('\u062A\u0639\u0630\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0644\u0644\u0628\u0648\u0635\u0644\u0629')})}}
  }else{
    window.addEventListener('deviceorientationabsolute',handler,true);
    window.addEventListener('deviceorientation',handler);
  }
}
function refreshQiblaLocation(){
  if(!navigator.geolocation)return;
  var btn=document.getElementById('qloc-btn');
  if(btn)btn.textContent='\u23F3 \u062C\u0627\u0631\u064A...';
  navigator.geolocation.getCurrentPosition(function(p){
    uLat=p.coords.latitude;uLng=p.coords.longitude;
    calcQibla();
    if(btn)btn.textContent='\u2705 \u062A\u0645 \u0627\u0644\u062A\u062D\u062F\u064A\u062B';
    setTimeout(function(){if(btn)btn.textContent='\u{1F4CD} \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0648\u0642\u0639'},2000);
  },function(){if(btn)btn.textContent='\u274C \u062A\u0639\u0630\u0631'},{enableHighAccuracy:true,timeout:10000});
}
var qA=calcQibla();initCompass();
var _origRqL=rqL;rqL=function(){_origRqL();setTimeout(function(){qA=calcQibla()},2000)}

// Init progress
setTimeout(function(){renderProgressBar();rS()},500);

// ═══ QURAN RADIO ═══
var RADIO_STATIONS=[
{name:'القرآن الكريم — السعودية',url:'https://Qurango.net/radio/tarateel',flag:'🇸🇦'},
{name:'قرآن كريم — ترتيل',url:'https://Qurango.net/radio/tarateel',flag:'📖'},
{name:'عبدالرحمن السديس',url:'https://Qurango.net/radio/sudais',flag:'🕌'},
{name:'عبدالباسط عبدالصمد',url:'https://Qurango.net/radio/abdulbasit',flag:'🎧'},
{name:'ماهر المعيقلي',url:'https://Qurango.net/radio/maher',flag:'🎙️'},
{name:'مشاري العفاسي',url:'https://Qurango.net/radio/afasy',flag:'🇰🇼'},
{name:'سعود الشريم',url:'https://Qurango.net/radio/shuraim',flag:'🕋'},
{name:'أحمد العجمي',url:'https://Qurango.net/radio/ajamy',flag:'🌙'},
{name:'ياسر الدوسري',url:'https://Qurango.net/radio/yasser',flag:'⭐'},
{name:'هزاع البلوشي',url:'https://Qurango.net/radio/hazza',flag:'🤲'}
];
var radioAudio=null;var radioPlaying=-1;
function playRadio(idx){
  if(radioPlaying===idx){stopRadio();return}
  stopRadio();
  radioAudio=new Audio(RADIO_STATIONS[idx].url);
  radioAudio.play().catch(function(){});
  radioPlaying=idx;
  renderRadioList();
}
function stopRadio(){
  if(radioAudio){radioAudio.pause();radioAudio.src='';radioAudio=null}
  radioPlaying=-1;
  renderRadioList();
}
function renderRadioList(){
  var el=document.getElementById('radio-list');if(!el)return;
  var h='';
  RADIO_STATIONS.forEach(function(s,i){
    var playing=radioPlaying===i;
    h+='<div onclick="playRadio('+i+')" style="display:flex;align-items:center;gap:10px;padding:12px;background:'+(playing?'var(--g)10':'var(--s)')+';border-radius:12px;margin-bottom:6px;cursor:pointer;border:1px solid '+(playing?'var(--g)':'var(--bd)')+'"><span style="font-size:1.3rem">'+s.flag+'</span><div style="flex:1"><div style="font-family:var(--am);font-size:.82rem;font-weight:700;color:'+(playing?'var(--g)':'var(--tx)')+'">'+s.name+'</div></div><div style="width:32px;height:32px;border-radius:50%;background:'+(playing?'var(--g)':'var(--bd)')+';display:flex;align-items:center;justify-content:center;font-size:.9rem;color:#fff">'+(playing?'⏸':'▶')+'</div></div>';
  });
  el.innerHTML=h;
}

// ═══════════════════════════════════════════════════════
// NEW FEATURES — v3.0 UPGRADE
// ═══════════════════════════════════════════════════════

// ═══ 1. SLEEP TIMER ═══
var sleepTimer=null;var sleepRemaining=0;
function startSleep(mins){
  clearInterval(sleepTimer);
  sleepRemaining=mins*60;
  document.getElementById('sleep-display').style.display='block';
  updateSleepDisplay();
  sleepTimer=setInterval(function(){
    sleepRemaining--;
    updateSleepDisplay();
    if(sleepRemaining<=0){
      clearInterval(sleepTimer);sleepTimer=null;
      if(radioAudio){radioAudio.pause();radioAudio.src='';radioAudio=null;radioPlaying=-1}
      document.querySelectorAll('audio').forEach(function(a){a.pause()});
      document.getElementById('sleep-display').style.display='none';
      alert('⏰ انتهى مؤقت النوم');
    }
  },1000);
}
function cancelSleep(){clearInterval(sleepTimer);sleepTimer=null;sleepRemaining=0;var el=document.getElementById('sleep-display');if(el)el.style.display='none'}
function updateSleepDisplay(){var m=Math.floor(sleepRemaining/60),s=sleepRemaining%60;var el=document.getElementById('sleep-time');if(el)el.textContent=m+':'+(s<10?'0':'')+s}

// ═══ 2. QURAN AUDIO PLAYER ═══
var quranAudio=null;var quranPlaying=false;
var RECITERS=[
  {id:'ar.alafasy',name:'مشاري العفاسي',flag:'🇰🇼',country:'الكويت'},
  {id:'ar.abdulbasitmurattal',name:'عبدالباسط عبدالصمد — مرتل',flag:'🇪🇬',country:'مصر'},
  {id:'ar.abdurrahmaansudais',name:'عبدالرحمن السديس',flag:'🇸🇦',country:'السعودية'},
  {id:'ar.husary',name:'محمود خليل الحصري',flag:'🇪🇬',country:'مصر'},
  {id:'ar.minshawi',name:'محمد صديق المنشاوي',flag:'🇪🇬',country:'مصر'},
  {id:'ar.maaboreen',name:'ماهر المعيقلي',flag:'🇸🇦',country:'السعودية'},
  {id:'ar.parhizgar',name:'شيرزاد عبدالرحمن طاهر',flag:'🇮🇶',country:'العراق'},
  {id:'ar.ibrahimakhbar',name:'إبراهيم الأخضر',flag:'🇸🇦',country:'السعودية'},
  {id:'ar.muhammadjibreel',name:'محمد جبريل',flag:'🇪🇬',country:'مصر'},
  {id:'ar.muhammadayyoub',name:'محمد أيوب',flag:'🇸🇦',country:'السعودية'},
  {id:'ar.saaboreen',name:'نبيل الرفاعي',flag:'🇰🇼',country:'الكويت'},
  {id:'ar.shaatree',name:'أبو بكر الشاطري',flag:'🇸🇦',country:'السعودية'},
  {id:'ar.ahmedajamy',name:'أحمد العجمي',flag:'🇰🇼',country:'الكويت'},
  {id:'ar.haboreen',name:'هاني الرفاعي',flag:'🇸🇦',country:'السعودية'},
  {id:'ar.yaboreen',name:'ياسر الدوسري',flag:'🇸🇦',country:'السعودية'}
];
var currentReciter=0;
function playQuranAudio(surahNum){
  var r=RECITERS[currentReciter];
  var url='https://cdn.islamic.network/quran/audio-surah/128/'+r.id+'/'+surahNum+'.mp3';
  if(quranAudio){quranAudio.pause();quranAudio=null}
  quranAudio=new Audio(url);
  quranAudio.play().catch(function(){});
  quranPlaying=true;
  var el=document.getElementById('quran-player');
  if(el)el.style.display='block';
  var s=SURAHS.find(function(x){return x.n===surahNum});
  var pn=document.getElementById('qp-name');if(pn)pn.textContent=s?s.ar:'';
  var pr=document.getElementById('qp-reciter');if(pr)pr.textContent=r.name;
  quranAudio.onended=function(){quranPlaying=false;var pe=document.getElementById('qp-btn');if(pe)pe.textContent='▶'};
}
function toggleQuranAudio(){
  if(!quranAudio)return;
  if(quranAudio.paused){quranAudio.play();document.getElementById('qp-btn').textContent='⏸'}
  else{quranAudio.pause();document.getElementById('qp-btn').textContent='▶'}
}
function stopQuranAudio(){if(quranAudio){quranAudio.pause();quranAudio.src='';quranAudio=null;quranPlaying=false}var el=document.getElementById('quran-player');if(el)el.style.display='none'}

// ═══ 3. PRAYER COUNTDOWN TIMER ═══
function updateCountdown(){
  if(!prayers||!prayers.length)return;
  var now=new Date(),nm=now.getHours()*60+now.getMinutes();
  var np=null;
  for(var i=0;i<prayers.length;i++){if(prayers[i].h*60+prayers[i].m>nm){np=prayers[i];break}}
  if(!np)np=prayers[0];
  var diff=(np.h*60+np.m)-nm;
  if(diff<0)diff+=24*60;
  var h=Math.floor(diff/60),m=diff%60;
  var el=document.getElementById('countdown');
  if(el)el.textContent=(h>0?h+' س ':'')+ m+' د';
  setTimeout(updateCountdown,30000);
}

// ═══ 4. DAILY WIRD (الورد اليومي) ═══
function getWird(){try{return JSON.parse(localStorage.getItem('sunnati_wird')||'{}')}catch(e){return {}}}
function saveWird(key){
  var w=getWird();var td=new Date().toDateString();
  if(!w[td])w[td]={};
  w[td][key]=true;
  localStorage.setItem('sunnati_wird',JSON.stringify(w));
  renderWird();
}
function renderWird(){
  var el=document.getElementById('wird-list');if(!el)return;
  var w=getWird();var td=new Date().toDateString();var today=w[td]||{};
  var items=[
    {k:'morning',i:'🌅',n:'أذكار الصباح'},
    {k:'evening',i:'🌆',n:'أذكار المساء'},
    {k:'quran',i:'📖',n:'قراءة القرآن'},
    {k:'fajr_s',i:'🕌',n:'سنة الفجر'},
    {k:'dhuhr_s',i:'☀️',n:'سنة الظهر'},
    {k:'asr_s',i:'🌤️',n:'سنة العصر'},
    {k:'maghrib_s',i:'🌅',n:'سنة المغرب'},
    {k:'isha_s',i:'🌙',n:'سنة العشاء'},
    {k:'duha',i:'☀️',n:'صلاة الضحى'},
    {k:'witr',i:'🤲',n:'صلاة الوتر'},
    {k:'salawat',i:'💚',n:'الصلاة على النبي ﷺ'},
    {k:'sadaqa',i:'💰',n:'صدقة اليوم'}
  ];
  var done=0;
  var h='';
  items.forEach(function(it){
    var isDone=today[it.k];
    if(isDone)done++;
    h+='<div class="wird-item'+(isDone?' wird-done':'')+'" onclick="saveWird(\''+it.k+'\')"><span class="wird-ico">'+it.i+'</span><span class="wird-name">'+it.n+'</span><span class="wird-check">'+(isDone?'✅':'○')+'</span></div>';
  });
  el.innerHTML=h;
  var pct=Math.round(done/items.length*100);
  var bar=document.getElementById('wird-bar');if(bar)bar.style.width=pct+'%';
  var lbl=document.getElementById('wird-pct');if(lbl)lbl.textContent=done+'/'+items.length+' ('+pct+'%)';
}

// ═══ 5. SURAH VIRTUES (فضائل السور) ═══
var SURAH_VIRTUES={
  1:'أم الكتاب وأعظم سورة في القرآن — لا صلاة لمن لم يقرأ بها',
  2:'سنام القرآن — تطرد الشيطان من البيت ٣ أيام',
  3:'تأتي يوم القيامة كغمامتين أو غيايتين تحاجان عن صاحبهما',
  18:'من قرأها يوم الجمعة أضاء له من النور ما بين الجمعتين',
  32:'كان النبي ﷺ لا ينام حتى يقرأ الم تنزيل السجدة وتبارك',
  36:'قلب القرآن — من قرأها ابتغاء وجه الله غُفر له',
  55:'عروس القرآن',
  56:'من قرأها كل ليلة لم تصبه فاقة أبداً',
  67:'المانعة من عذاب القبر — ثلاثون آية شفعت لصاحبها',
  112:'تعدل ثلث القرآن',
  113:'المعوذتان — أمر النبي ﷺ بهما في كل صباح ومساء',
  114:'المعوذتان — أمر النبي ﷺ بهما في كل صباح ومساء'
};

// ═══ 6. BLESSED DAYS CALENDAR ═══
var BLESSED_DAYS=[
  {name:'يوم عرفة',hijri:'9 ذو الحجة',desc:'صيامه يكفّر سنة ماضية وسنة قادمة'},
  {name:'يوم عاشوراء',hijri:'10 محرم',desc:'صيامه يكفّر سنة ماضية'},
  {name:'ليلة القدر',hijri:'27 رمضان',desc:'خير من ألف شهر'},
  {name:'أيام البيض',hijri:'13-15 من كل شهر',desc:'صيامها كصيام الدهر'},
  {name:'يوم الاثنين والخميس',hijri:'كل أسبوع',desc:'تُعرض الأعمال فيهما'},
  {name:'العشر من ذي الحجة',hijri:'1-10 ذو الحجة',desc:'أفضل أيام الدنيا'},
  {name:'الست من شوال',hijri:'1-6 شوال',desc:'كصيام الدهر مع رمضان'}
];

// ═══ 7. NIYYAH TRACKER (تجديد النية) ═══
function getNiyyah(){try{return JSON.parse(localStorage.getItem('sunnati_niyyah')||'[]')}catch(e){return []}}
function addNiyyah(text,cat){
  var list=getNiyyah();
  list.push({text:text,cat:cat,date:new Date().toISOString(),done:false});
  localStorage.setItem('sunnati_niyyah',JSON.stringify(list));
  renderNiyyah();
}
function toggleNiyyah(idx){
  var list=getNiyyah();
  if(list[idx])list[idx].done=!list[idx].done;
  localStorage.setItem('sunnati_niyyah',JSON.stringify(list));
  renderNiyyah();
}
function renderNiyyah(){
  var el=document.getElementById('niyyah-list');if(!el)return;
  var list=getNiyyah();
  if(!list.length){el.innerHTML='<div style="text-align:center;padding:30px;color:var(--t3)">لا توجد نوايا بعد — أضف نيتك الأولى</div>';return}
  var cats={'worship':'🕌 عبادة','knowledge':'📚 علم','family':'👨‍👩‍👧 أسرة','health':'💪 صحة','charity':'💰 صدقة','other':'💡 أخرى'};
  var h='';
  list.forEach(function(n,i){
    h+='<div class="niyyah-card'+(n.done?' niyyah-done':'')+'" onclick="toggleNiyyah('+i+')"><div class="niyyah-cat">'+(cats[n.cat]||'💡')+'</div><div class="niyyah-text">'+n.text+'</div><div class="niyyah-check">'+(n.done?'✅':'○')+'</div></div>';
  });
  el.innerHTML=h;
}

// ═══ 8. PROPHET'S DAY SCHEDULE ═══
var PROPHET_DAY=[
  {time:'قبل الفجر',items:['قيام الليل والتهجد','السحور والاستغفار بالأسحار','دعاء: اللهم اجعلني من التوابين']},
  {time:'الفجر',items:['سنة الفجر ركعتان','أذكار الصباح','الجلوس في المسجد حتى الشروق']},
  {time:'الضحى',items:['صلاة الضحى ركعتان إلى ثمان','الذهاب للعمل والتكسب الحلال','ذكر الله في الطريق']},
  {time:'الظهر',items:['٤ ركعات قبل الظهر و٢ بعدها','الإكثار من الصلاة على النبي ﷺ','القيلولة بعد الظهر']},
  {time:'العصر',items:['الذكر والاستغفار','صلاة العصر في أول وقتها','تلاوة القرآن']},
  {time:'المغرب',items:['الإفطار على تمر إن كان صائماً','ركعتين بعد المغرب','أذكار المساء']},
  {time:'العشاء',items:['صلاة العشاء في جماعة','سنة العشاء ركعتان','صلاة الوتر — ختام اليوم']}
];

// ═══ INIT NEW FEATURES ═══
setTimeout(function(){
  updateCountdown();
  renderWird();
  renderNiyyah();
},1000);

// ═══ GUIDED TOUR ═══
function showTour(){
  if(localStorage.getItem('sunnati_tour_done'))return;
  var steps=[
    {title:'\u{1F30D} \u0645\u0631\u062D\u0628\u0627\u064B \u0628\u0643 \u0641\u064A \u0633\u064F\u0646\u0651\u062A\u064A',text:'\u062A\u0637\u0628\u064A\u0642 \u0625\u0633\u0644\u0627\u0645\u064A \u0634\u0627\u0645\u0644 \u2014 \u0627\u0644\u0642\u0631\u0622\u0646 \u0648\u0627\u0644\u0623\u0630\u0643\u0627\u0631 \u0648\u0627\u0644\u0633\u0646\u0646 \u0648\u0623\u0643\u062B\u0631'},
    {title:'\u{1F4D6} \u0627\u0644\u0642\u0631\u0622\u0646 \u0627\u0644\u0643\u0631\u064A\u0645',text:'\u0627\u0642\u0631\u0623 \u0623\u064A \u0633\u0648\u0631\u0629 \u0628\u062A\u0635\u0645\u064A\u0645 \u0645\u0635\u062D\u0641\u064A \u2014 \u0627\u0633\u062A\u0645\u0639 \u0644\u0640\u0661\u0665 \u0642\u0627\u0631\u0626 \u2014 \u0627\u062D\u0641\u0638 \u062A\u0642\u062F\u0645\u0643 \u0622\u064A\u0629 \u0628\u0622\u064A\u0629'},
    {title:'\u{1F4FF} \u0627\u0644\u0623\u0630\u0643\u0627\u0631 \u0648\u0627\u0644\u0623\u062F\u0639\u064A\u0629',text:'\u0661\u0666 \u0642\u0633\u0645 \u0645\u0639 \u0639\u062F\u0627\u062F \u2014 \u0623\u0630\u0643\u0627\u0631 \u0627\u0644\u0635\u0628\u0627\u062D \u0648\u0627\u0644\u0645\u0633\u0627\u0621 \u2014 \u0627\u0644\u0631\u0642\u064A\u0629 \u0627\u0644\u0634\u0631\u0639\u064A\u0629'},
    {title:'\u2600\uFE0F \u0627\u0644\u0633\u0646\u0646 \u0627\u0644\u064A\u0648\u0645\u064A\u0629',text:'\u0633\u0646\u0646 \u0645\u0648\u0642\u0648\u062A\u0629 \u062D\u0633\u0628 \u0648\u0642\u062A \u0627\u0644\u0635\u0644\u0627\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u2014 \u0633\u062C\u0651\u0644 \u0625\u0646\u062C\u0627\u0632\u0643'},
    {title:'\u{1F4FB} \u0625\u0630\u0627\u0639\u0629 \u0627\u0644\u0642\u0631\u0622\u0646',text:'\u0661\u0660 \u0645\u062D\u0637\u0627\u062A \u0628\u062B \u0645\u0628\u0627\u0634\u0631 \u2014 \u0645\u0639 \u0645\u0624\u0642\u062A \u0627\u0644\u0646\u0648\u0645'},
    {title:'\u{1F3AF} \u0627\u0644\u0648\u0631\u062F \u0627\u0644\u064A\u0648\u0645\u064A',text:'\u062A\u062A\u0628\u0639 \u0661\u0662 \u0639\u0628\u0627\u062F\u0629 \u064A\u0648\u0645\u064A\u0629 \u2014 \u062A\u062C\u062F\u064A\u062F \u0627\u0644\u0646\u064A\u0629 \u2014 \u064A\u0648\u0645 \u0627\u0644\u0646\u0628\u064A \uFDFA'}
  ];
  var idx=0;
  function show(){
    var s=steps[idx];
    var overlay=document.getElementById('tour-overlay');
    if(!overlay){
      overlay=document.createElement('div');overlay.id='tour-overlay';
      overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML='<div style="background:#fff;border-radius:24px;padding:30px 24px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)">'
      +'<div style="font-size:2.5rem;margin-bottom:12px">'+s.title.split(' ')[0]+'</div>'
      +'<div style="font-family:var(--am);font-size:1.1rem;font-weight:800;color:var(--g);margin-bottom:8px">'+s.title+'</div>'
      +'<div style="font-family:var(--am);font-size:.82rem;color:var(--t2);line-height:1.8;margin-bottom:20px">'+s.text+'</div>'
      +'<div style="display:flex;gap:4px;justify-content:center;margin-bottom:14px">'+steps.map(function(_,i){return '<div style="width:8px;height:8px;border-radius:50%;background:'+(i===idx?'var(--g)':'var(--bd)')+'"></div>'}).join('')+'</div>'
      +'<div style="display:flex;gap:8px;justify-content:center">'
      +(idx>0?'<button onclick="tourPrev()" style="padding:8px 20px;border-radius:10px;background:var(--s);border:1px solid var(--bd);font-size:.78rem;cursor:pointer;font-family:var(--am)">\u2192 \u0627\u0644\u0633\u0627\u0628\u0642</button>':'')
      +'<button onclick="tourNext()" style="padding:8px 20px;border-radius:10px;background:var(--g);color:#fff;border:none;font-size:.78rem;cursor:pointer;font-family:var(--am);font-weight:700">'+(idx<steps.length-1?'\u0627\u0644\u062A\u0627\u0644\u064A \u2190':'\u{1F389} \u0627\u0628\u062F\u0623 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645')+'</button>'
      +'</div></div>';
  }
  window.tourNext=function(){idx++;if(idx>=steps.length){localStorage.setItem('sunnati_tour_done','1');var o=document.getElementById('tour-overlay');if(o)o.remove()}else show()};
  window.tourPrev=function(){if(idx>0){idx--;show()}};
  show();
}
setTimeout(showTour,500);

// ═══ SHARE ═══
function shareText(text){
  if(navigator.share){navigator.share({text:text}).catch(function(){})}
  else{navigator.clipboard.writeText(text).then(function(){alert('\u062A\u0645 \u0627\u0644\u0646\u0633\u062E!')}).catch(function(){})}
}

// ═══ STREAK (تتبع الالتزام) ═══
function getStreak(){
  try{var s=JSON.parse(localStorage.getItem('sunnati_streak')||'{}');return s}catch(e){return {}}
}
function updateStreak(){
  var s=getStreak();var today=new Date().toDateString();
  if(s.lastDay===today)return;
  var yesterday=new Date(Date.now()-86400000).toDateString();
  if(s.lastDay===yesterday){s.count=(s.count||0)+1}
  else if(s.lastDay!==today){s.count=1}
  s.lastDay=today;s.best=Math.max(s.best||0,s.count);
  localStorage.setItem('sunnati_streak',JSON.stringify(s));
  var el=document.getElementById('streak-count');
  if(el)el.textContent=s.count||0;
  var bel=document.getElementById('streak-best');
  if(bel)bel.textContent=s.best||0;
  var hel=document.getElementById('streak-home');
  if(hel)hel.textContent=s.count||0;
  var hbel=document.getElementById('streak-best-home');
  if(hbel)hbel.textContent=s.best||0;
}
setTimeout(updateStreak,2000);
