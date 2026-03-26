import React from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { AppState } from '../types';

interface ZoomControlsProps {
    state: AppState;
    updateState: (updater: (state: AppState) => void, render?: boolean, recordHistory?: boolean) => void;
}

export default function ZoomControls({ state, updateState }: ZoomControlsProps) {
    const handleZoomIn = () => {
        updateState(s => {
            const zoomFactor = 1.2;
            const newZoom = s.camera.zoom * zoomFactor;
            const w = window.innerWidth;
            const h = window.innerHeight;
            s.camera.x = w/2 - ((w/2 - s.camera.x) / s.camera.zoom) * newZoom;
            s.camera.y = h/2 - ((h/2 - s.camera.y) / s.camera.zoom) * newZoom;
            s.camera.zoom = newZoom;
        }, true, false);
    };

    const handleZoomOut = () => {
        updateState(s => {
            const zoomFactor = 1.2;
            const newZoom = s.camera.zoom / zoomFactor;
            const w = window.innerWidth;
            const h = window.innerHeight;
            s.camera.x = w/2 - ((w/2 - s.camera.x) / s.camera.zoom) * newZoom;
            s.camera.y = h/2 - ((h/2 - s.camera.y) / s.camera.zoom) * newZoom;
            s.camera.zoom = newZoom;
        }, true, false);
    };

    const handleReset = () => {
        updateState(s => {
            s.camera.x = 0;
            s.camera.y = 0;
            s.camera.zoom = 1;
        }, true, false);
    };

    return (
        <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-10">
            <div className="bg-[#1a1a1a]/90 backdrop-blur-md border border-white/10 rounded-lg p-1 flex flex-col gap-1 shadow-2xl">
                <button 
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                    onClick={handleZoomIn}
                    title="Zoom In (Ctrl+Wheel)"
                >
                    <ZoomIn size={16} />
                </button>
                <button 
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                    onClick={handleReset}
                    title="Reset View"
                >
                    <Maximize size={16} />
                </button>
                <button 
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                    onClick={handleZoomOut}
                    title="Zoom Out (Ctrl+Wheel)"
                >
                    <ZoomOut size={16} />
                </button>
            </div>
            <div className="text-[10px] text-white/40 text-center font-mono">
                {Math.round(state.camera.zoom * 100)}%
            </div>
        </div>
    );
}
