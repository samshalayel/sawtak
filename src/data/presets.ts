import { Voice, LanguageOption, ToneStyle, SampleScript } from '../types/tts';

export const VOICES: Voice[] = [
  {
    id: 'Kore',
    name: 'يارا',
    gender: 'female',
    toneAr: 'صوت نسائي دافئ، متزن ومعبر، إيقاع متناغم للشروحات والبودكاست',
    toneEn: 'Balanced & melodic female voice, ideal for narrations and podcasts',
    tags: ['متزن', 'شروحات', 'بودكاست'],
    avatarColor: 'from-amber-500 to-orange-600',
    avatar: '/avatars/Kore.webp',
    previewSample: 'مرحباً بك في استوديو صوتك الذكي، يسعدني التحدث إليك اليوم.'
  },
  {
    id: 'Puck',
    name: 'زين',
    gender: 'male',
    toneAr: 'صوت رجالي حيوي وودود، نبرة متفاعلة ومثالية للإعلانات ومحتوى الويب',
    toneEn: 'Warm & energetic male voice, great for ads and social content',
    tags: ['حيوي', 'إعلانات', 'سوشيال'],
    avatarColor: 'from-emerald-500 to-teal-600',
    avatar: '/avatars/Puck.webp',
    previewSample: 'أهلاً يا أصدقاء! استعدوا لاكتشاف أسرع تجربة لتحويل النص إلى صوت.'
  },
  {
    id: 'Fenrir',
    name: 'ليث',
    gender: 'male',
    toneAr: 'صوت رجالي رخيم ووقور، هيبة إذاعية للأفلام الوثائقية والبيانات الرسمية',
    toneEn: 'Deep & authoritative male voice, fits documentaries and official announcements',
    tags: ['رخيم', 'وقور', 'وثائقي'],
    avatarColor: 'from-blue-600 to-indigo-700',
    avatar: '/avatars/Fenrir.webp',
    previewSample: 'في عمق المحيطات الشاسعة، تتكشف أسرار لم يشهدها البشر من قبل.'
  },
  {
    id: 'Zephyr',
    name: 'فاتن',
    gender: 'female',
    toneAr: 'صوت نسائي هادئ وعذب، نبرة لطيفة ومريحة للكتب الصوتية وجلسات الاسترخاء',
    toneEn: 'Gentle & soothing female voice, perfect for audiobooks and relaxation',
    tags: ['هادئ', 'كتب صوتية', 'استرخاء'],
    avatarColor: 'from-purple-500 to-pink-600',
    avatar: '/avatars/Zephyr.webp',
    previewSample: 'أغمض عينيك، وتنفس بعمق، واستشعر السكينة تسري في كل لحظة.'
  },
  {
    id: 'Charon',
    name: 'كنان',
    gender: 'male',
    toneAr: 'صوت رجالي سينمائي هادئ، طابع سردي ملهم للقصص التاريخية والأدبية',
    toneEn: 'Cinematic & calm male voice, great for historical storytelling',
    tags: ['سينمائي', 'تاريخي', 'سردي'],
    avatarColor: 'from-slate-600 to-zinc-800',
    avatar: '/avatars/Charon.webp',
    previewSample: 'كانت دمشق في تلك الحقبة منارة للعلم، تفيض شوارعها بعبق التاريخ.'
  },
  // Extended catalog (Gemini prebuilt voices); showcase samples live in server/voice-previews.ts
  {
    id: 'Leda',
    name: 'شيماء',
    gender: 'female',
    toneAr: 'صوت نسائي شبابي ومرح، مناسب لمحتوى السوشيال والتطبيقات والجمهور الشاب',
    toneEn: 'Youthful, playful female voice for social media and apps',
    tags: ['شبابي', 'سوشيال', 'تطبيقات'],
    avatarColor: 'from-pink-500 to-rose-600',
    avatar: '/avatars/Leda.webp',
  },
  {
    id: 'Aoede',
    name: 'ميرا',
    gender: 'female',
    toneAr: 'صوت نسائي منساب وخفيف، رائع لمدونات الفيديو والسفر ونمط الحياة',
    toneEn: 'Breezy, light female voice for vlogs, travel and lifestyle',
    tags: ['خفيف', 'لايف ستايل', 'فلوغ'],
    avatarColor: 'from-sky-400 to-cyan-600',
    avatar: '/avatars/Aoede.webp',
  },
  {
    id: 'Despina',
    name: 'لارا',
    gender: 'female',
    toneAr: 'صوت نسائي ناعم وأنيق، مثالي للعلامات الفاخرة والجمال والعطور',
    toneEn: 'Smooth, elegant female voice for luxury and beauty brands',
    tags: ['أنيق', 'فاخر', 'جمال'],
    avatarColor: 'from-fuchsia-500 to-purple-700',
    avatar: '/avatars/Despina.webp',
  },
  {
    id: 'Sulafat',
    name: 'جود',
    gender: 'female',
    toneAr: 'صوت نسائي دافئ وحنون، قريب من القلب لقصص الأطفال والمحتوى العائلي',
    toneEn: 'Warm, caring female voice for kids stories and family content',
    tags: ['دافئ', 'أطفال', 'عائلي'],
    avatarColor: 'from-orange-400 to-amber-600',
    avatar: '/avatars/Sulafat.webp',
  },
  {
    id: 'Achernar',
    name: 'سيلا',
    gender: 'female',
    toneAr: 'صوت نسائي هامس وناعم، مريح للتأمل والنوم والمحتوى الهادئ',
    toneEn: 'Soft, hushed female voice for meditation and sleep content',
    tags: ['ناعم', 'تأمل', 'نوم'],
    avatarColor: 'from-indigo-400 to-violet-600',
    avatar: '/avatars/Achernar.webp',
  },
  {
    id: 'Gacrux',
    name: 'لمى',
    gender: 'female',
    toneAr: 'صوت نسائي ناضج وواثق، مناسب للتقارير والمحتوى المؤسسي والتعليمي',
    toneEn: 'Mature, confident female voice for corporate and educational content',
    tags: ['ناضج', 'مؤسسي', 'تعليمي'],
    avatarColor: 'from-teal-600 to-emerald-800',
    avatar: '/avatars/Gacrux.webp',
  },
  {
    id: 'Orus',
    name: 'مالك',
    gender: 'male',
    toneAr: 'صوت رجالي حازم وواضح، مثالي للإعلانات الرسمية والتعليمات والأخبار',
    toneEn: 'Firm, clear male voice for official announcements and news',
    tags: ['حازم', 'رسمي', 'أخبار'],
    avatarColor: 'from-blue-500 to-sky-700',
    avatar: '/avatars/Orus.webp',
  },
  {
    id: 'Algieba',
    name: 'آدم',
    gender: 'male',
    toneAr: 'صوت رجالي سلس وجذاب، رائع للبودكاست والإذاعة والحوارات',
    toneEn: 'Smooth, engaging male voice for podcasts and radio',
    tags: ['سلس', 'بودكاست', 'إذاعة'],
    avatarColor: 'from-amber-600 to-yellow-700',
    avatar: '/avatars/Algieba.webp',
  },
  {
    id: 'Iapetus',
    name: 'تيم',
    gender: 'male',
    toneAr: 'صوت رجالي صافٍ ومريح، مثالي للشروحات التقنية والدروس التعليمية',
    toneEn: 'Clear, relaxed male voice for tutorials and tech explainers',
    tags: ['واضح', 'شروحات', 'تقني'],
    avatarColor: 'from-cyan-600 to-blue-800',
    avatar: '/avatars/Iapetus.webp',
  },
  {
    id: 'Sadaltager',
    name: 'يامن',
    gender: 'male',
    toneAr: 'صوت رجالي مثقف ورصين، مناسب للمحاضرات والكتب الصوتية والمحتوى المعرفي',
    toneEn: 'Knowledgeable, composed male voice for lectures and audiobooks',
    tags: ['رصين', 'محاضرات', 'كتب صوتية'],
    avatarColor: 'from-stone-500 to-stone-700',
    avatar: '/avatars/Sadaltager.webp',
  },
  {
    id: 'Achird',
    name: 'ريان',
    gender: 'male',
    toneAr: 'صوت رجالي ودود وقريب، مثالي لخدمة العملاء والرسائل الترحيبية',
    toneEn: 'Friendly, approachable male voice for customer service and greetings',
    tags: ['ودود', 'خدمة عملاء', 'ترحيب'],
    avatarColor: 'from-lime-500 to-green-700',
    avatar: '/avatars/Achird.webp',
  },
  {
    id: 'Algenib',
    name: 'جاد',
    gender: 'male',
    toneAr: 'صوت رجالي خشن وقوي، مميز للإعلانات الحماسية والرياضة والألعاب',
    toneEn: 'Gravelly, powerful male voice for bold ads, sports and gaming',
    tags: ['قوي', 'رياضة', 'ألعاب'],
    avatarColor: 'from-red-600 to-rose-800',
    avatar: '/avatars/Algenib.webp',
  },
  // Character voices: adult Gemini voices directed as children (cartoon-dubbing style) and an angry delivery.
  // Chosen by measured pitch: ~280 Hz for the children vs ~120–200 Hz for adult voices.
  {
    id: 'Laomedeia',
    name: 'تولين',
    gender: 'female',
    toneAr: 'صوت طفلة صغيرة مرحة وبريئة، مثالي لقصص الأطفال والرسوم المتحركة والمحتوى التعليمي',
    toneEn: 'Playful little girl voice for kids stories, cartoons and learning content',
    tags: ['طفلة', 'كرتون', 'أطفال'],
    avatarColor: 'from-pink-400 to-fuchsia-500',
    avatar: '/avatars/Laomedeia.webp',
  },
  {
    id: 'Autonoe',
    name: 'يزن',
    gender: 'male',
    toneAr: 'صوت طفل مغامر ومتحمّس، رائع لقصص الأطفال والألعاب والإعلانات الموجّهة للصغار',
    toneEn: 'Adventurous little boy voice for kids stories, games and ads',
    tags: ['طفل', 'مغامرة', 'أطفال'],
    avatarColor: 'from-sky-400 to-blue-600',
    avatar: '/avatars/Autonoe.webp',
  },
  {
    id: 'Alnilam',
    name: 'نزار',
    gender: 'male',
    toneAr: 'صوت رجالي غاضب ومنفعل، للمشاهد الدرامية والمسلسلات والحوارات المتوترة',
    toneEn: 'Angry, explosive male voice for drama scenes and tense dialogue',
    tags: ['غضب', 'دراما', 'انفعال'],
    avatarColor: 'from-orange-600 to-red-700',
  },
];

export const LANGUAGES: LanguageOption[] = [
  {
    code: 'ar',
    nameAr: 'العربية',
    nameEn: 'Arabic',
    flag: '🇸🇦',
    dialects: [
      { id: 'msa', nameAr: 'الفصحى الحديثة (مع التشكيل والإعراب)', nameEn: 'Modern Standard Arabic', flag: '🌍' },
      { id: 'gulf', nameAr: 'اللهجة الخليجية / السعودية', nameEn: 'Gulf & Saudi Dialect', flag: '🇸🇦' },
      { id: 'egyptian', nameAr: 'اللهجة المصرية الطبيعية', nameEn: 'Egyptian Dialect', flag: '🇪🇬' },
      { id: 'levantine', nameAr: 'اللهجة الشامية (سورية ولبنانية)', nameEn: 'Levantine Dialect', flag: '🇸🇾' },
      { id: 'maghrebi', nameAr: 'اللهجة المغاربية (شمال إفريقيا)', nameEn: 'Maghrebi Dialect', flag: '🇲🇦' },
    ]
  },
  {
    code: 'en',
    nameAr: 'الإنجليزية',
    nameEn: 'English',
    flag: '🇬🇧',
    dialects: [
      { id: 'en_us', nameAr: 'لهجة أمريكية (US Standard)', nameEn: 'American English', flag: '🇺🇸' },
      { id: 'en_uk', nameAr: 'لهجة بريطانية (UK RP / Queen’s)', nameEn: 'British English', flag: '🇬🇧' },
    ]
  },
  {
    code: 'fr',
    nameAr: 'الفرنسية',
    nameEn: 'French',
    flag: '🇫🇷',
    dialects: [
      { id: 'fr_fr', nameAr: 'فرنسية باريسية فصيحة', nameEn: 'Standard French', flag: '🇫🇷' },
    ]
  },
  {
    code: 'es',
    nameAr: 'الإسبانية',
    nameEn: 'Spanish',
    flag: '🇪🇸',
    dialects: [
      { id: 'es_es', nameAr: 'إسبانية قشتالية نقية', nameEn: 'Castilian Spanish', flag: '🇪🇸' },
    ]
  },
  {
    code: 'de',
    nameAr: 'الألمانية',
    nameEn: 'German',
    flag: '🇩🇪',
    dialects: [
      { id: 'de_de', nameAr: 'ألمانية فصيحة (Hochdeutsch)', nameEn: 'Standard German', flag: '🇩🇪' },
    ]
  },
  {
    code: 'tr',
    nameAr: 'التركية',
    nameEn: 'Turkish',
    flag: '🇹🇷',
    dialects: [
      { id: 'tr_tr', nameAr: 'تركية إسطنبولية معاصرة', nameEn: 'Standard Turkish', flag: '🇹🇷' },
    ]
  },
];

export const TONE_STYLES: ToneStyle[] = [
  {
    id: 'professional_news',
    nameAr: 'إخباري ورسمي',
    nameEn: 'News & Official',
    iconName: 'Newspaper',
    description: 'نبرة مذيع الأخبار: واضحة، متزنة، ومخارج حروف محكمة'
  },
  {
    id: 'documentary_story',
    nameAr: 'وثائقي وسردي',
    nameEn: 'Documentary',
    iconName: 'Compass',
    description: 'طابع سينمائي عميق مع وقفات درامية وتأملية'
  },
  {
    id: 'energetic_promo',
    nameAr: 'إعلاني وحماسي',
    nameEn: 'Commercial & Energetic',
    iconName: 'Sparkles',
    description: 'حيوية لافتة وسرعة جذابة لإعلانات المتاجر والترويج'
  },
  {
    id: 'educational_tutor',
    nameAr: 'تعليمي وشرح',
    nameEn: 'Educational',
    iconName: 'GraduationCap',
    description: 'صوت هادئ يشرح بتؤدة وصبر لتوصيل المعلومة بوضوح'
  },
  {
    id: 'conversational_warm',
    nameAr: 'حوار وودي',
    nameEn: 'Conversational',
    iconName: 'MessageCircle',
    description: 'حديث طبيعي يشبه جلسات البودكاست مع الأصدقاء'
  },
  {
    id: 'poetic_literary',
    nameAr: 'شعري وأدبي',
    nameEn: 'Poetic & Literary',
    iconName: 'Feather',
    description: 'إلقاء نغمي ذو وقع موسيقي للقصائد والنثر الأدبي'
  },
  {
    id: 'calm_meditation',
    nameAr: 'تأمل واسترخاء',
    nameEn: 'Meditation & Calm',
    iconName: 'Moon',
    description: 'همس لطيف وإيقاع بطيء يبعث على الهدوء والراحة'
  },
  {
    id: 'custom',
    nameAr: 'تخصيص حر (نبرة مخصصة)',
    nameEn: 'Custom Direction',
    iconName: 'Sliders',
    description: 'اكتب توجيهاتك الصوتية الخاصة بالتفصيل للذكاء الاصطناعي'
  },
];

export const SAMPLE_SCRIPTS: SampleScript[] = [
  {
    id: 'news-breaking',
    categoryAr: 'نشرات الأخبار',
    titleAr: 'تقرير اقتصادي وتقني عاجل',
    text: 'أهلاً بكم في هذه النشرة الاقتصادية. سجّلت أسواق الابتكار الرقمي والذكاء الاصطناعي نمواً غير مسبوق اليوم، مدفوعة بطلب متزايد على تقنيات معالجة الصوت الطبيعي الفورية.',
    recommendedVoice: 'Fenrir',
    recommendedTone: 'professional_news',
    recommendedDialect: 'msa'
  },
  {
    id: 'documentary-nature',
    categoryAr: 'أفلام وثائقية',
    titleAr: 'سرد سينمائي عن الطبيعة',
    text: 'حين تنبثق خيوط الفجر الأولى فوق قمم الجبال الشاهقة، يستيقظ الوادي على سيمفونية من أصوات الحياة الفطرية. هنا، في قلب البرية، يروي كل حجر قصة صمود امتدت لآلاف السنين.',
    recommendedVoice: 'Charon',
    recommendedTone: 'documentary_story',
    recommendedDialect: 'msa'
  },
  {
    id: 'promo-app',
    categoryAr: 'إعلانات وترويج',
    titleAr: 'إطلاق تطبيق ذكي جديد',
    text: 'هل تبحث عن الطريقة الأسهل لتحويل أفكارك إلى أصوات واقعية ومبهرة؟ اكتشف تطبيقنا الجديد اليوم! تجربة فريدة، تحكم كامل بكل نبرة، وجودة استوديو لا تقبل المساومة. جرّبه الآن مجاناً!',
    recommendedVoice: 'Puck',
    recommendedTone: 'energetic_promo',
    recommendedDialect: 'msa'
  },
  {
    id: 'podcast-intro',
    categoryAr: 'بودكاست وحوار',
    titleAr: 'افتتاحية حلقة بودكاست ثقافي',
    text: 'مرحباً بكم أصدقائي في حلقة جديدة من بودكاست "آفاق". في حوارنا اليوم، نستضيف نخبة من المبتكرين لنناقش كيف يعيد الصوت البشري تشكيل علاقتنا بالتكنولوجيا الحديثة. استمعوا إلينا باستمتاع!',
    recommendedVoice: 'Kore',
    recommendedTone: 'conversational_warm',
    recommendedDialect: 'msa'
  },
  {
    id: 'gulf-promo',
    categoryAr: 'لهجات عربية',
    titleAr: 'لهجة خليجية ترحيبية',
    text: 'يا هلا ومسهلا فيكم! نورتونا اليوم، ويسعدنا نقدم لكم أفضل الخدمات اللي تليق بذوقكم الرفيع، وبأسعار ما تلقون مثلها. حياكم الله معنا وسعداء بتواصلكم دائماً.',
    recommendedVoice: 'Puck',
    recommendedTone: 'conversational_warm',
    recommendedDialect: 'gulf'
  },
  {
    id: 'egyptian-story',
    categoryAr: 'لهجات عربية',
    titleAr: 'لهجة مصرية ودودة',
    text: 'يا مساء الجمال عليكم جميعاً! النهاردة مجهزين لكم مفاجأة حلوة جداً هتعجب كل الناس اللي بتحب الفن والإبداع وسحر الصوت الطبيعي. خليكم متابعين معانا عشان اللي جاي أجمد بكتير!',
    recommendedVoice: 'Kore',
    recommendedTone: 'conversational_warm',
    recommendedDialect: 'egyptian'
  },
  {
    id: 'meditation-calm',
    categoryAr: 'استرخاء وتأمل',
    titleAr: 'جلسة تنفس واسترخاء',
    text: 'خذ نفساً عميقاً... املأ رئتيك بالهواء النقي، ثم ازفره ببطء وراحة. دع كل التوتر يتلاشى بعيداً، وتأمل هذا الهدوء الذي يغمر قلبك الآن.',
    recommendedVoice: 'Zephyr',
    recommendedTone: 'calm_meditation',
    recommendedDialect: 'msa'
  },
  {
    id: 'english-tech',
    categoryAr: 'لغات أجنبية',
    titleAr: 'English: Next-Gen AI Audio',
    text: 'Welcome to the next generation of neural text to speech. Experience crystal-clear pronunciation, expressive emotional nuance, and unmatched studio fidelity in any language.',
    recommendedVoice: 'Kore',
    recommendedTone: 'professional_news',
    recommendedDialect: 'en_us'
  }
];
