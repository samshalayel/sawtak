// Inline performance tags such as [excited], [reassuring] or [short pause]: the voice model acts on them and never
// reads them aloud, so they stay in the text sent for speech and are removed wherever words are shown or counted
// (video captions, duration estimates). Only Latin-letter tags count, so Arabic text in brackets is left alone.
const AUDIO_TAG = /\[[a-z][a-z' -]{0,30}\]/gi;

export const hasAudioTags = (text: string) => new RegExp(AUDIO_TAG.source, 'i').test(text);

export const stripAudioTags = (text: string) =>
  text.replace(AUDIO_TAG, ' ').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,،؛؟!…:])/g, '$1').replace(/^ +| +$/gm, '');

/** The expressions offered on the page (AudioTagBar) and the only ones the AI script writers may use. */
export const AUDIO_TAG_GROUPS: { title: string; tags: { label: string; tag: string }[] }[] = [
  {
    title: 'أصوات',
    tags: [{ label: 'ضحكة', tag: 'laughing' }, { label: 'تنهيدة', tag: 'sigh' }],
  },
  {
    title: 'وقفات',
    tags: [{ label: 'وقفة قصيرة', tag: 'short pause' }, { label: 'وقفة متوسطة', tag: 'medium pause' }, { label: 'وقفة طويلة', tag: 'long pause' }],
  },
  {
    title: 'مشاعر',
    tags: [
      { label: 'حماس', tag: 'excited' }, { label: 'مرح', tag: 'playful' }, { label: 'مستمتع', tag: 'amused' },
      { label: 'مطمئن', tag: 'reassuring' }, { label: 'واثق', tag: 'confident' }, { label: 'حزين', tag: 'sad' }, { label: 'جدّي', tag: 'serious' },
    ],
  },
  {
    title: 'أسلوب',
    tags: [{ label: 'همس', tag: 'whispering' }, { label: 'بصوت عالٍ', tag: 'shouting' }, { label: 'ساخر', tag: 'sarcastic' }],
  },
];
export const ALLOWED_AUDIO_TAGS = AUDIO_TAG_GROUPS.flatMap(g => g.tags.map(t => t.tag));

/** Keeps only known expression tags in AI-written text (any other bracketed note would be read aloud). */
export const keepKnownAudioTags = (text: string) =>
  text.replace(/\[([^\]]{0,40})\]/g, (m, inner: string) => (ALLOWED_AUDIO_TAGS.includes(inner.trim().toLowerCase()) ? `[${inner.trim().toLowerCase()}]` : ' '))
    .replace(/[ \t]{2,}/g, ' ').trim();
