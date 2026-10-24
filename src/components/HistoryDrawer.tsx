import React from 'react';
import { HistoryItem } from '../types/tts';
import { History, Play, Download, Trash2, Clock, Volume2 } from 'lucide-react';
import { downloadAudioFile } from '../utils/audio';

interface HistoryDrawerProps {
  items: HistoryItem[];
  activeItemId: string | null;
  onSelectItem: (item: HistoryItem) => void;
  onClearHistory: () => void;
  onDeleteItem: (id: string) => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  items,
  activeItemId,
  onSelectItem,
  onClearHistory,
  onDeleteItem,
}) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold text-white">سجل المقاطع الصوتية المنشأة</h2>
          <span className="text-xs text-slate-500 font-mono">({items.length})</span>
        </div>

        <button
          type="button"
          onClick={onClearHistory}
          className="text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>مسح السجل</span>
        </button>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pl-1">
        {items.map((item) => {
          const isActive = activeItemId === item.id;
          return (
            <div
              key={item.id}
              onClick={() => onSelectItem(item)}
              className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 text-right ${
                isActive
                  ? 'bg-amber-500/10 border-amber-500/60 ring-1 ring-amber-500/20'
                  : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
              }`}
            >
              {/* Play Icon / Indicator */}
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isActive
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                </button>

                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-200 truncate">
                    {item.title}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 truncate">
                    <span>{item.voiceName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.toneStyle}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.speed}x</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => downloadAudioFile(item.audioUrl, `sawtik_${item.id}.wav`)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  title="تحميل المقطع"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteItem(item.id)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                  title="حذف من السجل"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
