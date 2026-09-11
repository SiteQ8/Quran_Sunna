/* أصوات الأذان، من مختارات الأذان في موقع إسلام ويب audio.islamweb.net، أُعيد
   ترميزها لتخفّ على الجهاز، ولكل صوت اسم قارئه وطوله. الفجر له أذانه الذي فيه
   الصلاة خير من النوم، فيُستعمل في الفجر وحده. */
var ADHAN_VOICES = [
  { id: 'assaf', n: 'ياسين العساف', s: 183 },
  { id: 'bilal', n: 'بلال محمود', s: 194 },
  { id: 'jazi', n: 'الشيخ محمد الجازي', s: 259 },
  { id: 'mujallad', n: 'أحمد نواف المجلاد', s: 167, fajr: true },
  { id: 'mukhtar', n: 'حاج سليمان مختار', s: 192, fajr: true }
];
var ADHAN_SOURCE = { u: 'https://audio.islamweb.net' };

/* أصوات الصلاة على النبي ﷺ. الأول تلاوة للقارئ خالد بوهندي من البحرين، بإذنه،
   وهو الصوت الذي يفتح به التطبيق. وما بعده من تسجيلات حصن المسلم في موقع
   الكتاب. ومن كان نصّه آية فمرجعه `q` سورةً وآيةً، يؤخذ من المصحف نفسه، ومن
   كان دعاءً فمرجعه `hisn` بابًا و`a` رقمًا في حصن المسلم. */
var SALAWAT_VOICES = [
  { id: 'buhendi', n: 'آية الصلاة على النبي ﷺ، بصوت خالد بوهندي', s: 27, q: [33, 56] },
  { id: 'ibrahimiyya', n: 'الصلاة الإبراهيمية', s: 37, hisn: 23, a: 53 },
  { id: 'azwaj', n: 'اللهم صلِّ على محمد وأزواجه وذريته', s: 24, hisn: 23, a: 54 },
  { id: 'fadl', n: 'من صلى عليّ صلاة صلى الله عليه بها عشراً', s: 9, hisn: 107, a: 219 }
];
var SALAWAT_SOURCE = { n: 'حصن المسلم', u: 'https://www.hisnmuslim.com' };
var SALAWAT_RECITER = { n: 'خالد بوهندي', w: 'البحرين' };
if (typeof module !== 'undefined') module.exports = { ADHAN_VOICES: ADHAN_VOICES, ADHAN_SOURCE: ADHAN_SOURCE, SALAWAT_VOICES: SALAWAT_VOICES, SALAWAT_SOURCE: SALAWAT_SOURCE, SALAWAT_RECITER: SALAWAT_RECITER };
