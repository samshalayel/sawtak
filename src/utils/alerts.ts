import Swal from 'sweetalert2';
import { formatCredits } from '../types/auth';

// RTL SweetAlert matching the studio theme (light or dark, read at open time)
const isLight = () => document.documentElement.classList.contains('light');

const studioSwal = () =>
  Swal.mixin({
    background: isLight() ? '#ffffff' : '#0f172a',
    color: isLight() ? '#1e293b' : '#e2e8f0',
    confirmButtonColor: '#f59e0b',
    cancelButtonColor: isLight() ? '#cbd5e1' : '#334155',
    customClass: { popup: 'swal-studio' },
  });

const chip = () =>
  isLight()
    ? 'background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:6px 10px'
    : 'background:#020617;border:1px solid #1e293b;border-radius:10px;padding:6px 10px';

export function showGenerationSuccess(opts: { durationSeconds: number; charged: number; balance: number }) {
  const chipStyle = chip();
  return studioSwal().fire({
    icon: 'success',
    title: 'تهانينا!',
    html: `
      <p style="margin-bottom:14px">لقد تم توليد الملف الصوتي بنجاح</p>
      <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;font-size:13px">
        <span style="${chipStyle}">مدة الصوت: <b>${opts.durationSeconds.toFixed(1)} ثانية</b></span>
        <span style="${chipStyle}">تم خصم: <b>${formatCredits(opts.charged)}</b></span>
        <span style="${chipStyle}">رصيدك المتبقي: <b style="color:${isLight() ? '#b45309' : '#fcd34d'}">${formatCredits(opts.balance)}</b></span>
      </div>
    `,
    confirmButtonText: 'استمع الآن',
  });
}

export function showStudioAlert(icon: 'success' | 'error' | 'info' | 'warning', title: string, text: string) {
  return studioSwal().fire({ icon, title, text, confirmButtonText: 'حسناً' });
}
