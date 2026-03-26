import React, { useState, useEffect } from 'react';
import { AppState, Globals, OpticElement } from '../types';
import Slider from './Slider';
import { Triangle, Droplet, SquareSplitHorizontal, Hexagon, ZoomIn, ZoomOut, CloudFog, Activity, Save, Trash2, Upload, Download, Undo2, Redo2, Grid } from 'lucide-react';

interface LeftPanelProps {
  state: AppState;
  updateState: (updater: (s: AppState) => void, render?: boolean, recordHistory?: boolean) => void;
  onReset: () => void;
  onLoadPreset: (key: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (key: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export default function LeftPanel({ state, updateState, onReset, onLoadPreset, onSavePreset, onDeletePreset, undo, redo, canUndo, canRedo }: LeftPanelProps) {
  const [presets, setPresets] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  useEffect(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('optics_preset_')) {
        keys.push(key);
      }
    }
    setPresets(keys);
  }, [state]);

  const addElement = (type: OpticElement['type'], extraProps: Partial<OpticElement> = {}) => {
    updateState(s => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      s.elements.push({
        id: Math.random().toString(36).substr(2, 9),
        type,
        x: w / 2 + 50,
        y: h / 2,
        rotation: 0,
        n: 1.52,
        absorption: 0,
        scattering: 0,
        ...extraProps
      });
      s.selectedElement = s.elements.length - 1;
    });
  };

  const handleColorChange = (colorType: number) => {
    updateState(s => { s.globals.colorType = colorType; });
  };

  const handleGlobalChange = (key: keyof Globals, value: number) => {
    updateState(s => { (s.globals as any)[key] = value; });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'optics_scene.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        updateState(s => {
          Object.assign(s, data);
        });
      } catch (err) {
        alert("Ошибка формата!");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="fixed top-4 left-4 w-[280px] max-h-[calc(100vh-32px)] overflow-y-auto bg-[#0f0f14a6] backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-3 z-10 flex flex-col gap-2 text-white/90 scrollbar-thin scrollbar-thumb-white/15">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-fuchsia-400 bg-clip-text text-transparent flex items-center">
          Optics<span className="font-light text-white">Ray</span>
          <span className="text-[9px] ml-1 text-emerald-400 font-mono tracking-widest">FAST PBR</span>
        </h2>
        <div className="flex gap-0.5">
          <button onClick={undo} disabled={!canUndo} className={`p-1 rounded-lg transition-colors ${canUndo ? 'hover:bg-white/10 text-white' : 'text-white/20 cursor-not-allowed'}`}>
            <Undo2 size={14} />
          </button>
          <button onClick={redo} disabled={!canRedo} className={`p-1 rounded-lg transition-colors ${canRedo ? 'hover:bg-white/10 text-white' : 'text-white/20 cursor-not-allowed'}`}>
            <Redo2 size={14} />
          </button>
          <button onClick={onReset} className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider hover:text-white transition-colors px-2 py-1 rounded-full hover:bg-white/10 ml-0.5">
            Сброс
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Аналитическая Сцена</h3>
        <div className="grid grid-cols-2 gap-1">
          <button onClick={() => addElement('prism', { size: 140 })} className="flex items-center gap-1 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 p-1.5 rounded-lg text-[10px] font-medium transition-all hover:-translate-y-px">
            <Triangle size={10} /> Призма
          </button>
          <button onClick={() => addElement('raindrop', { radius: 100, n: 1.33 })} className="flex items-center gap-1 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 p-1.5 rounded-lg text-[10px] font-medium transition-all hover:-translate-y-px">
            <Droplet size={10} /> Капля
          </button>
          <button onClick={() => addElement('mirror', { length: 150, rotation: 45, n: 1 })} className="flex items-center gap-1 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 p-1.5 rounded-lg text-[10px] font-medium transition-all hover:-translate-y-px">
            <SquareSplitHorizontal size={10} /> Зеркало
          </button>
          <button onClick={() => addElement('polygon', { vertices: [{x:-60,y:-60},{x:60,y:-60},{x:60,y:60},{x:-60,y:60}] })} className="flex items-center gap-1 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 p-1.5 rounded-lg text-[10px] font-medium transition-all hover:-translate-y-px">
            <Hexagon size={10} /> Полигон
          </button>
          <button onClick={() => addElement('lens', { lensType: 'convex', curvatureRadius: 200, height: 180, thickness: 50 })} className="flex items-center gap-1 bg-white/5 border border-cyan-500/50 hover:bg-white/10 hover:border-cyan-400 p-1.5 rounded-lg text-[10px] font-medium transition-all hover:-translate-y-px">
            <ZoomIn size={10} className="text-cyan-400" /> Выпуклая
          </button>
          <button onClick={() => addElement('lens', { lensType: 'concave', curvatureRadius: 200, height: 180, thickness: 50 })} className="flex items-center gap-1 bg-white/5 border border-cyan-500/50 hover:bg-white/10 hover:border-cyan-400 p-1.5 rounded-lg text-[10px] font-medium transition-all hover:-translate-y-px">
            <ZoomOut size={10} className="text-cyan-400" /> Вогнутая
          </button>
          <button onClick={() => addElement('polygon', { n: 1.33, scattering: 0.015, vertices: [{x:-150,y:-60},{x:150,y:-60},{x:150,y:60},{x:-150,y:60}] })} className="flex items-center gap-1 bg-white/5 border border-orange-500/50 hover:bg-white/10 hover:border-orange-400 p-1.5 rounded-lg text-[10px] font-medium transition-all hover:-translate-y-px">
            <CloudFog size={10} className="text-orange-400" /> Мутная
          </button>
          <button onClick={() => addElement('fiber', { thickness: 40, pts: [{x:-150,y:0},{x:-50,y:-100},{x:50,y:100},{x:150,y:0}] })} className="flex items-center gap-1 bg-white/5 border border-emerald-500/50 hover:bg-white/10 hover:border-emerald-400 p-1.5 rounded-lg text-[10px] font-medium transition-all hover:-translate-y-px">
            <Activity size={10} className="text-emerald-400" /> Световод
          </button>
        </div>
      </div>

      <div className="border-t border-white/5 pt-2">
        <h3 className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Свет</h3>
        <div className="flex bg-black/40 p-0.5 rounded-lg border border-white/5 mb-2">
          {[
            { id: 0, label: 'White', color: 'text-white' },
            { id: 1, label: 'Red', color: 'text-red-400' },
            { id: 2, label: 'Green', color: 'text-green-400' },
            { id: 3, label: 'Blue', color: 'text-blue-400' },
            { id: 4, label: 'Custom', color: 'text-purple-400' }
          ].map(c => (
            <button
              key={c.id}
              onClick={() => handleColorChange(c.id)}
              className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-all ${state.globals.colorType === c.id ? 'bg-white/20 shadow-sm text-white' : `hover:bg-white/5 ${c.color}`}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {state.globals.colorType === 4 && (
          <Slider label="Длина волны" value={state.globals.wavelength} min={380} max={750} onChange={(v) => handleGlobalChange('wavelength', v)} badgeText={`${state.globals.wavelength}nm`} badgeColor="bg-purple-400/20 text-purple-200" labelColor="text-purple-300/80 font-medium" />
        )}
        <Slider label="Угол луча" value={state.globals.angle} min={-45} max={45} onChange={(v) => handleGlobalChange('angle', v)} badgeText={`${state.globals.angle}°`} />
        <Slider label="Толщина пучка" value={state.globals.beamWidth} min={1} max={400} onChange={(v) => handleGlobalChange('beamWidth', v)} />
        <Slider label="☀️ Яркость" value={state.globals.intensity * 100} min={10} max={500} onChange={(v) => handleGlobalChange('intensity', v / 100)} badgeText={`x${state.globals.intensity.toFixed(1)}`} badgeColor="bg-yellow-400/20 text-yellow-200" labelColor="text-yellow-300/80 font-medium" />
      </div>

      <div className="border-t border-white/5 pt-2">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest">Глобальная Среда</h3>
          <button 
            onClick={() => handleGlobalChange('snapping', state.globals.snapping ? 0 : 1)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors ${state.globals.snapping ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`}
          >
            <Grid size={10} /> Сетка
          </button>
        </div>
        <Slider label="Дисперсия (C)" value={state.globals.dispersion * 1000} min={0} max={100} onChange={(v) => handleGlobalChange('dispersion', v / 1000)} badgeText={(state.globals.dispersion).toFixed(3)} badgeColor="bg-fuchsia-400/20 text-fuchsia-200" labelColor="text-fuchsia-300/80 font-medium" />
        <Slider label="Среда (n)" value={state.globals.envN * 100} min={100} max={250} onChange={(v) => handleGlobalChange('envN', v / 100)} badgeText={(state.globals.envN).toFixed(2)} badgeColor="bg-cyan-400/20 text-cyan-200" labelColor="text-cyan-300/80 font-medium" />
      </div>

      <div className="border-t border-white/5 pt-2">
        <h3 className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Сохранение / Сцены</h3>
        <div className="flex gap-1 mb-1.5">
          <select 
            value={selectedPreset} 
            onChange={e => setSelectedPreset(e.target.value)}
            className="flex-1 bg-black/40 border border-white/10 text-white/90 rounded-lg px-2 py-1 text-[10px] outline-none cursor-pointer"
          >
            <option value="">-- Выберите сцену --</option>
            {presets.map(p => (
              <option key={p} value={p} className="bg-[#111] text-white">{p.replace('optics_preset_', '')}</option>
            ))}
          </select>
          <button onClick={() => { if(selectedPreset) onLoadPreset(selectedPreset); }} className="bg-white/5 border border-white/5 hover:bg-white/10 px-2 py-1 rounded-lg text-[10px] font-medium transition-all">
            Загр
          </button>
        </div>
        <div className="flex gap-1">
          <button onClick={() => { const name = prompt("Название сцены:"); if(name) { onSavePreset(name); setSelectedPreset('optics_preset_'+name); } }} className="flex-2 flex items-center justify-center gap-1 bg-white/5 border border-white/5 hover:bg-white/10 py-1 rounded-lg text-[10px] font-medium transition-all w-full">
            <Save size={10} /> Сохр
          </button>
          <button onClick={() => { if(selectedPreset && confirm("Удалить?")) { onDeletePreset(selectedPreset); setSelectedPreset(''); } }} className="flex-1 flex items-center justify-center bg-red-500/10 text-red-400 hover:bg-red-500/20 py-1 rounded-lg transition-all">
            <Trash2 size={10} />
          </button>
          <button onClick={handleExport} className="flex-1 flex items-center justify-center bg-white/5 border border-white/5 hover:bg-white/10 py-1 rounded-lg transition-all">
            <Upload size={10} />
          </button>
          <button onClick={() => document.getElementById('importFile')?.click()} className="flex-1 flex items-center justify-center bg-white/5 border border-white/5 hover:bg-white/10 py-1 rounded-lg transition-all">
            <Download size={10} />
          </button>
          <input type="file" id="importFile" className="hidden" accept=".json" onChange={handleImport} />
        </div>
      </div>
    </div>
  );
}
