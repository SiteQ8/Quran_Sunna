/* بيانات مساعدة للتطبيق: القرّاء والإذاعات والمدن والورد والمسبحة */

/* معرّفات القرّاء مأخوذة من فهرس alquran.cloud الصوتي، ومصدر الآيات يحفظ كل قارئ بالجودة التي سُجّل بها
   ويرفض ما سواها، فمن لم يُحفظ عنده بجودة 128 ذُكرت جودته بجانبه (kbps)، ومن لم تُذكر جودته فهو على 128،
   وea مجلّد القارئ نفسه بأسلوبه نفسه في everyayah.com، ومنه تُحفظ السورة للاستماع بلا إنترنت لأنه يأذن للتطبيق
   بقراءة ما يرسله، فيُحفظ كل ملف بحجمه الحقيقي ويُجزّأ للمشغّل كما يطلب */
var RECITERS = [
  { id: 'ar.abdulsamad', name: 'عبدالباسط عبدالصمد', country: 'مصر', kbps: 64, ea: 'AbdulSamad_64kbps_QuranExplorer.Com' },
  { id: 'ar.abdurrahmaansudais', name: 'عبدالرحمن السديس', country: 'السعودية', kbps: 64, ea: 'Abdurrahmaan_As-Sudais_64kbps' },
  { id: 'ar.mahermuaiqly', name: 'ماهر المعيقلي', country: 'السعودية', ea: 'Maher_AlMuaiqly_64kbps' },
  { id: 'ar.saoodshuraym', name: 'سعود الشريم', country: 'السعودية', kbps: 64, ea: 'Saood_ash-Shuraym_128kbps' },
  { id: 'ar.husary', name: 'محمود خليل الحصري', country: 'مصر', ea: 'Husary_128kbps' },
  { id: 'ar.husarymujawwad', name: 'محمود خليل الحصري بالمجوّد', country: 'مصر', ea: 'Husary_128kbps_Mujawwad' },
  { id: 'ar.minshawi', name: 'محمد صديق المنشاوي', country: 'مصر', ea: 'Minshawy_Murattal_128kbps' },
  { id: 'ar.shaatree', name: 'أبو بكر الشاطري', country: 'السعودية', ea: 'Abu_Bakr_Ash-Shaatree_128kbps' },
  { id: 'ar.ahmedajamy', name: 'أحمد بن علي العجمي', country: 'السعودية', ea: 'Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net' },
  { id: 'ar.hudhaify', name: 'علي الحذيفي', country: 'السعودية', ea: 'Hudhaify_128kbps' },
  { id: 'ar.hanirifai', name: 'هاني الرفاعي', country: 'السعودية', kbps: 64, ea: 'Hani_Rifai_64kbps' },
  { id: 'ar.ibrahimakhbar', name: 'إبراهيم الأخضر', country: 'السعودية', kbps: 32, ea: 'Ibrahim_Akhdar_32kbps' },
  { id: 'ar.muhammadayyoub', name: 'محمد أيوب', country: 'السعودية', ea: 'Muhammad_Ayyoub_64kbps' },
  { id: 'ar.muhammadjibreel', name: 'محمد جبريل', country: 'مصر', ea: 'Muhammad_Jibreel_64kbps' },
  { id: 'ar.abdullahbasfar', name: 'عبدالله بصفر', country: 'السعودية', kbps: 64, ea: 'Abdullah_Basfar_64kbps' },
  { id: 'ar.aymanswoaid', name: 'أيمن سويد', country: 'سوريا', kbps: 64, ea: 'Ayman_Sowaid_64kbps' }
];

/* عناوين البث كما يذكرها فهرس الإذاعات في mp3quran.net/api/v3/radios، وقد تغيّرت
   أسماء ست منها فصارت القديمة تردّ بلا صوت، لذلك تُكتب كلها من الفهرس نفسه */
var RADIO_STATIONS = [
  { name: 'إذاعة القرآن الكريم', url: 'https://backup.qurango.net/radio/tarateel', note: 'تلاوات متنوعة' },
  { name: 'عبدالرحمن السديس', url: 'https://backup.qurango.net/radio/abdulrahman_alsudaes', note: 'إمام الحرم المكي' },
  { name: 'عبدالباسط عبدالصمد', url: 'https://backup.qurango.net/radio/abdulbasit_abdulsamad', note: 'مرتل ومجوّد' },
  { name: 'ماهر المعيقلي', url: 'https://backup.qurango.net/radio/maher', note: 'إمام الحرم المكي' },
  { name: 'مشاري العفاسي', url: 'https://backup.qurango.net/radio/mishary_alafasi', note: 'الكويت' },
  { name: 'سعود الشريم', url: 'https://backup.qurango.net/radio/saud_alshuraim', note: 'إمام الحرم المكي' },
  { name: 'أحمد العجمي', url: 'https://backup.qurango.net/radio/ahmad_alajmy', note: 'تلاوة مؤثرة' },
  { name: 'ياسر الدوسري', url: 'https://backup.qurango.net/radio/yasser_aldosari', note: 'إمام الحرم المكي' },
  { name: 'هزاع البلوشي', url: 'https://backup.qurango.net/radio/hazza', note: 'تلاوة هادئة' }
];

/* المدن مع إحداثياتها وفارق التوقيت، ليعمل حساب المواقيت دون إنترنت */
var CITIES = [
  { n: 'الكويت', lat: 29.3759, lng: 47.9774, tz: 3, z: 'Asia/Kuwait', method: 'Ojeiri' },
  { n: 'الرياض', lat: 24.7136, lng: 46.6753, tz: 3, z: 'Asia/Riyadh', method: 'Makkah' },
  { n: 'مكة المكرمة', lat: 21.4225, lng: 39.8262, tz: 3, z: 'Asia/Riyadh', method: 'Makkah' },
  { n: 'المدينة المنورة', lat: 24.4686, lng: 39.6142, tz: 3, z: 'Asia/Riyadh', method: 'Makkah' },
  { n: 'جدة', lat: 21.4858, lng: 39.1925, tz: 3, z: 'Asia/Riyadh', method: 'Makkah' },
  { n: 'الدمام', lat: 26.3927, lng: 49.9777, tz: 3, z: 'Asia/Riyadh', method: 'Makkah' },
  { n: 'الدوحة', lat: 25.2854, lng: 51.5310, tz: 3, z: 'Asia/Qatar', method: 'Qatar' },
  { n: 'المنامة', lat: 26.2285, lng: 50.5860, tz: 3, z: 'Asia/Bahrain', method: 'Kuwait' },
  { n: 'أبوظبي', lat: 24.4539, lng: 54.3773, tz: 4, z: 'Asia/Dubai', method: 'Dubai' },
  { n: 'دبي', lat: 25.2048, lng: 55.2708, tz: 4, z: 'Asia/Dubai', method: 'Dubai' },
  { n: 'مسقط', lat: 23.5880, lng: 58.3829, tz: 4, z: 'Asia/Muscat', method: 'Makkah' },
  { n: 'بغداد', lat: 33.3152, lng: 44.3661, tz: 3, z: 'Asia/Baghdad', method: 'Karachi' },
  { n: 'عمّان', lat: 31.9454, lng: 35.9284, tz: 3, z: 'Asia/Amman', method: 'MWL' },
  { n: 'بيروت', lat: 33.8938, lng: 35.5018, tz: 3, z: 'Asia/Beirut', method: 'MWL' },
  { n: 'دمشق', lat: 33.5138, lng: 36.2765, tz: 3, z: 'Asia/Damascus', method: 'MWL' },
  { n: 'القاهرة', lat: 30.0444, lng: 31.2357, tz: 3, z: 'Africa/Cairo', method: 'Egypt' },
  { n: 'الخرطوم', lat: 15.5007, lng: 32.5599, tz: 2, z: 'Africa/Khartoum', method: 'Egypt' },
  { n: 'صنعاء', lat: 15.3694, lng: 44.1910, tz: 3, z: 'Asia/Aden', method: 'MWL' },
  { n: 'تونس', lat: 36.8065, lng: 10.1815, tz: 1, z: 'Africa/Tunis', method: 'Morocco' },
  { n: 'الجزائر', lat: 36.7538, lng: 3.0588, tz: 1, z: 'Africa/Algiers', method: 'Morocco' },
  { n: 'الرباط', lat: 34.0209, lng: -6.8416, tz: 1, z: 'Africa/Casablanca', method: 'Morocco' },
  { n: 'إسطنبول', lat: 41.0082, lng: 28.9784, tz: 3, z: 'Europe/Istanbul', method: 'Turkey' },
  { n: 'لندن', lat: 51.5074, lng: -0.1278, tz: 0, z: 'Europe/London', method: 'MWL' },
  { n: 'باريس', lat: 48.8566, lng: 2.3522, tz: 1, z: 'Europe/Paris', method: 'France' },
  { n: 'نيويورك', lat: 40.7128, lng: -74.0060, tz: -5, z: 'America/New_York', method: 'ISNA' },
  { n: 'تورونتو', lat: 43.6532, lng: -79.3832, tz: -5, z: 'America/Toronto', method: 'ISNA' },
  { n: 'كوالالمبور', lat: 3.1390, lng: 101.6869, tz: 8, z: 'Asia/Kuala_Lumpur', method: 'Singapore' },
  { n: 'جاكرتا', lat: -6.2088, lng: 106.8456, tz: 7, z: 'Asia/Jakarta', method: 'Singapore' },
  { n: 'كراتشي', lat: 24.8607, lng: 67.0011, tz: 5, z: 'Asia/Karachi', method: 'Karachi' },
  { n: 'إسلام آباد', lat: 33.6844, lng: 73.0479, tz: 5, z: 'Asia/Karachi', method: 'Karachi' }
];

/* الورد اليومي: اثنتا عشرة عبادة يتابعها المستخدم */
var WIRD_ITEMS = [
  { id: 'fajr-jama', t: 'صلاة الفجر في وقتها', n: 'من صلى الصبح فهو في ذمة الله' },
  { id: 'morning', t: 'أذكار الصباح', n: 'حصن المسلم' },
  { id: 'evening', t: 'أذكار المساء', n: 'حصن المسلم' },
  { id: 'quran', t: 'ورد من القرآن', n: 'ولو صفحة واحدة' },
  { id: 'duha', t: 'صلاة الضحى', n: 'ركعتان فأكثر' },
  { id: 'rawatib', t: 'السنن الرواتب', n: 'اثنتا عشرة ركعة' },
  { id: 'witr', t: 'الوتر', n: 'ولو ركعة واحدة' },
  { id: 'istighfar', t: 'الاستغفار مئة مرة', n: 'قال ﷺ: إنه ليُغان على قلبي، وإني لأستغفر الله في اليوم مئة مرة' },
  { id: 'salah-nabi', t: 'الصلاة على النبي ﷺ', n: 'من صلى عليّ واحدة صلى الله عليه عشرًا' },
  { id: 'sadaqah', t: 'صدقة ولو يسيرة', n: 'اتقوا النار ولو بشق تمرة' },
  { id: 'birr', t: 'بر الوالدين أو صلة رحم', n: 'من أحب أن يُبسط له في رزقه فليصل رحمه' },
  { id: 'sleep', t: 'أذكار النوم', n: 'آية الكرسي وخواتيم البقرة والمعوذات' }
];

var TASBIH_PHRASES = [
  { t: 'سبحان الله', target: 33 },
  { t: 'الحمد لله', target: 33 },
  { t: 'الله أكبر', target: 34 },
  { t: 'لا إله إلا الله', target: 100 },
  { t: 'أستغفر الله', target: 100 },
  { t: 'سبحان الله وبحمده', target: 100 },
  { t: 'لا حول ولا قوة إلا بالله', target: 100 },
  { t: 'اللهم صل على محمد', target: 100 }
];

var SURAH_VIRTUES = {
  1: 'أعظم سورة في القرآن، ولا تصح صلاة بغيرها',
  2: 'لا تُقرأ في بيت فيدخله الشيطان ثلاث ليال',
  18: 'من قرأها يوم الجمعة أضاء له النور ما بين الجمعتين',
  36: 'قلب القرآن، ومن قرأها ابتغاء وجه الله غُفر له',
  55: 'عروس القرآن',
  56: 'من قرأها كل ليلة لم تصبه فاقة',
  67: 'تشفع لصاحبها حتى يُغفر له',
  112: 'تعدل ثلث القرآن',
  113: 'من المعوذتين اللتين يُتحصن بهما',
  114: 'من المعوذتين اللتين يُتحصن بهما'
};

var PROPHET_DAY = [
  { time: 'قبل الفجر', items: ['قيام الليل والوتر', 'الاستغفار في السحر', 'ركعتا الفجر خفيفتان'] },
  { time: 'بعد الفجر', items: ['أذكار الصباح', 'الجلوس في المصلى حتى تطلع الشمس', 'ركعتا الشروق'] },
  { time: 'الضحى', items: ['صلاة الضحى', 'قضاء حوائج الناس', 'مجالسة أصحابه وتعليمهم'] },
  { time: 'الظهر', items: ['القيلولة قبل الظهر', 'أربع ركعات قبل الظهر وركعتان بعدها'] },
  { time: 'العصر', items: ['زيارة أهله', 'العمل والسعي', 'ذكر الله في الطريق'] },
  { time: 'المغرب', items: ['أذكار المساء قبل الغروب', 'ركعتان بعد المغرب', 'تعجيل الفطر في الصيام'] },
  { time: 'العشاء', items: ['تأخير العشاء ما لم يشق', 'كراهية الحديث بعدها', 'الوتر آخر الليل'] },
  { time: 'قبل النوم', items: ['الوضوء', 'آية الكرسي والمعوذات', 'النوم على الشق الأيمن', 'تسبيح فاطمة'] }
];

var SEERAH_QUOTES = [
  'كان خلقه القرآن، فما ضرب بيده شيئًا قط ولا امرأة ولا خادمًا',
  'ما خُيّر بين أمرين إلا اختار أيسرهما ما لم يكن إثمًا',
  'كان يخصف نعله ويرقع ثوبه ويخدم في مهنة أهله',
  'ما شبع من خبز شعير يومين متتابعين حتى لقي الله',
  'كان إذا أتاه أمر يسره خرّ ساجدًا شكرًا لله',
  'ما سُئل شيئًا قط فقال لا',
  'كان أجود الناس، وأجود ما يكون في رمضان',
  'كان يبدأ من لقيه بالسلام، ولا ينزع يده حتى ينزعها صاحبها',
  'كان يمزح ولا يقول إلا حقًا',
  'دخل مكة فاتحًا وهو يطأطئ رأسه تواضعًا لله'
];
