import React from 'react';
import { AppState, OpticElement } from '../types';
import Slider from './Slider';
import { Trash2, Copy, Eye, EyeOff } from 'lucide-react';

interface RightPanelProps {
  state: AppState;
  updateState: (updater: (s: AppState) => void, render?: boolean, recordHistory?: boolean) => void;
  onDelete: () => void;
}

export default function RightPanel({ state, updateState, onDelete }: RightPanelProps) {
  const selectedEl = typeof state.selectedElement === 'number' ? state.elements[state.selectedElement] : null;

  const updateSelected = (updates: Partial<OpticElement>) => {
    if (!selectedEl || typeof state.selectedElement !== 'number') return;
    updateState(s => {
      if (typeof s.selectedElement === 'number') {
        Object.assign(s.elements[s.selectedElement], updates);
      }
    }, true, false);
  };

  const commitHistory = () => {
    updateState(s => {}, false, true);
  };

  const duplicateSelected = () => {
    if (!selectedEl) return;
    updateState(s => {
      const newEl = JSON.parse(JSON.stringify(selectedEl));
      newEl.id = Math.random().toString(36).substr(2, 9);
      newEl.x += 20;
      newEl.y += 20;
      s.elements.push(newEl);
      s.selectedElement = s.elements.length - 1;
    });
  };

  if (!selectedEl) return null;

  return (
    <div className="fixed top-4 right-4 w-[280px] max-h-[calc(100vh-32px)] overflow-y-auto bg-[#0f0f14a6] backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-3 z-10 flex flex-col gap-3 text-white/90 scrollbar-thin scrollbar-thumb-white/15">
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <h2 className="text-base font-bold bg-gradient-to-r from-blue-400 to-fuchsia-400 bg-clip-text text-transparent capitalize">
          {selectedEl.type}
        </h2>
        <div className="flex gap-1">
          <button onClick={duplicateSelected} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
            <Copy size={14} />
          </button>
          <button onClick={onDelete} className="text-red-400 hover:text-red-300 transition-colors p-1 rounded-lg hover:bg-red-500/20">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Slider label="X" value={selectedEl.x} min={-1000} max={1000} onChange={(v) => updateSelected({ x: v })} onCommit={commitHistory} />
          <Slider label="Y" value={selectedEl.y} min={-1000} max={1000} onChange={(v) => updateSelected({ y: v })} onCommit={commitHistory} />
        </div>
        <Slider label="Вращение" value={selectedEl.rotation} min={0} max={360} onChange={(v) => updateSelected({ rotation: v })} onCommit={commitHistory} badgeText={`${selectedEl.rotation}°`} />

        <div className="border-t border-white/5 pt-2 mt-1">
          <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Оптика</h3>
          {selectedEl.type !== 'mirror' && (
            <Slider label="Показатель (n)" value={selectedEl.n * 100} min={100} max={300} onChange={(v) => updateSelected({ n: v / 100 })} onCommit={commitHistory} badgeText={(selectedEl.n).toFixed(2)} badgeColor="bg-cyan-400/20 text-cyan-200" labelColor="text-cyan-300/80 font-medium" />
          )}
          <Slider label="Поглощение" value={selectedEl.absorption * 1000} min={0} max={100} onChange={(v) => updateSelected({ absorption: v / 1000 })} onCommit={commitHistory} badgeText={(selectedEl.absorption).toFixed(3)} badgeColor="bg-red-400/20 text-red-200" labelColor="text-red-300/80 font-medium" />
          <Slider label="Рассеяние" value={selectedEl.scattering * 1000} min={0} max={100} onChange={(v) => updateSelected({ scattering: v / 1000 })} onCommit={commitHistory} badgeText={(selectedEl.scattering).toFixed(3)} badgeColor="bg-orange-400/20 text-orange-200" labelColor="text-orange-300/80 font-medium" />
        </div>

        <div className="border-t border-white/5 pt-2 mt-1">
          <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Геометрия</h3>
          {selectedEl.type === 'prism' && (
            <Slider label="Размер" value={selectedEl.size!} min={20} max={400} onChange={(v) => updateSelected({ size: v })} onCommit={commitHistory} />
          )}
          {selectedEl.type === 'raindrop' && (
            <Slider label="Радиус" value={selectedEl.radius!} min={10} max={300} onChange={(v) => updateSelected({ radius: v })} onCommit={commitHistory} />
          )}
          {selectedEl.type === 'mirror' && (
            <Slider label="Длина" value={selectedEl.length!} min={20} max={600} onChange={(v) => updateSelected({ length: v })} onCommit={commitHistory} />
          )}
          {selectedEl.type === 'lens' && (
            <>
              <Slider label="Кривизна" value={selectedEl.curvatureRadius!} min={50} max={1000} onChange={(v) => updateSelected({ curvatureRadius: v })} onCommit={commitHistory} />
              <Slider label="Высота" value={selectedEl.height!} min={20} max={600} onChange={(v) => updateSelected({ height: v })} onCommit={commitHistory} />
              <Slider label="Толщина" value={selectedEl.thickness!} min={10} max={200} onChange={(v) => updateSelected({ thickness: v })} onCommit={commitHistory} />
            </>
          )}
          {selectedEl.type === 'fiber' && (
            <Slider label="Толщина" value={selectedEl.thickness!} min={5} max={100} onChange={(v) => updateSelected({ thickness: v })} onCommit={commitHistory} />
          )}
        </div>
      </div>
    </div>
  );
}
