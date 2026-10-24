// Curated showcase samples for the voice picker. Each is generated once with Gemini,
// cached as WAV under public/samples, and reused (see /api/tts/preview/:voiceId).
export const VOICE_PREVIEWS: Record<string, { text: string; style: string }> = {
  Kore: {
    text: 'أهلاً وسهلاً بكم في حلقةٍ جديدة. اليوم، سنتحدّث عن فكرةٍ بسيطة، لكنّها قادرةٌ على تغيير طريقة عملكم بالكامل... فابقَوا معي حتى النهاية.',
    style: 'Warm, confident female podcast host. Natural conversational flow, genuine smile in the voice, clear Modern Standard Arabic articulation, short natural pauses at commas.'
  },
  Puck: {
    text: 'جاهزين للعرض الأقوى هذا الموسم؟ خصوماتٌ تصل إلى خمسين بالمئة، على كلّ ما تحبّون! العرض لفترةٍ محدودة فقط... اطلبوا الآن، ولا تفوّتوا الفرصة!',
    style: 'Energetic, upbeat male commercial voiceover. Punchy, exciting and persuasive, rising enthusiasm toward the call to action, crisp Modern Standard Arabic.'
  },
  Fenrir: {
    text: 'في أعماق الصحراء العربية، وتحت سماءٍ لا تعرف الغيوم، تختبئ حضاراتٌ عمرها آلاف السنين. حضاراتٌ صنعت التاريخ... ثم اختفت بصمت.',
    style: 'Deep, authoritative male documentary narrator. Slow, weighty and cinematic, resonant low register, dramatic pauses, flawless classical Arabic pronunciation.'
  },
  Zephyr: {
    text: 'خذ نفساً عميقاً... واتركه يخرج ببطء. دع أفكارك تهدأ، وكتفيك يسترخيان. أنت الآن في مكانٍ آمن، هادئ... ومريح تماماً.',
    style: 'Soft, gentle and soothing female meditation guide. Slow relaxed pace, breathy warmth, long calming pauses, intimate and reassuring.'
  },
  Charon: {
    text: 'كانت بغداد في ذلك الزمن منارةً للعلم والمعرفة. في بيت الحكمة، اجتمع العلماء من كلّ الأمم، يترجمون ويكتبون... ويصنعون مستقبل العالم.',
    style: 'Calm, cinematic male storyteller narrating history. Engaging, thoughtful and immersive, measured pace with expressive emphasis, elegant Modern Standard Arabic.'
  },
  Leda: {
    text: 'يا جماعة، لازم تجرّبوا هالتطبيق! بثواني بتحوّلوا أي فكرة لفيديو مميّز... وصدقوني، النتيجة رح تفاجئكم!',
    style: 'Youthful, playful and bubbly young female content creator. Fast, fun and expressive, casual social-media energy, natural Levantine-flavored Arabic.'
  },
  Aoede: {
    text: 'صباح الخير من شاطئ البحر! الشمس دافئة، والهواء منعش... واليوم، سنأخذكم في جولةٍ لأجمل الأماكن المخفيّة في المدينة.',
    style: 'Breezy, light and cheerful female travel vlogger. Relaxed, airy and natural, smiling voice, easygoing rhythm, clear Modern Standard Arabic.'
  },
  Despina: {
    text: 'الأناقة ليست ما ترتدينه فقط... إنها الثقة التي تشعرين بها. اكتشفي مجموعتنا الجديدة، حيث تلتقي الفخامة بالبساطة.',
    style: 'Smooth, elegant and sophisticated female luxury-brand voiceover. Velvety, slow and refined, intimate and premium, polished Modern Standard Arabic.'
  },
  Sulafat: {
    text: 'في قديم الزمان، كان هناك أرنبٌ صغير يحبّ النجوم كثيراً. وفي كلّ ليلة، كان يصعد إلى أعلى التلّة... ويحلم أن يلمسها.',
    style: 'Warm, tender and caring female storyteller reading a bedtime story to children. Gentle, expressive and affectionate, slow comforting pace.'
  },
  Achernar: {
    text: 'استلقِ براحة... وأغلق عينيك. استمع إلى صوت المطر الهادئ... ودع جسدك يغرق ببطء في نومٍ عميقٍ وهانئ.',
    style: 'Very soft, hushed, near-whisper female sleep guide. Extremely slow and calm, long pauses, soothing and intimate, minimal intensity.'
  },
  Gacrux: {
    text: 'تشير نتائج هذا العام إلى نموٍّ ملحوظ في جميع القطاعات. وسنستعرض معكم اليوم أبرز الإنجازات، والخطط الاستراتيجية للمرحلة المقبلة.',
    style: 'Mature, confident and professional female corporate presenter. Composed, credible and articulate, steady pace, formal Modern Standard Arabic.'
  },
  Orus: {
    text: 'عناية المسافرين: تبدأ الآن إجراءات الصعود إلى الرحلة رقم مئتين وخمسة عشر، المتّجهة إلى دبي، من البوابة رقم ثمانية.',
    style: 'Firm, clear and authoritative male announcer. Precise diction, steady official tone, measured pace, crisp Modern Standard Arabic.'
  },
  Algieba: {
    text: 'مساء الخير، وأهلاً بكم من جديد في برنامجكم المفضّل. الليلة عندنا ضيفٌ مميّز، وحكاية تستحقّ أن تُروى... فخلّيكم معنا.',
    style: 'Smooth, charismatic male radio host. Warm, engaging and confident, rich mid-low voice, natural late-night radio flow.'
  },
  Iapetus: {
    text: 'في هذا الدرس، سنتعلّم معاً كيف ننشئ أوّل موقعٍ إلكتروني خطوةً بخطوة. لا تقلق إن كنت مبتدئاً... الأمر أسهل ممّا تتوقّع.',
    style: 'Clear, friendly and relaxed male tech instructor. Patient and encouraging, very clear articulation, moderate pace, Modern Standard Arabic.'
  },
  Sadaltager: {
    text: 'يقول ابن خلدون في مقدّمته: إنّ الإنسان مدنيٌّ بالطبع. وهذه العبارة القصيرة تختصر فلسفةً كاملة عن طبيعة المجتمع البشري.',
    style: 'Knowledgeable, composed and thoughtful male lecturer. Calm authority, scholarly and measured, precise classical Arabic pronunciation.'
  },
  Achird: {
    text: 'أهلاً وسهلاً بك، معك فريق خدمة العملاء. يسعدنا تواصلك معنا، ونحن هنا لمساعدتك في أيّ وقت... كيف يمكننا خدمتك اليوم؟',
    style: 'Friendly, warm and approachable male customer-service agent. Polite, reassuring and helpful, natural smile in the voice, clear Modern Standard Arabic.'
  },
  Algenib: {
    text: 'هل أنت مستعدّ للتحدّي الأكبر؟ المنافسة اشتعلت، والجمهور ينتظر... الليلة، لا مكان إلّا للأقوياء!',
    style: 'Gravelly, powerful and intense male trailer voice. Bold, gritty and dramatic, high energy for sports and gaming promos, punchy delivery.'
  },
  // Character samples (adult voices directed as children / an angry delivery)
  Laomedeia: {
    text: 'مرحباً يا أصدقائي! أنا أحبُّ الرسمَ كثيراً... هل تريدونَ أن تَرَوا لوحتي الجديدة؟ إنّها قوسُ قُزَح، بكلِّ الألوان!',
    style: 'A cheerful 8-year-old little girl speaking. Very high-pitched, small childlike voice, innocent, playful and excited, giggly energy, Arabic children cartoon dubbing style, clear Modern Standard Arabic.'
  },
  Autonoe: {
    text: 'يا رِفاق! لقد وجدتُ خريطةَ الكنز! هيّا بنا نبحثُ عنه قبلَ أن تغيبَ الشمس... أنا متأكّدٌ أنّه هنا!',
    style: 'An adventurous 9-year-old little boy speaking. High-pitched young childlike voice (not an adult), excited and brave, energetic, Arabic children cartoon dubbing style, clear Modern Standard Arabic.'
  },
  Alnilam: {
    text: 'كفى! لقد سمعتُ هذا الكلامَ ألفَ مرّة! أنتم لا تفهمون... هذه آخرُ فرصة، هل تسمعني؟ آخرُ فرصة!',
    style: 'A furious angry man shouting. Intense rage, loud and explosive, sharp aggressive emphasis on each word, tense breathing, trembling with anger, dramatic pauses, Modern Standard Arabic.'
  },
};
