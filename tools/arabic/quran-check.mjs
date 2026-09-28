/* يقابل كل نصّ قرآني في ملفات الأذكار والأدعية بالمصحف الذي في التطبيق.

   النصوص في تلك الملفات إملائية والمصحف عثماني، فالمقابلة تُجري بعد تسوية ما
   يختلف فيه الرسمان وحده: الألف الخنجرية، وهمزة الواو والياء، والألف المقصورة
   والمربوطة. وما بقي بعد ذلك خطأ في النقل لا خلاف رسم.

     node tools/arabic/quran-check.mjs
*/
import fs from 'fs';

const m = JSON.parse(fs.readFileSync('docs/data/mushaf.json', 'utf8'));

/* ما يستوي في الرسمين يُسوّى، وما عداه يبقى على حاله ليُرى */
const norm = (t) => t.normalize('NFC')
  .replace(/[\u064B-\u065F\u06D6-\u06ED\u0640]/g, '')  // حركات ووقوف وتطويل
  .replace(/\u0670/g, '\u0627')                        // ألف خنجرية ألفاً
  /* الهمزة: المصحف يكتبها على السطر حيث يكتبها الإملاء على واو أو ياء أو ألف،
     فتُسقط صورتها كلها ويبقى موضعها، وإلا انكسرت الكلمة عن نظيرتها وظهر
     خلاف رسم في صورة خطأ نقل. */
  .replace(/[\u0622\u0623\u0625\u0624\u0626\u0671]/g, (c) => (c === '\u0624' || c === '\u0626' ? '' : '\u0627'))
  .replace(/\u0621/g, '')
  .replace(/\u0649/g, '\u064A').replace(/\u0629/g, '\u0647')
  .replace(/[^\u0621-\u064A ]/g, ' ').replace(/\s+/g, ' ').trim();

const verses = [];
m.a.forEach((sura, s) => sura.forEach((v, a) => verses.push([s + 1, a + 1, norm(v)])));

/* المصحف كلّه نصاً واحداً، فالمقطع قد يكون آية أو بعضها أو آيات متتابعة:
   البحث عنه في هذا النص يقبل الثلاثة، ولا يُجبره على أن يكون آية تامة. */
/* والألف تُسقط من الطرفين: الرسم العثماني يزيدها وينقصها في كلمات بعينها،
   «موليانا» و«ماوياهم» و«يستحيي»، ويرسم الألف المقصورة ياءً، وليس ذاك خطأ نقل
   بل وجهان لكلمة واحدة، فتُسقط الألف والياء معاً. ويكتب لام التعريف مدغمة في
   «ٱلَّيل» حيث يكتبها الإملاء لامين، فيُطوى الحرف المكرر كذلك. */
const bare = (t) => t.replace(/[\u0627\u064A]/g, '').replace(/(.)\1+/g, '');
const whole = ' ' + bare(verses.map((v) => v[2]).join(' ')) + ' ';

/* أين أول كلمة تخالف: تُبنى البداية كلمةً كلمةً حتى تنقطع من النص */
function firstDiff(n) {
  const w = bare(n).split(' ');
  let run = '';
  for (let k = 0; k < w.length; k++) {
    const next = run ? run + ' ' + w[k] : w[k];
    if (whole.indexOf(' ' + next + ' ') === -1 && whole.indexOf(' ' + next) === -1) {
      /* ما بعد هذه البداية في المصحف، ليُرى الصواب بجانب المكتوب */
      const at = whole.indexOf(' ' + run + ' ');
      const after = at === -1 ? '' : whole.slice(at + run.length + 2).split(' ')[0];
      return [k + 1, w[k], after];
    }
    run = next;
  }
  return null;
}

const files = ['docs/data/azkar.js', 'docs/data/hisn.js', 'docs/data/duas.js', 'docs/data/extras.js'];
let checked = 0;
const notes = [];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  for (const block of fs.readFileSync(f, 'utf8').matchAll(/﴿([^﴾]{12,})﴾/g)) {
    for (const part of block[1].split('*')) {
      const n = norm(part);
      if (n.split(' ').length < 3) continue;
      checked++;
      if (whole.indexOf(' ' + bare(n) + ' ') !== -1) continue;
      const d = firstDiff(n);
      if (!d) continue;
      notes.push([f, `الكلمة ${d[0]}`, `${d[1]} ← ${d[2] || '(ليست هنا)'}`, part.trim().slice(0, 50)]);
    }
  }
}

const real = notes;

console.log(`فُحص ${checked} مقطعاً قرآنياً في ${files.length} ملفات`);
console.log('فروق الرسم العثماني لا تُحسب: الألف تُسقط من الطرفين قبل المقابلة');
if (!real.length) { console.log('ولا خطأ نقل واحد'); process.exit(0); }
console.log(`\n${real.length} موضعاً يخالف المصحف في غير الرسم:\n`);
for (const [f, where, what, where2] of real) console.log(`  ${f.split('/').pop()}  ${where}:  ${what}\n      في: ${where2}`);
process.exit(1);
