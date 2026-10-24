import { stripAudioTags } from './audioTags';
/**
 * Audio processing and helper utilities
 */

/**
 * Converts a base64 encoded string into a Blob URL
 */
export function base64ToBlobUrl(base64Data: string, mimeType = 'audio/wav'): string {
  try {
    const cleanBase64 = base64Data.replace(/^data:audio\/\w+;base64,/, '');
    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error('Failed to convert base64 to Blob URL:', err);
    return `data:${mimeType};base64,${base64Data}`;
  }
}

/**
 * Downloads audio file to user device
 */
export function downloadAudioFile(urlOrBase64: string, filename = 'studio-speech.wav'): void {
  const link = document.createElement('a');
  if (urlOrBase64.startsWith('blob:') || urlOrBase64.startsWith('http')) {
    link.href = urlOrBase64;
  } else {
    link.href = base64ToBlobUrl(urlOrBase64, 'audio/wav');
  }
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Estimates reading duration in seconds
 */
export function estimateDuration(text: string, speedMultiplier = 1.0): { seconds: number; formatted: string } {
  const words = stripAudioTags(text).trim().split(/\s+/).filter(Boolean).length;
  const baseWordsPerMinute = 80 * Math.max(0.5, speedMultiplier); // keep in sync with server/credits.ts
  const minutes = words / baseWordsPerMinute;
  const totalSeconds = Math.max(2, Math.ceil(minutes * 60));

  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  return { seconds: totalSeconds, formatted };
}

/**
 * Format seconds to MM:SS
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
