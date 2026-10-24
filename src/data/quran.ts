// Quran verses for calm reels. A verse is always heard in the voice of a real reciter (audio from everyayah.com),
// never read by the AI voice, and always used whole: never cut in the middle.

export interface QuranReciter { id: string; name: string }   // id = the reciter's folder on everyayah.com
export interface QuranRange { surah: number; start: number; end: number; label: string }
export interface QuranTopic { id: string; label: string; verses: QuranRange[] }

/** Reciters checked on everyayah.com (2026-10-24): every folder serves the verse files. */
export const QURAN_RECITERS: QuranReciter[] = [
  { id: 'Alafasy_64kbps', name: 'مشاري العفاسي' },
  { id: 'Abdul_Basit_Murattal_64kbps', name: 'عبدالباسط عبدالصمد (مرتل)' },
  { id: 'AbdulSamad_64kbps_QuranExplorer.Com', name: 'عبدالباسط عبدالصمد' },
  { id: 'Husary_64kbps', name: 'محمود خليل الحصري' },
  { id: 'Minshawy_Murattal_128kbps', name: 'محمد صديق المنشاوي (مرتل)' },
  { id: 'Minshawy_Mujawwad_64kbps', name: 'محمد صديق المنشاوي (مجود)' },
  { id: 'Maher_AlMuaiqly_64kbps', name: 'ماهر المعيقلي' },
  { id: 'Abdurrahmaan_As-Sudais_64kbps', name: 'عبدالرحمن السديس' },
  { id: 'Saood_ash-Shuraym_64kbps', name: 'سعود الشريم' },
  { id: 'Yasser_Ad-Dussary_128kbps', name: 'ياسر الدوسري' },
  { id: 'Nasser_Alqatami_128kbps', name: 'ناصر القطامي' },
  { id: 'Abu_Bakr_Ash-Shaatree_128kbps', name: 'أبو بكر الشاطري' },
  { id: 'Fares_Abbad_64kbps', name: 'فارس عباد' },
  { id: 'Hani_Rifai_192kbps', name: 'هاني الرفاعي' },
  { id: 'Muhammad_Ayyoub_128kbps', name: 'محمد أيوب' },
  { id: 'Muhammad_Jibreel_128kbps', name: 'محمد جبريل' },
  { id: 'Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net', name: 'أحمد العجمي' },
  { id: 'Ahmed_Neana_128kbps', name: 'أحمد نعينع' },
  { id: 'Mohammad_al_Tablaway_128kbps', name: 'محمد الطبلاوي' },
  { id: 'Salah_Al_Budair_128kbps', name: 'صلاح البدير' },
  { id: 'Salaah_AbdulRahman_Bukhatir_128kbps', name: 'صلاح بوخاطر' },
  { id: 'Abdullaah_3awwaad_Al-Juhaynee_128kbps', name: 'عبدالله الجهني' },
  { id: 'Abdullah_Basfar_192kbps', name: 'عبدالله بصفر' },
  { id: 'Abdullah_Matroud_128kbps', name: 'عبدالله مطرود' },
  { id: 'Hudhaify_64kbps', name: 'علي الحذيفي' },
  { id: 'Muhsin_Al_Qasim_192kbps', name: 'محسن القاسم' },
  { id: 'Khaalid_Abdullaah_al-Qahtaanee_192kbps', name: 'خالد القحطاني' },
  { id: 'Ali_Jaber_64kbps', name: 'علي جابر' },
  { id: 'Ayman_Sowaid_64kbps', name: 'أيمن سويد' },
  { id: 'Yaser_Salamah_128kbps', name: 'ياسر سلامة' },
  { id: 'khalefa_al_tunaiji_64kbps', name: 'خليفة الطنيجي' },
];
export const DEFAULT_RECITER = QURAN_RECITERS[0].id;

/**
 * Suggested passages by theme. Each one was checked against the verse text: whole verses only, and nothing whose
 * verse opens with an unrelated ruling (e.g. 65:2 and 2:222 end with a comforting phrase but start with family law).
 */
export const QURAN_TOPICS: QuranTopic[] = [
  { id: 'calm', label: 'السكينة والطمأنينة', verses: [
    { surah: 13, start: 28, end: 28, label: 'ألا بذكر الله تطمئن القلوب' },
    { surah: 94, start: 5, end: 6, label: 'فإن مع العسر يسرا' },
    { surah: 2, start: 255, end: 255, label: 'آية الكرسي' },
  ] },
  { id: 'night', label: 'قبل النوم', verses: [
    { surah: 112, start: 1, end: 4, label: 'سورة الإخلاص' },
    { surah: 113, start: 1, end: 5, label: 'سورة الفلق' },
    { surah: 114, start: 1, end: 6, label: 'سورة الناس' },
  ] },
  { id: 'patience', label: 'الصبر والثبات', verses: [
    { surah: 2, start: 153, end: 153, label: 'استعينوا بالصبر والصلاة' },
    { surah: 2, start: 155, end: 157, label: 'وبشر الصابرين' },
  ] },
  { id: 'rizq', label: 'الرزق والتوكل', verses: [
    { surah: 51, start: 22, end: 23, label: 'وفي السماء رزقكم وما توعدون' },
    { surah: 65, start: 3, end: 3, label: 'ومن يتوكل على الله فهو حسبه' },
  ] },
  { id: 'tawbah', label: 'التوبة والرجوع', verses: [
    { surah: 39, start: 53, end: 53, label: 'لا تقنطوا من رحمة الله' },
    { surah: 7, start: 23, end: 23, label: 'ربنا ظلمنا أنفسنا' },
  ] },
];

/** Longest passage for one reel. */
export const QURAN_MAX_VERSES = 10;
export const QURAN_MAX_SECONDS = 180;
