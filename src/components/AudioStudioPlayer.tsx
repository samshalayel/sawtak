import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Download,
  Repeat,
  Share2,
  Check,
  Disc,
  Headphones
} from 'lucide-react';
import { formatTime, downloadAudioFile } from '../utils/audio';

interface AudioStudioPlayerProps {
  audioUrl: string | null;
  audioBase64?: string;
  voiceName: string;
  toneName: string;
  dialectName: string;
  textExcerpt: string;
  speed: number;
  onGenerateAgain?: () => void;
}

export const AudioStudioPlayer: React.FC<AudioStudioPlayerProps> = ({
  audioUrl,
  audioBase64,
  voiceName,
  toneName,
  dialectName,
  textExcerpt,
  speed,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [copiedLink, setCopiedLink] = useState(false);

  // Audio Context & Analyser
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Setup audio node connection when audioUrl changes
  useEffect(() => {
    if (!audioRef.current || !audioUrl) return;

    audioRef.current.playbackRate = playbackRate;
    audioRef.current.loop = isLooping;

    // Reset play state
    setIsPlaying(false);
    setCurrentTime(0);

    const audioEl = audioRef.current;

    const handleLoadedMetadata = () => {
      setDuration(audioEl.duration || 0);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audioEl.currentTime || 0);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    audioEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    audioEl.addEventListener('timeupdate', handleTimeUpdate);
    audioEl.addEventListener('ended', handleEnded);

    return () => {
      audioEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audioEl.removeEventListener('timeupdate', handleTimeUpdate);
      audioEl.removeEventListener('ended', handleEnded);
    };
  }, [audioUrl]);

  // Handle Play/Pause
  const togglePlay = async () => {
    if (!audioRef.current || !audioUrl) return;

    try {
      // Initialize AudioContext on first user gesture if needed
      if (!audioCtxRef.current && typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          audioCtxRef.current = new AudioCtx();
          analyserRef.current = audioCtxRef.current.createAnalyser();
          analyserRef.current.fftSize = 128;
          try {
            sourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current);
            sourceRef.current.connect(analyserRef.current);
            analyserRef.current.connect(audioCtxRef.current.destination);
          } catch (e) {
            // Already connected or cross-origin
          }
        }
      }

      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume();
      }

      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('Audio playback error:', err);
    }
  };

  // Canvas Waveform Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let phase = 0;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barCount = 48;
      const barWidth = width / barCount - 2;

      let freqData: Uint8Array | null = null;
      if (analyserRef.current && isPlaying) {
        const buffer = new ArrayBuffer(analyserRef.current.frequencyBinCount);
        freqData = new Uint8Array(buffer);
        analyserRef.current.getByteFrequencyData(freqData as any);
      }

      for (let i = 0; i < barCount; i++) {
        let barHeight = 4;
        if (isPlaying) {
          if (freqData && freqData.length > i) {
            barHeight = Math.max(6, (freqData[i] / 255) * (height - 8));
          } else {
            // Animated aesthetic wave fallback
            const sinVal = Math.sin(phase + (i * 0.25));
            barHeight = Math.max(6, (Math.abs(sinVal) * (height * 0.75)));
          }
        } else {
          // Subtle idle static wave
          barHeight = 4 + (Math.sin(i * 0.4) + 1) * 3;
        }

        const x = i * (barWidth + 2);
        const y = (height - barHeight) / 2;

        // Gradient color for bars
        const progress = currentTime / (duration || 1);
        const isPast = (i / barCount) <= progress;

        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        if (isPast) {
          gradient.addColorStop(0, '#f59e0b');
          gradient.addColorStop(1, '#d97706');
        } else {
          gradient.addColorStop(0, '#334155');
          gradient.addColorStop(1, '#1e293b');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      phase += 0.08;
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, currentTime, duration]);

  // Seek handler
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleSkip = (seconds: number) => {
    if (!audioRef.current) return;
    const target = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
    audioRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const handleSpeedCycle = () => {
    const rates = [0.8, 1.0, 1.25, 1.5];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const safeTitle = textExcerpt.slice(0, 20).replace(/[^\w\u0600-\u06FF]/g, '_') || 'audio';
    downloadAudioFile(audioUrl, `sawtik_${safeTitle}.wav`);
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  if (!audioUrl) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 border-dashed rounded-2xl p-8 sm:p-12 text-center text-slate-500">
        <Headphones className="w-10 h-10 mx-auto mb-3 text-slate-600 stroke-[1.5]" />
        <h3 className="text-sm font-semibold text-slate-400 mb-1">مشغل الاستوديو جاهز</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
          اكتب نصك واضغط على &quot;توليد الصوت الآن&quot; للاستماع بجودة الاستوديو وتحميل الملف الصوتي
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-2xl relative overflow-hidden">
      {/* Hidden native audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
      />

      {/* Decorative Glow */}
      <div className="absolute top-0 right-1/4 w-72 h-72 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Info */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800/80 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Disc className={`w-4 h-4 ${isPlaying ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">المقطع الصوتي المُنتَج</h3>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                24kHz Studio WAV
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
              <span>{voiceName}</span>
              <span aria-hidden="true">·</span>
              <span>{toneName}</span>
              <span aria-hidden="true">·</span>
              <span>{dialectName}</span>
            </div>
          </div>
        </div>

        {/* Action Controls: Download & Share */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-amber-500/10"
            title="تحميل ملف الصوت بجودة عالية WAV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تحميل WAV</span>
          </button>

          <button
            type="button"
            onClick={handleShare}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800/80 border border-slate-700/60 transition-colors"
            title="مشاركة أو نسخ رابط"
          >
            {copiedLink ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Real-time Waveform Canvas */}
      <div className="my-4 py-2 px-3 bg-slate-950/70 border border-slate-800/90 rounded-xl relative">
        <canvas
          ref={canvasRef}
          width={640}
          height={60}
          className="w-full h-14 block cursor-pointer"
          onClick={togglePlay}
          title="اضغط للتشغيل أو الإيقاف المؤقت"
        />
      </div>

      {/* Scrubber Range */}
      <div className="space-y-1">
        <input
          type="range"
          min="0"
          max={duration || 100}
          step="0.05"
          value={currentTime}
          onChange={handleSeek}
          className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
        />

        <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Main Playback Bar Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3 mt-4 pt-2">
        {/* Playback speed & Loop */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSpeedCycle}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 font-bold transition-colors"
            title="تغيير سرعة الاستماع"
          >
            {playbackRate.toFixed(2)}x
          </button>

          <button
            type="button"
            onClick={() => {
              setIsLooping(!isLooping);
              if (audioRef.current) audioRef.current.loop = !isLooping;
            }}
            className={`p-1.5 rounded transition-colors ${
              isLooping ? 'text-amber-400 bg-amber-500/10' : 'text-slate-500 hover:text-slate-300'
            }`}
            title="تكرار المقطع تلقائياً"
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>

        {/* Center: Rewind, Big Play/Pause, Forward */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleSkip(-5)}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="إرجاع 5 ثوانٍ"
            aria-label="إرجاع 5 ثوانٍ"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="w-12 h-12 rounded-full bg-gradient-to-tr from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 flex items-center justify-center shadow-lg shadow-amber-500/25 transition-transform hover:scale-105 active:scale-95 font-bold"
            title={isPlaying ? 'إيقاف مؤقت (المسافة)' : 'تشغيل (المسافة)'}
            aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSkip(5)}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="تقديم 5 ثوانٍ"
            aria-label="تقديم 5 ثوانٍ"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* Volume Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const newMute = !isMuted;
              setIsMuted(newMute);
              if (audioRef.current) audioRef.current.muted = newMute;
            }}
            className="text-slate-400 hover:text-slate-200"
            title={isMuted ? 'إلغاء كتم الصوت' : 'كتم الصوت'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>

          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVolume(val);
              setIsMuted(val === 0);
              if (audioRef.current) {
                audioRef.current.volume = val;
                audioRef.current.muted = val === 0;
              }
            }}
            className="w-16 sm:w-20 accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
          />
        </div>
      </div>
    </div>
  );
};
