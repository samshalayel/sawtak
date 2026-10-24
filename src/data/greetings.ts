import type { LucideIcon } from 'lucide-react';
import { Cake, Moon, Sparkles, Star, TreePine, PartyPopper, Gem, GraduationCap, Baby, HeartPulse, Flower2, Trophy } from 'lucide-react';

// Voice greetings: occasions, ready-made messages and suggested voices. The server keeps the matching
// visual themes (server/greeting-themes.ts) under the same ids.

/** Who the message addresses: male, female, or plural (a couple / a family). */
export type Gender = 'm' | 'f' | 'p';

export const GENDER_LABELS: Record<Gender, string> = { m: 'ذكر', f: 'أنثى', p: 'جمع (زوجان / عائلة)' };

export interface GreetingTemplate {
  id: string;
  label: string;
  dialect: 'msa' | 'levantine';
  tone: string;                 // TONE_STYLES id
  voice?: string;               // voice that suits this message (e.g. a child for "from the kids")
  text: Partial<Record<Gender, string>>;
}

export interface Occasion {
  id: string;
  nameAr: string;
  icon: LucideIcon;
  colors: [string, string];     // same gradient as the video background
  accent: string;               // frame / decoration colour in the video (server/greeting-themes.ts)
  titleColor?: string;          // headline colour in the video when not white
  genders: Gender[];
  defaultGender: Gender;
  namePlaceholder: string;
  style: string;                // delivery direction for the voice
  title: Partial<Record<Gender, string>>;
  templates: GreetingTemplate[];
}

export const OCCASIONS: Occasion[] = [
  {
    id: 'birthday',
    nameAr: 'عيد ميلاد',
    icon: Cake,
    colors: ['#7c3aed', '#db2777'],
    accent: '#fde047',
    genders: ['m', 'f'],
    defaultGender: 'f',
    namePlaceholder: 'مثال: سارة',
    style: 'بنبرة احتفالية مبهجة ودافئة، وابتسامة واضحة في الصوت',
    title: { m: 'عيد ميلاد سعيد يا {name}', f: 'عيد ميلاد سعيد يا {name}' },
    templates: [
      {
        id: 'warm', label: 'فصحى دافئة', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'كل عام وأنتَ بخير يا {name}! في يوم ميلادك، أتمنى لك عاماً جديداً مليئاً بالفرح والصحة والنجاح، وأن تتحقق كل أحلامك. أنتَ تستحق كل الخير، وعيد ميلاد سعيد!',
          f: 'كل عام وأنتِ بخير يا {name}! في يوم ميلادكِ، أتمنى لكِ عاماً جديداً مليئاً بالفرح والصحة والنجاح، وأن تتحقق كل أحلامكِ. أنتِ تستحقين كل الخير، وعيد ميلاد سعيد!',
        },
      },
      {
        id: 'fun', label: 'عامية مرحة', dialect: 'levantine', tone: 'energetic_promo',
        text: {
          m: 'يا {name}، كل سنة وإنت سالم! سنة حلوة يا جميل، وإن شاء الله السنة الجاية تكون أحلى من اللي قبلها، مليانة ضحك ونجاح وناس بتحبك. عقبال المية سنة!',
          f: 'يا {name}، كل سنة وإنتِ سالمة! سنة حلوة يا جميلة، وإن شاء الله السنة الجاية تكون أحلى من اللي قبلها، مليانة ضحك ونجاح وناس بتحبك. عقبال المية سنة!',
        },
      },
      {
        id: 'kids', label: 'بصوت طفل', dialect: 'levantine', tone: 'energetic_promo', voice: 'Laomedeia',
        text: {
          m: 'يا {name}! كل سنة وإنت طيب! بحبك كتير كتير، وبدي إياك تضل مبسوط على طول. عيد ميلاد سعيد، وهاي بوسة كبيرة إلك!',
          f: 'يا {name}! كل سنة وإنتِ طيبة! بحبك كتير كتير، وبدي إياكِ تضلي مبسوطة على طول. عيد ميلاد سعيد، وهاي بوسة كبيرة إلك!',
        },
      },
    ],
  },
  {
    id: 'christmas',
    nameAr: 'عيد الميلاد المجيد',
    icon: TreePine,
    colors: ['#b91c1c', '#450a0a'],
    accent: '#fde68a',
    genders: ['m', 'f', 'p'],
    defaultGender: 'm',
    namePlaceholder: 'مثال: جورج',
    style: 'بنبرة دافئة هادئة مليئة بالمحبة والسلام',
    title: { m: 'ميلاد مجيد يا {name}', f: 'ميلاد مجيد يا {name}', p: 'ميلاد مجيد يا {name}' },
    templates: [
      {
        id: 'warm', label: 'فصحى دافئة', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'ميلاد مجيد يا {name}! في هذه الأيام المباركة، أتمنى لك ولعائلتك سلاماً يملأ القلب، وفرحاً يدوم، وعاماً جديداً مليئاً بالمحبة والخير. كل عام وأنتَ بخير.',
          f: 'ميلاد مجيد يا {name}! في هذه الأيام المباركة، أتمنى لكِ ولعائلتكِ سلاماً يملأ القلب، وفرحاً يدوم، وعاماً جديداً مليئاً بالمحبة والخير. كل عام وأنتِ بخير.',
          p: 'ميلاد مجيد يا {name}! في هذه الأيام المباركة، أتمنى لكم سلاماً يملأ القلوب، وفرحاً يدوم، وعاماً جديداً مليئاً بالمحبة والخير. كل عام وأنتم بخير.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'conversational_warm',
        text: {
          m: 'يا {name}، ميلاد مجيد وسنة حلوة! الله يحميك ويحمي العيلة، ويجعل أيامك كلها سلام ومحبة. كل سنة وإنت بخير!',
          f: 'يا {name}، ميلاد مجيد وسنة حلوة! الله يحميكِ ويحمي العيلة، ويجعل أيامك كلها سلام ومحبة. كل سنة وإنتِ بخير!',
          p: 'يا {name}، ميلاد مجيد وسنة حلوة! الله يحميكم ويحمي العيلة، ويجعل أيامكم كلها سلام ومحبة. كل سنة وإنتو بخير!',
        },
      },
    ],
  },
  {
    id: 'new_year',
    nameAr: 'رأس السنة',
    icon: PartyPopper,
    colors: ['#020617', '#4c1d95'],
    accent: '#fbbf24',
    genders: ['m', 'f', 'p'],
    defaultGender: 'm',
    namePlaceholder: 'مثال: محمد',
    style: 'بنبرة متفائلة احتفالية وحماسية',
    title: { m: 'سنة سعيدة يا {name}', f: 'سنة سعيدة يا {name}', p: 'سنة سعيدة يا {name}' },
    templates: [
      {
        id: 'warm', label: 'فصحى', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'سنة جديدة سعيدة يا {name}! أتمنى أن يحمل لك العام الجديد بدايات جميلة، ونجاحات تفوق توقعاتك، وأياماً مليئة بالصحة والطمأنينة. كل عام وأنتَ بخير.',
          f: 'سنة جديدة سعيدة يا {name}! أتمنى أن يحمل لكِ العام الجديد بدايات جميلة، ونجاحات تفوق توقعاتكِ، وأياماً مليئة بالصحة والطمأنينة. كل عام وأنتِ بخير.',
          p: 'سنة جديدة سعيدة يا {name}! أتمنى أن يحمل لكم العام الجديد بدايات جميلة، ونجاحات تفوق توقعاتكم، وأياماً مليئة بالصحة والطمأنينة. كل عام وأنتم بخير.',
        },
      },
      {
        id: 'fun', label: 'عامية', dialect: 'levantine', tone: 'energetic_promo',
        text: {
          m: 'يا {name}، سنة سعيدة! الله يجعلها سنة خير عليك، تحقق فيها كل اللي بتتمناه، وتضل مبسوط ومرتاح البال. كل سنة وإنت سالم!',
          f: 'يا {name}، سنة سعيدة! الله يجعلها سنة خير عليكِ، تحققي فيها كل اللي بتتمنيه، وتضلي مبسوطة ومرتاحة البال. كل سنة وإنتِ سالمة!',
          p: 'يا {name}، سنة سعيدة! الله يجعلها سنة خير عليكم، تحققوا فيها كل اللي بتتمنوه، وتضلوا مبسوطين ومرتاحين البال. كل سنة وإنتو سالمين!',
        },
      },
    ],
  },
  {
    id: 'ramadan',
    titleColor: '#fde68a',
    nameAr: 'رمضان',
    icon: Moon,
    colors: ['#0f172a', '#1e3a8a'],
    accent: '#facc15',
    genders: ['m', 'f', 'p'],
    defaultGender: 'm',
    namePlaceholder: 'مثال: أبو أحمد',
    style: 'بنبرة روحانية هادئة دافئة ومطمئنة',
    title: { m: 'رمضان كريم يا {name}', f: 'رمضان كريم يا {name}', p: 'رمضان كريم يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'مبارك عليك الشهر يا {name}. أسأل الله أن يكون رمضان هذا العام شهر خير وبركة عليك وعلى أهلك، وأن يتقبل منا ومنكم الصيام والقيام وصالح الأعمال. رمضان كريم!',
          f: 'مبارك عليكِ الشهر يا {name}. أسأل الله أن يكون رمضان هذا العام شهر خير وبركة عليكِ وعلى أهلكِ، وأن يتقبل منا ومنكم الصيام والقيام وصالح الأعمال. رمضان كريم!',
          p: 'مبارك عليكم الشهر يا {name}. أسأل الله أن يكون رمضان هذا العام شهر خير وبركة عليكم، وأن يتقبل منا ومنكم الصيام والقيام وصالح الأعمال. رمضان كريم!',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'conversational_warm',
        text: {
          m: 'يا {name}، رمضان كريم! الله يعيده عليك وعلى أهلك بالخير والصحة، ويكون شهر بركة وراحة بال. كل عام وإنت بخير.',
          f: 'يا {name}، رمضان كريم! الله يعيده عليكِ وعلى أهلك بالخير والصحة، ويكون شهر بركة وراحة بال. كل عام وإنتِ بخير.',
          p: 'يا {name}، رمضان كريم! الله يعيده عليكم بالخير والصحة، ويكون شهر بركة وراحة بال. كل عام وإنتو بخير.',
        },
      },
    ],
  },
  {
    id: 'eid_fitr',
    nameAr: 'عيد الفطر',
    icon: Sparkles,
    colors: ['#065f46', '#0e7490'],
    accent: '#fcd34d',
    genders: ['m', 'f', 'p'],
    defaultGender: 'm',
    namePlaceholder: 'مثال: خالد',
    style: 'بنبرة فرحة مبهجة ودافئة',
    title: { m: 'عيد فطر سعيد يا {name}', f: 'عيد فطر سعيد يا {name}', p: 'عيد فطر سعيد يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'كل عام وأنتَ بخير يا {name}، وعيد فطر مبارك. تقبّل الله منا ومنك صالح الأعمال، وأعاده عليك وعلى أحبّتك بالفرح والصحة والسعادة.',
          f: 'كل عام وأنتِ بخير يا {name}، وعيد فطر مبارك. تقبّل الله منا ومنكِ صالح الأعمال، وأعاده عليكِ وعلى أحبّتكِ بالفرح والصحة والسعادة.',
          p: 'كل عام وأنتم بخير يا {name}، وعيد فطر مبارك. تقبّل الله منا ومنكم صالح الأعمال، وأعاده عليكم وعلى أحبّتكم بالفرح والصحة والسعادة.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'energetic_promo',
        text: {
          m: 'عيدك مبارك يا {name}! ينعاد عليك بالخير والصحة، وتضل أيامك كلها أعياد وفرح. كل عام وإنت بألف خير!',
          f: 'عيدك مبارك يا {name}! ينعاد عليكِ بالخير والصحة، وتضل أيامك كلها أعياد وفرح. كل عام وإنتِ بألف خير!',
          p: 'عيدكم مبارك يا {name}! ينعاد عليكم بالخير والصحة، وتضل أيامكم كلها أعياد وفرح. كل عام وإنتو بألف خير!',
        },
      },
      {
        id: 'kids', label: 'بصوت طفل', dialect: 'levantine', tone: 'energetic_promo', voice: 'Autonoe',
        text: {
          m: 'يا {name}! عيدك مبارك! كل سنة وإنت طيب، وبدي عيدية كبيرة كبيرة!',
          f: 'يا {name}! عيدك مبارك! كل سنة وإنتِ طيبة، وبدي عيدية كبيرة كبيرة!',
          p: 'يا {name}! عيدكم مبارك! كل سنة وإنتو طيبين، وبدي عيدية كبيرة كبيرة!',
        },
      },
    ],
  },
  {
    id: 'mothers_day',
    nameAr: 'عيد الأم',
    icon: Flower2,
    colors: ['#9d174d', '#f97316'],
    accent: '#ffe4e6',
    genders: ['f'],
    defaultGender: 'f',
    namePlaceholder: 'مثال: أمي الغالية',
    style: 'بنبرة حنونة دافئة مليئة بالحب والامتنان',
    title: { f: 'كل عام وأنتِ بخير يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'poetic_literary',
        text: {
          f: 'إلى {name}، أغلى الناس على قلبي. كل عام وأنتِ بخير، وكل عام وأنتِ النور الذي يضيء حياتي. شكراً على حبكِ وتعبكِ وصبركِ، أحبكِ أكثر مما تقول الكلمات.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'conversational_warm',
        text: {
          f: 'يا {name}، يا ست الحبايب، كل سنة وإنتِ تاج راسنا! الله يخليلنا ياكي ويطوّل بعمرك، وما يحرمنا من دعواتك وضحكتك. بحبك كتير!',
        },
      },
      {
        id: 'kids', label: 'بصوت طفل', dialect: 'levantine', tone: 'conversational_warm', voice: 'Laomedeia',
        text: {
          f: 'ماما! كل سنة وإنتِ أحلى ماما بالدنيا! بحبك قد السما، وشكراً لأنك دايماً معي. يا {name}، إنتِ أغلى إشي عندي!',
        },
      },
    ],
  },
  {
    id: 'eid_adha',
    nameAr: 'عيد الأضحى',
    icon: Star,
    colors: ['#0c4a6e', '#047857'],
    accent: '#fbbf24',
    genders: ['m', 'f', 'p'],
    defaultGender: 'm',
    namePlaceholder: 'مثال: الحاج أبو محمود',
    style: 'بنبرة فرحة دافئة ووقورة',
    title: { m: 'عيد أضحى مبارك يا {name}', f: 'عيد أضحى مبارك يا {name}', p: 'عيد أضحى مبارك يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'كل عام وأنتَ بخير يا {name}، وعيد أضحى مبارك. أسأل الله أن يتقبل منا ومنكم، وأن يعيد عليك هذه الأيام المباركة بالخير واليُمن والبركات.',
          f: 'كل عام وأنتِ بخير يا {name}، وعيد أضحى مبارك. أسأل الله أن يتقبل منا ومنكم، وأن يعيد عليكِ هذه الأيام المباركة بالخير واليُمن والبركات.',
          p: 'كل عام وأنتم بخير يا {name}، وعيد أضحى مبارك. أسأل الله أن يتقبل منا ومنكم، وأن يعيد عليكم هذه الأيام المباركة بالخير واليُمن والبركات.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'conversational_warm',
        text: {
          m: 'أضحى مبارك يا {name}! ينعاد عليك وعلى العيلة بالخير والفرح، والله يتقبل من الجميع. كل سنة وإنت سالم!',
          f: 'أضحى مبارك يا {name}! ينعاد عليكِ وعلى العيلة بالخير والفرح، والله يتقبل من الجميع. كل سنة وإنتِ سالمة!',
          p: 'أضحى مبارك يا {name}! ينعاد عليكم بالخير والفرح، والله يتقبل من الجميع. كل سنة وإنتو سالمين!',
        },
      },
    ],
  },
  {
    id: 'wedding',
    nameAr: 'زواج',
    icon: Gem,
    colors: ['#be185d', '#f472b6'],
    accent: '#fff1f2',
    genders: ['p', 'm', 'f'],
    defaultGender: 'p',
    namePlaceholder: 'مثال: أحمد وسارة',
    style: 'بنبرة فرحة احتفالية دافئة',
    title: { m: 'ألف مبروك يا {name}', f: 'ألف مبروك يا {name}', p: 'ألف مبروك يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'ألف ألف مبروك يا {name}! بارك الله لك وبارك عليك وجمع بينكما في خير. أتمنى لكما حياة مليئة بالحب والتفاهم والسعادة.',
          f: 'ألف ألف مبروك يا {name}! بارك الله لكِ وبارك عليكِ وجمع بينكما في خير. أتمنى لكما حياة مليئة بالحب والتفاهم والسعادة.',
          p: 'ألف ألف مبروك يا {name}! بارك الله لكما وبارك عليكما وجمع بينكما في خير. أتمنى لكما حياة مليئة بالحب والتفاهم والسعادة.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'energetic_promo',
        text: {
          m: 'ألف مبروك يا {name}! الله يتمم عليك بخير، ويجعلها جيزة العمر، وتعيش عمر مليان حب وفرح. عقبال البكاري!',
          f: 'ألف مبروك يا {name}! الله يتمم عليكِ بخير، ويجعلها جيزة العمر، وتعيشي عمر مليان حب وفرح. عقبال البكاري!',
          p: 'ألف مبروك يا {name}! الله يتمم عليكم بخير، ويجعل بيتكم مليان حب وفرح ودفا. عقبال البكاري!',
        },
      },
    ],
  },
  {
    id: 'graduation',
    nameAr: 'تخرّج',
    icon: GraduationCap,
    colors: ['#1e3a8a', '#0891b2'],
    accent: '#fde047',
    genders: ['m', 'f'],
    defaultGender: 'm',
    namePlaceholder: 'مثال: يوسف',
    style: 'بنبرة فخورة مبهجة وحماسية',
    title: { m: 'مبروك التخرج يا {name}', f: 'مبروك التخرج يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'ألف مبروك التخرج يا {name}! هذا النجاح ثمرة تعبك وسهرك، ونحن فخورون بك جداً. أتمنى لك مستقبلاً مشرقاً، وخطوات واثقة نحو أحلامك الكبيرة.',
          f: 'ألف مبروك التخرج يا {name}! هذا النجاح ثمرة تعبكِ وسهركِ، ونحن فخورون بكِ جداً. أتمنى لكِ مستقبلاً مشرقاً، وخطوات واثقة نحو أحلامكِ الكبيرة.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'energetic_promo',
        text: {
          m: 'يا {name}، ألف مبروك التخرج! تعبك ما راح عالفاضي، والله يوفقك بالخطوة الجاية ويفتحلك أبواب الخير. فخورين فيك كتير!',
          f: 'يا {name}، ألف مبروك التخرج! تعبك ما راح عالفاضي، والله يوفقك بالخطوة الجاية ويفتحلك أبواب الخير. فخورين فيكِ كتير!',
        },
      },
    ],
  },
  {
    id: 'newborn',
    nameAr: 'مولود جديد',
    icon: Baby,
    colors: ['#0ea5e9', '#f9a8d4'],
    accent: '#ffffff',
    genders: ['p', 'm', 'f'],
    defaultGender: 'p',
    namePlaceholder: 'مثال: أبو آدم وأم آدم',
    style: 'بنبرة فرحة حنونة ودافئة',
    title: { m: 'ألف مبروك يا {name}', f: 'ألف مبروك يا {name}', p: 'ألف مبروك يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'ألف مبروك يا {name}! بارك الله لك في الموهوب، وشكرتَ الواهب، وبلغ أشدّه، ورُزقتَ برّه. جعله الله قرة عين لك وذرية صالحة.',
          f: 'ألف مبروك يا {name}! بارك الله لكِ في الموهوب، وشكرتِ الواهب، وبلغ أشدّه، ورُزقتِ برّه. جعله الله قرة عين لكِ وذرية صالحة.',
          p: 'ألف مبروك يا {name}! بارك الله لكم في الموهوب، وشكرتم الواهب، وبلغ أشدّه، ورُزقتم برّه. جعله الله قرة عين لكم وذرية صالحة.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'conversational_warm',
        text: {
          m: 'ألف الحمد لله على السلامة يا {name}! الله يخليلك ياه، ويتربى بعزك، ويكون فاتحة خير عليك.',
          f: 'ألف الحمد لله على السلامة يا {name}! الله يخليلك ياه، ويتربى بعزك، ويكون فاتحة خير عليكِ.',
          p: 'ألف الحمد لله على السلامة يا {name}! الله يخليلكم ياه، ويتربى بعزكم، ويكون فاتحة خير عليكم.',
        },
      },
    ],
  },
  {
    id: 'get_well',
    nameAr: 'سلامتك',
    icon: HeartPulse,
    colors: ['#0f766e', '#22c55e'],
    accent: '#ecfccb',
    genders: ['m', 'f'],
    defaultGender: 'm',
    namePlaceholder: 'مثال: عمي أبو سامي',
    style: 'بنبرة حنونة هادئة ومطمئنة',
    title: { m: 'سلامتك يا {name}', f: 'سلامتك يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'calm_meditation',
        text: {
          m: 'سلامتك يا {name}، ما تشوف شر. أسأل الله العظيم رب العرش العظيم أن يشفيك شفاءً لا يغادر سقماً، وأن تعود إلينا قريباً بكامل صحتك وعافيتك.',
          f: 'سلامتكِ يا {name}، ما تشوفي شر. أسأل الله العظيم رب العرش العظيم أن يشفيكِ شفاءً لا يغادر سقماً، وأن تعودي إلينا قريباً بكامل صحتكِ وعافيتكِ.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'conversational_warm',
        text: {
          m: 'يا {name}، سلامتك ألف سلامة! الله يشفيك ويقومك بالسلامة، وترجع أقوى من قبل. ناطرينك!',
          f: 'يا {name}، سلامتك ألف سلامة! الله يشفيكي ويقومك بالسلامة، وترجعي أقوى من قبل. ناطرينك!',
        },
      },
    ],
  },
  {
    id: 'congrats',
    nameAr: 'نجاح وترقية',
    icon: Trophy,
    colors: ['#0e7490', '#7c3aed'],
    accent: '#fde047',
    genders: ['m', 'f'],
    defaultGender: 'm',
    namePlaceholder: 'مثال: ليلى',
    style: 'بنبرة فخورة حماسية ومبهجة',
    title: { m: 'ألف مبروك يا {name}', f: 'ألف مبروك يا {name}' },
    templates: [
      {
        id: 'formal', label: 'فصحى', dialect: 'msa', tone: 'conversational_warm',
        text: {
          m: 'ألف مبروك يا {name}! نجاحك اليوم دليل على اجتهادك وتميّزك، وهو بداية لنجاحات أكبر بإذن الله. أتمنى لك دوام التوفيق والتقدم.',
          f: 'ألف مبروك يا {name}! نجاحكِ اليوم دليل على اجتهادكِ وتميّزكِ، وهو بداية لنجاحات أكبر بإذن الله. أتمنى لكِ دوام التوفيق والتقدم.',
        },
      },
      {
        id: 'local', label: 'عامية', dialect: 'levantine', tone: 'energetic_promo',
        text: {
          m: 'مبروك يا {name}! بتستاهل كل خير، والله يوفقك ويعطيك على قد نيتك. لقدّام دايماً!',
          f: 'مبروك يا {name}! بتستاهلي كل خير، والله يوفقك ويعطيكي على قد نيتك. لقدّام دايماً!',
        },
      },
    ],
  },
];

/** Voices offered for greetings (the angry drama voice is left out). Children first: they move people most. */
export const GREETING_VOICE_IDS = [
  'Laomedeia', 'Autonoe', 'Kore', 'Puck', 'Zephyr', 'Charon', 'Leda', 'Fenrir', 'Aoede', 'Orus',
  'Despina', 'Algieba', 'Sulafat', 'Iapetus', 'Achernar', 'Sadaltager', 'Gacrux', 'Achird', 'Algenib',
];

export const fillName = (template: string, name: string) => template.split('{name}').join(name.trim());

/** Picks the text for the chosen gender, falling back to the first form the template has. */
export const templateText = (t: GreetingTemplate, gender: Gender) =>
  t.text[gender] ?? t.text.m ?? t.text.f ?? t.text.p ?? '';

export const occasionTitle = (o: Occasion, gender: Gender) =>
  o.title[gender] ?? o.title.m ?? o.title.f ?? o.title.p ?? '';
