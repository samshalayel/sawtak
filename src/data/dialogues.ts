// Ready-made two-speaker scripts. Lines reference speakers by index (0/1) so templates
// render with whatever names the user gave their speakers.

export interface DialogueTemplate {
  id: string;
  titleAr: string;
  categoryAr: string;
  recommendedTone: string;
  recommendedDialect: string;
  lines: [0 | 1, string][];
}

export const DIALOGUE_TEMPLATES: DialogueTemplate[] = [
  {
    id: 'podcast-tech',
    categoryAr: 'بودكاست',
    titleAr: 'افتتاحية بودكاست تقني',
    recommendedTone: 'conversational_warm',
    recommendedDialect: 'msa',
    lines: [
      [0, 'أهلاً وسهلاً بكم في حلقةٍ جديدة من بودكاست آفاق التقنية.'],
      [1, 'وأهلاً بكم جميعاً! حلقة اليوم مميّزة جداً، صح؟'],
      [0, 'صحيح! اليوم سنتحدّث عن الذكاء الاصطناعي، وكيف يغيّر طريقة عملنا كلّ يوم.'],
      [1, 'موضوعٌ يشغل الجميع. أنا شخصياً صرت أستخدمه في كتابة الإيميلات وتنظيم المهام.'],
      [0, 'وهنا السؤال المهم: هل سيأخذ الذكاء الاصطناعي وظائفنا، أم سيجعلنا أفضل فيها؟'],
      [1, 'سؤالٌ رائع... ودعونا نكتشف الإجابة معاً في هذه الحلقة.'],
    ],
  },
  {
    id: 'interview-business',
    categoryAr: 'مقابلة',
    titleAr: 'مقابلة مع رائدة أعمال',
    recommendedTone: 'professional_news',
    recommendedDialect: 'msa',
    lines: [
      [0, 'مرحباً بكِ في برنامجنا، ويسعدنا وجودكِ معنا اليوم.'],
      [1, 'شكراً جزيلاً على الاستضافة، سعيدةٌ جداً بوجودي هنا.'],
      [0, 'لنبدأ من البداية: كيف جاءتكِ فكرة مشروعكِ الأول؟'],
      [1, 'بدأت الفكرة من مشكلةٍ واجهتها بنفسي، ولم أجد لها حلاً مناسباً في السوق.'],
      [0, 'وما أصعب تحدٍّ واجهتِه في السنة الأولى؟'],
      [1, 'التمويل بلا شك. لكنّ الإصرار والفريق الصحيح صنعا الفرق.'],
    ],
  },
  {
    id: 'ad-restaurant',
    categoryAr: 'إعلان',
    titleAr: 'إعلان حواري لمطعم (شامي)',
    recommendedTone: 'energetic_promo',
    recommendedDialect: 'levantine',
    lines: [
      [0, 'شو جوعان؟ وما بتعرف شو تاكل اليوم؟'],
      [1, 'والله دايماً نفس السؤال! بدّي شي طيّب وسريع.'],
      [0, 'خلص، جرّب مطعم البيت الشامي! أطيب شاورما بالبلد، وعليها عرض اليوم.'],
      [1, 'عرض؟ احكيلي شو العرض؟'],
      [0, 'وجبتين بسعر وحدة، والتوصيل مجاني! بس لآخر الأسبوع.'],
      [1, 'يلا، أنا طالب هلّق!'],
    ],
  },
  {
    id: 'support-call',
    categoryAr: 'خدمة عملاء',
    titleAr: 'مكالمة خدمة عملاء',
    recommendedTone: 'conversational_warm',
    recommendedDialect: 'msa',
    lines: [
      [0, 'أهلاً بك، معك فريق خدمة العملاء. كيف يمكنني مساعدتك اليوم؟'],
      [1, 'مرحباً، طلبتُ منتجاً قبل ثلاثة أيام ولم يصلني حتى الآن.'],
      [0, 'أعتذر عن التأخير. هل يمكنك تزويدي برقم الطلب من فضلك؟'],
      [1, 'نعم، الرقم هو أربعة، خمسة، اثنان، سبعة.'],
      [0, 'شكراً لك. طلبك الآن مع شركة الشحن، وسيصلك غداً قبل الظهر.'],
      [1, 'ممتاز، شكراً جزيلاً على المساعدة!'],
    ],
  },
  {
    id: 'gulf-podcast',
    categoryAr: 'بودكاست',
    titleAr: 'سوالف بودكاست (خليجي)',
    recommendedTone: 'conversational_warm',
    recommendedDialect: 'gulf',
    lines: [
      [0, 'هلا والله ومسهلا فيكم في حلقة جديدة!'],
      [1, 'هلا فيك، والله اشتقنا للسوالف.'],
      [0, 'اليوم بنتكلم عن السفر، وين أحلى وجهة رحتها هالسنة؟'],
      [1, 'بصراحة جورجيا، طبيعة خيالية وأسعار حلوة.'],
      [0, 'كلامك صح، وأنا ناوي أروحها الصيف الجاي إن شاء الله.'],
    ],
  },
];

export function renderTemplate(template: DialogueTemplate, names: [string, string]): string {
  return template.lines.map(([speaker, text]) => `${names[speaker]}: ${text}`).join('\n');
}

/** Parses "Name: text" lines. Lines without a known speaker prefix continue the previous turn. */
export function parseDialogueScript(script: string, names: [string, string]) {
  const lines: { speaker: string; text: string }[] = [];
  const unknownSpeakers = new Set<string>();

  for (const raw of script.split('\n')) {
    // Expression tags typed before the name ("[excited] سارة: …") belong to that speaker's text
    const lead = raw.trim().match(/^((?:\[[a-z][a-z' -]{0,30}\]\s*)+)(.*)$/i);
    const tags = lead ? `${lead[1].trim()} ` : '';
    const line = lead ? lead[2].trim() : raw.trim();
    if (!line) continue;
    const match = line.match(/^([^:：]{1,30})\s*[:：]\s*(.+)$/);
    const speaker = match?.[1].trim();
    if (match && speaker && names.includes(speaker)) {
      lines.push({ speaker, text: tags + match[2].trim() });
    } else if (match && speaker && !speaker.includes(' ') ) {
      // Looks like "Name: text" but the name isn't one of the two speakers
      unknownSpeakers.add(speaker);
      lines.push({ speaker, text: tags + match[2].trim() });
    } else if (lines.length) {
      lines[lines.length - 1].text += ` ${tags}${line}`;
    } else {
      lines.push({ speaker: names[0], text: tags + line });
    }
  }
  return { lines, unknownSpeakers: [...unknownSpeakers] };
}
