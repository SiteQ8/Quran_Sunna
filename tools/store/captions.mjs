/* The words over the store pictures, in every language a store takes, and
   the name each store gives that language.

   Arabic is the app's own and its pictures stay where they always were:
   play/listing/phone, ios/screenshots/6.9-inch and ios/screenshots/ipad-13.
   Every other language keeps its own beside them, under the code its store
   knows it by: play/listing/<play>/phone, ios/screenshots/<appStore>/6.9-inch
   and ios/screenshots/<appStore>/ipad-13. Google Play takes Persian and the
   App Store does not; neither takes Hausa, so the app speaks it and no store
   page does.

   Each scene says what it is and what is worth knowing about it, shortly and
   truly, in the reader's language: the splash is a painting of the Gulf for
   every reader, so it promises no one their own country unless they are in
   it, and the mushaf's line names the meanings the reader will find under
   each verse in their own language. Figures are written as the app writes
   them in that language. */

export const STORES = {
  ar: { dir: 'rtl', locale: 'ar-KW', play: 'ar', appStore: 'ar-SA' },
  en: { dir: 'ltr', locale: 'en-US', play: 'en-US', appStore: 'en-US' },
  id: { dir: 'ltr', locale: 'id-ID', play: 'id', appStore: 'id' },
  ms: { dir: 'ltr', locale: 'ms-MY', play: 'ms', appStore: 'ms' },
  fr: { dir: 'ltr', locale: 'fr-FR', play: 'fr-FR', appStore: 'fr-FR' },
  tr: { dir: 'ltr', locale: 'tr-TR', play: 'tr-TR', appStore: 'tr' },
  ru: { dir: 'ltr', locale: 'ru-RU', play: 'ru-RU', appStore: 'ru' },
  bn: { dir: 'ltr', locale: 'bn-BD', play: 'bn-BD', appStore: 'bn-BD' },
  ur: { dir: 'rtl', locale: 'ur-PK', play: 'ur', appStore: 'ur-PK' },
  fa: { dir: 'rtl', locale: 'fa-IR', play: 'fa', appStore: null },
  ha: { dir: 'ltr', locale: 'ha-NG', play: null, appStore: null }
};

export const CAPTIONS = {
  ar: {
    splash: { top: 'شاشة بدء من بلدك', sub: 'لوحة من تراث بلدك بليله ونهاره، وترحيبٌ بأهله' },
    home: { top: 'أوقات الصلاة والأذان', sub: 'تقويم العجيري للكويت، وحسابٌ في جهازك لكل مكان' },
    sky: { top: 'سماء الوقت', sub: 'تتبدّل مع مواقيت الصلاة في مدينتك من الفجر إلى العشاء' },
    sections: { top: 'كل ما تحتاجه في يومك', sub: 'القبلة والمساجد والقضاء والعمرة والختمة والأدعية' },
    mushaf: { top: 'المصحف كاملاً بلا شبكة', sub: 'برواية حفص بالرسم العثماني، ٦٠٤ صفحات وتفسير' },
    azkar: { top: 'أذكارك في وقتها', sub: 'الصباح والمساء وأذكار اليوم، بعدّادٍ يحفظ أين وصلت' },
    prayers: { top: 'صلاتي', sub: 'تابع فروضك وكيف أدّيتها' },
    qibla: { top: 'القبلة', sub: 'بوصلة تدور مع جهازك نحو الكعبة' },
    'mushaf-pad': { top: 'المصحف صفحتان متقابلتان', sub: 'برواية حفص بالرسم العثماني، ٦٠٤ صفحات وتفسير بلا شبكة' }
  },
  en: {
    splash: { top: 'A painted welcome', sub: 'A painting of the Gulf by day or by night, and a greeting to the people of your city' },
    home: { top: 'Prayer times and adhan', sub: 'The Al-Ojeiri calendar for Kuwait, and calculation on your device everywhere else' },
    sky: { top: 'Sky of the hour', sub: 'It changes with the prayer times of your city, from Fajr to Isha' },
    sections: { top: 'All you need in your day', sub: 'Qibla, mosques, make-up prayers, Umrah, khatmah and duas' },
    mushaf: { top: 'The full Mushaf, offline', sub: 'Hafs in the Uthmani script, 604\u00a0pages, with the meanings in English' },
    azkar: { top: 'Your adhkar on time', sub: 'Morning, evening and daily adhkar, with a counter that keeps your place' },
    prayers: { top: 'My prayers', sub: 'Keep track of each prayer and how you prayed it' },
    qibla: { top: 'Qibla', sub: 'A compass that turns with your phone toward the Kaaba' },
    'mushaf-pad': { top: 'The Mushaf on two facing pages', sub: 'Hafs in the Uthmani script, 604\u00a0pages, with the meanings in English' }
  },
  id: {
    splash: { top: 'Salam pembuka', sub: 'Lukisan Teluk di siang atau malam hari, dan salam untuk warga kota Anda' },
    home: { top: 'Waktu salat dan azan', sub: 'Kalender Al-Ojeiri untuk Kuwait, dan dihitung di perangkat Anda untuk tempat lain' },
    sky: { top: 'Langit sesuai waktu', sub: 'Berubah mengikuti waktu salat di kota Anda, dari Subuh hingga Isya' },
    sections: { top: 'Kebutuhan harian Anda', sub: 'Kiblat, masjid, qada, umrah, khatam, dan doa' },
    mushaf: { top: 'Mushaf tanpa internet', sub: 'Riwayat Hafs, rasm Utsmani, 604\u00a0halaman, dengan terjemahan bahasa Indonesia' },
    azkar: { top: 'Zikir tepat pada waktunya', sub: 'Zikir pagi, petang, dan harian, dengan penghitung yang mengingat sampai mana Anda' },
    prayers: { top: 'Salat saya', sub: 'Catat setiap salat dan cara Anda menunaikannya' },
    qibla: { top: 'Kiblat', sub: 'Kompas yang berputar bersama ponsel Anda ke arah Ka\'bah' },
    'mushaf-pad': { top: 'Mushaf dua halaman berdampingan', sub: 'Riwayat Hafs, rasm Utsmani, 604\u00a0halaman, dengan terjemahan bahasa Indonesia' }
  },
  ms: {
    splash: { top: 'Salam pembuka', sub: 'Lukisan Teluk Arab pada waktu siang atau malam, dan salam buat penduduk bandar anda' },
    home: { top: 'Waktu solat dan azan', sub: 'Takwim Al-Ojeiri untuk Kuwait, dan dikira dalam peranti anda di tempat lain' },
    sky: { top: 'Langit mengikut waktu', sub: 'Berubah mengikut waktu solat di bandar anda, dari Subuh hingga Isyak' },
    sections: { top: 'Keperluan harian anda', sub: 'Kiblat, masjid, qada, umrah, khatam dan doa' },
    mushaf: { top: 'Mushaf tanpa internet', sub: 'Riwayat Hafs, rasm Uthmani, 604\u00a0halaman, berserta terjemahan bahasa Melayu' },
    azkar: { top: 'Zikir tepat pada waktunya', sub: 'Zikir pagi, petang dan harian, dengan pembilang yang mengingati kedudukan anda' },
    prayers: { top: 'Solat saya', sub: 'Catat setiap solat dan cara anda menunaikannya' },
    qibla: { top: 'Kiblat', sub: 'Kompas yang berpusing bersama telefon anda ke arah Kaabah' },
    'mushaf-pad': { top: 'Mushaf dua halaman bersebelahan', sub: 'Riwayat Hafs, rasm Uthmani, 604\u00a0halaman, berserta terjemahan bahasa Melayu' }
  },
  fr: {
    splash: { top: 'Un accueil peint', sub: 'Un tableau du Golfe, de jour ou de nuit, et un salut aux habitants de votre ville' },
    home: { top: 'Horaires de prière et adhan', sub: 'Le calendrier d\'Al-Ojeiri au Koweït, et un calcul sur votre appareil partout ailleurs' },
    sky: { top: 'Ciel de l\'heure', sub: 'Il change avec les horaires de prière de votre ville, du Fajr à l\'Icha' },
    sections: { top: 'Tout pour votre journée', sub: 'Qibla, mosquées, rattrapage, omra, khatma et dou\'as' },
    mushaf: { top: 'Le Coran complet, hors ligne', sub: 'Lecture de Hafs, écriture uthmanie, 604\u00a0pages, avec le sens en français' },
    azkar: { top: 'Vos invocations à l\'heure', sub: 'Matin, soir et journée, avec un compteur qui retient où vous en êtes' },
    prayers: { top: 'Mes prières', sub: 'Notez chaque prière et la manière dont vous l\'avez accomplie' },
    qibla: { top: 'Qibla', sub: 'Une boussole qui tourne avec votre téléphone vers la Kaaba' },
    'mushaf-pad': { top: 'Le Coran en double page', sub: 'Lecture de Hafs, écriture uthmanie, 604\u00a0pages, avec le sens en français' }
  },
  tr: {
    splash: { top: 'Resimli bir karşılama', sub: 'Gündüz ya da gece bir Körfez tablosu ve şehrinizin halkına selam' },
    home: { top: 'Namaz vakitleri ve ezan', sub: 'Kuveyt için el-Uceyrî takvimi, başka her yerde cihazınızda hesaplama' },
    sky: { top: 'Vaktin gökyüzü', sub: 'Şehrinizin namaz vakitleriyle birlikte sabahtan yatsıya değişir' },
    sections: { top: 'Gününüz için her şey', sub: 'Kıble, camiler, kaza borçları, umre, hatim ve dualar' },
    mushaf: { top: 'İnternetsiz tam Mushaf', sub: 'Hafs rivayeti, resm-i Osmânî, 604\u00a0sayfa ve Türkçe meal' },
    azkar: { top: 'Zikirleriniz vaktinde', sub: 'Sabah, akşam ve günlük zikirler, kaldığınız yeri hatırlayan sayaçla' },
    prayers: { top: 'Namazlarım', sub: 'Her namazı ve nasıl kıldığınızı kaydedin' },
    qibla: { top: 'Kıble', sub: 'Telefonunuzla birlikte Kâbe\'ye dönen bir pusula' },
    'mushaf-pad': { top: 'Karşılıklı iki sayfa', sub: 'Hafs rivayeti, resm-i Osmânî, 604\u00a0sayfa ve Türkçe meal' }
  },
  ru: {
    splash: { top: 'Приветствие в красках', sub: 'Картина Залива днём или ночью и приветствие жителям вашего города' },
    home: { top: 'Время намазов и азан', sub: 'Календарь аль-Уджейри для Кувейта и расчёт на вашем устройстве для любого места' },
    sky: { top: 'Небо текущего часа', sub: 'Меняется вместе со временем намазов в вашем городе, от фаджра до иши' },
    sections: { top: 'Всё нужное на день', sub: 'Кибла, мечети, восполнение, умра, хатм и дуа' },
    mushaf: { top: 'Весь Коран без интернета', sub: 'Чтение Хафса, усманское письмо, 604\u00a0страницы и перевод смыслов на русский' },
    azkar: { top: 'Азкары в своё время', sub: 'Утренние, вечерние и дневные, со счётчиком, который помнит, где вы остановились' },
    prayers: { top: 'Мои намазы', sub: 'Отмечайте каждый намаз и то, как вы его совершили' },
    qibla: { top: 'Кибла', sub: 'Компас, который поворачивается вместе с телефоном к Каабе' },
    'mushaf-pad': { top: 'Коран на развороте', sub: 'Чтение Хафса, усманское письмо, 604\u00a0страницы и перевод смыслов на русский' }
  },
  bn: {
    splash: { top: 'ছবিতে আঁকা স্বাগতম', sub: 'দিনে বা রাতে উপসাগরের একটি চিত্র, আর আপনার শহরের মানুষের প্রতি সালাম' },
    home: { top: 'নামাজের সময় ও আজান', sub: 'কুয়েতের জন্য আল-উজাইরি ক্যালেন্ডার, আর অন্য সব জায়গার হিসাব আপনার ডিভাইসেই' },
    sky: { top: 'সময়ের আকাশ', sub: 'আপনার শহরের নামাজের সময়ের সাথে ফজর থেকে এশা পর্যন্ত বদলায়' },
    sections: { top: 'আপনার দিনের সব প্রয়োজন', sub: 'কিবলা, মসজিদ, কাজা, ওমরাহ, খতম ও দোয়া' },
    mushaf: { top: 'সম্পূর্ণ কুরআন, ইন্টারনেট ছাড়াই', sub: 'হাফসের রেওয়ায়েত, উসমানি লিপি, ৬০৪\u00a0পৃষ্ঠা, সাথে বাংলা অর্থ' },
    azkar: { top: 'সময়মতো আপনার জিকির', sub: 'সকাল, সন্ধ্যা ও সারাদিনের জিকির, গণনা মনে রাখে আপনি কোথায় থেমেছেন' },
    prayers: { top: 'আমার নামাজ', sub: 'প্রতিটি নামাজ এবং কীভাবে আদায় করেছেন তা লিখে রাখুন' },
    qibla: { top: 'কিবলা', sub: 'আপনার ফোনের সাথে কাবার দিকে ঘোরে এমন একটি কম্পাস' },
    'mushaf-pad': { top: 'পাশাপাশি দুই পৃষ্ঠায় কুরআন', sub: 'হাফসের রেওয়ায়েত, উসমানি লিপি, ৬০৪\u00a0পৃষ্ঠা, সাথে বাংলা অর্থ' }
  },
  ur: {
    splash: { top: 'رنگوں بھرا استقبال', sub: 'دن یا رات میں خلیج کی ایک تصویر، اور آپ کے شہر کے لوگوں کو سلام' },
    home: { top: 'اوقاتِ نماز اور اذان', sub: 'کویت کے لیے العجیری کیلنڈر، اور ہر دوسری جگہ کا حساب آپ کے آلے میں' },
    sky: { top: 'وقت کا آسمان', sub: 'آپ کے شہر کے اوقاتِ نماز کے ساتھ فجر سے عشاء تک بدلتا ہے' },
    sections: { top: 'آپ کے دن کی ہر ضرورت', sub: 'قبلہ، مساجد، قضا، عمرہ، ختمِ قرآن اور دعائیں' },
    mushaf: { top: 'پورا مصحف، انٹرنیٹ کے بغیر', sub: 'روایتِ حفص، رسمِ عثمانی، 604\u00a0صفحات، اردو ترجمے کے ساتھ' },
    azkar: { top: 'اذکار اپنے وقت پر', sub: 'صبح، شام اور دن کے اذکار، ایسی گنتی کے ساتھ جو یاد رکھے آپ کہاں تک پہنچے' },
    prayers: { top: 'میری نمازیں', sub: 'ہر نماز اور اسے ادا کرنے کا طریقہ درج کریں' },
    qibla: { top: 'قبلہ', sub: 'ایک قطب نما جو آپ کے فون کے ساتھ کعبہ کی طرف گھومتا ہے' },
    'mushaf-pad': { top: 'آمنے سامنے دو صفحات', sub: 'روایتِ حفص، رسمِ عثمانی، 604\u00a0صفحات، اردو ترجمے کے ساتھ' }
  },
  fa: {
    splash: { top: 'خوشامدی رنگین', sub: 'تابلویی از خلیج در روز یا شب، و درود بر اهل شهر شما' },
    home: { top: 'اوقات نماز و اذان', sub: 'تقویم العجیری برای کویت، و محاسبه روی دستگاه شما برای هر جای دیگر' },
    sky: { top: 'آسمان لحظه', sub: 'با اوقات نماز شهر شما از صبح تا عشا تغییر می‌کند' },
    sections: { top: 'هرآنچه روزتان لازم دارد', sub: 'قبله، مساجد، قضا، عمره، ختم قرآن و دعاها' },
    mushaf: { top: 'مصحف کامل، بدون اینترنت', sub: 'روایت حفص، رسم عثمانی، ۶۰۴\u00a0صفحه، با ترجمهٔ فارسی' },
    azkar: { top: 'اذکار در وقت خودش', sub: 'اذکار صبح و شام و روزانه، با شمارنده‌ای که جای شما را به خاطر می‌سپارد' },
    prayers: { top: 'نمازهای من', sub: 'هر نماز و چگونگی ادای آن را ثبت کنید' },
    qibla: { top: 'قبله', sub: 'قطب‌نمایی که همراه گوشی شما به سوی کعبه می‌چرخد' },
    'mushaf-pad': { top: 'مصحف در دو صفحهٔ روبه‌رو', sub: 'روایت حفص، رسم عثمانی، ۶۰۴\u00a0صفحه، با ترجمهٔ فارسی' }
  }
};

/* the language a run is asked for, and where its pictures go; Arabic in the
   folders it always had */
export function target(lang) {
  const s = STORES[lang];
  if (!s) throw new Error('the app does not speak ' + lang + ': ' + Object.keys(STORES).join(', '));
  const words = CAPTIONS[lang];
  return {
    lang, dir: s.dir, locale: s.locale, words,
    phone: s.appStore ? (lang === 'ar' ? 'ios/screenshots/6.9-inch' : 'ios/screenshots/' + s.appStore + '/6.9-inch') : null,
    ipad: s.appStore ? (lang === 'ar' ? 'ios/screenshots/ipad-13' : 'ios/screenshots/' + s.appStore + '/ipad-13') : null,
    play: s.play ? (lang === 'ar' ? 'play/listing/phone' : 'play/listing/' + s.play + '/phone') : null
  };
}
