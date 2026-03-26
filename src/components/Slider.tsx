import React from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  onCommit?: () => void;
  badgeText?: string;
  badgeColor?: string;
  labelColor?: string;
}

export default function Slider({ 
  label, 
  value, 
  min, 
  max, 
  step = 1, 
  onChange, 
  onCommit,
  badgeText, 
  badgeColor = 'bg-white/10 text-white/90', 
  labelColor = 'text-gray-300' 
}: SliderProps) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex justify-between items-end mb-1">
        <span className={`text-[11px] flex items-center gap-1 ${labelColor}`}>{label}</span>
        <span className={`font-mono px-1 py-0.5 rounded text-[9px] tracking-wider ${badgeColor}`}>
          {badgeText || value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit}
        className="w-full h-1 bg-white/15 rounded-full appearance-none cursor-pointer hover:bg-white/25 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md transition-all"
      />
    </div>
  );
}
