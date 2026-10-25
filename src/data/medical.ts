// Medical cards and reels: a doctor writes a piece of health information; it becomes an image card and/or a short
// reel with the doctor's identity. Shared by the page and the server.

/** Always on every card and reel; the doctor cannot remove it. */
export const MEDICAL_DISCLAIMER = 'هذه معلومة توعوية ولا تغني عن استشارة الطبيب';

export const MEDICAL_LIMITS = { title: 70, body: 600, reelBody: 900 };

/** Card designs (colour gradient + a medical icon); `icon` is a lucide icon file name. */
export interface MedicalTheme { id: string; label: string; from: string; to: string; icon: string }
export const MEDICAL_THEMES: MedicalTheme[] = [
  { id: 'general', label: 'عام', from: '#075985', to: '#0ea5e9', icon: 'stethoscope' },
  { id: 'heart', label: 'القلب', from: '#9f1239', to: '#f43f5e', icon: 'heart-pulse' },
  { id: 'dental', label: 'الأسنان', from: '#115e59', to: '#2dd4bf', icon: 'smile' },
  { id: 'kids', label: 'الأطفال', from: '#6d28d9', to: '#f59e0b', icon: 'baby' },
  { id: 'nutrition', label: 'التغذية', from: '#166534', to: '#84cc16', icon: 'apple' },
  { id: 'eye', label: 'العيون', from: '#312e81', to: '#6366f1', icon: 'eye' },
];

/**
 * Background scenes (real photos and videos from Pixabay), filtered so nothing distressing is shown. The audience is
 * conservative, so the searches lean on objects, scenery and men, and no woman or girl is ever shown (server/medical.ts).
 */
export const MEDICAL_SCENES: { id: string; label: string; query: string }[] = [
  { id: 'food', label: 'غذاء صحي', query: 'healthy food vegetables fruit' },
  { id: 'exercise', label: 'رياضة', query: 'man running sport' },
  { id: 'doctor', label: 'طبيب وعيادة', query: 'stethoscope doctor medical' },
  { id: 'water', label: 'شرب الماء', query: 'water glass drink' },
  { id: 'sleep', label: 'نوم وراحة', query: 'bedroom pillow bed' },
  { id: 'family', label: 'أب وأبناء', query: 'father son' },
  { id: 'nature', label: 'طبيعة', query: 'nature landscape trees' },
  { id: 'lab', label: 'مختبر وعلوم', query: 'laboratory science microscope' },
];

export interface DoctorProfile {
  name: string;       // "د. سارة أحمد"
  specialty: string;  // "أخصائية تغذية"
  clinic: string;     // optional clinic or centre name
  contact: string;    // phone or handle shown on the card
  color: string;      // accent colour
  hasLogo: boolean;
}

/** One note from the AI review: a sentence that may be wrong, overstated or unsafe, and a suggested fix. */
export interface ReviewNote { quote: string; problem: string; suggestion: string; severity: 'high' | 'medium' | 'low' }
export interface ReviewResult { notes: ReviewNote[]; simplified: string; title: string }
