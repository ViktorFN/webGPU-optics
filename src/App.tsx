import React, { useEffect, useRef, useState, useCallback } from 'react';
import { OpticsEngine } from './lib/engine';
import { AppState } from './types';
import { initAudio, playSound } from './lib/audio';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import SplashScreen from './components/SplashScreen';
import ZoomControls from './components/ZoomControls';

const initialGlobals = {
    colorType: 0,
    wavelength: 550,
    angle: 0,
    beamWidth: 50,
    dispersion: 0.03,
    envN: 1.0,
    intensity: 1.0,
    quality: 'medium' as const,
    gridSize: 20,
    snapping: false
};

export default function App() {
    const [started, setStarted] = useState(false);
    const glCanvasRef = useRef<HTMLCanvasElement>(null);
    const uiCanvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<OpticsEngine | null>(null);
    
    const stateRef = useRef<AppState>({
        elements: [],
        lightSource: { x: 0, y: 0, dragging: false, initialized: false },
        globals: { ...initialGlobals },
        selectedElement: null,
        camera: { x: 0, y: 0, zoom: 1 }
    });

    const [, setTick] = useState(0);
    const forceUpdate = useCallback(() => setTick(t => t + 1), []);

    const [historyState, setHistoryState] = useState({ history: [] as string[], index: -1 });

    const saveHistory = useCallback(() => {
        const stateStr = JSON.stringify(stateRef.current);
        setHistoryState(prev => {
            const newHistory = prev.history.slice(0, prev.index + 1);
            if (newHistory.length > 0 && newHistory[newHistory.length - 1] === stateStr) {
                return prev;
            }
            newHistory.push(stateStr);
            if (newHistory.length > 50) newHistory.shift();
            return { history: newHistory, index: newHistory.length - 1 };
        });
    }, []);

    const undo = useCallback(() => {
        setHistoryState(prev => {
            if (prev.index > 0) {
                const prevState = JSON.parse(prev.history[prev.index - 1]);
                stateRef.current = prevState;
                forceUpdate();
                engineRef.current?.requestRender();
                return { ...prev, index: prev.index - 1 };
            }
            return prev;
        });
    }, [forceUpdate]);

    const redo = useCallback(() => {
        setHistoryState(prev => {
            if (prev.index < prev.history.length - 1) {
                const nextState = JSON.parse(prev.history[prev.index + 1]);
                stateRef.current = nextState;
                forceUpdate();
                engineRef.current?.requestRender();
                return { ...prev, index: prev.index + 1 };
            }
            return prev;
        });
    }, [forceUpdate]);

    const updateState = useCallback((updater: (state: AppState) => void, render = true, recordHistory = true) => {
        if (recordHistory) saveHistory();
        updater(stateRef.current);
        if (recordHistory) saveHistory();
        forceUpdate();
        if (render) engineRef.current?.requestRender();
    }, [forceUpdate, saveHistory]);

    const resetScene = useCallback(() => {
        if (started) playSound('click');
        stateRef.current.elements = [];
        stateRef.current.globals = { ...initialGlobals };
        stateRef.current.selectedElement = null;
        stateRef.current.camera = { x: 0, y: 0, zoom: 1 };
        
        const w = window.innerWidth;
        const h = window.innerHeight;
        stateRef.current.elements.push({
            id: Math.random().toString(36).substr(2, 9),
            type: 'lens',
            lensType: 'convex',
            x: w * 0.5 + 50,
            y: h * 0.5,
            curvatureRadius: 300,
            height: 250,
            thickness: 50,
            rotation: 0,
            n: 1.52,
            absorption: 0,
            scattering: 0
        });
        
        stateRef.current.lightSource.x = w > 800 ? 300 : w * 0.2;
        stateRef.current.lightSource.y = h * 0.5;
        
        forceUpdate();
        engineRef.current?.requestRender();
    }, [started, forceUpdate]);

    const handleStart = useCallback(() => {
        if (started) return;
        initAudio();
        playSound('boot');
        setStarted(true);
        resetScene();
    }, [started, resetScene]);

    useEffect(() => {
        if (!glCanvasRef.current || !uiCanvasRef.current) return;
        
        const engine = new OpticsEngine(
            glCanvasRef.current,
            uiCanvasRef.current,
            () => stateRef.current,
            (recordHistory: boolean = true) => {
                if (recordHistory) saveHistory();
                forceUpdate();
            }
        );
        engineRef.current = engine;

        const handleResize = () => {
            const dpr = window.devicePixelRatio || 1;
            engine.resize(window.innerWidth, window.innerHeight, dpr);
        };

        engine.init().then(() => {
            window.addEventListener('resize', handleResize);
            handleResize();

            // Initial history save
            saveHistory();
        }).catch(err => {
            console.error("Failed to initialize WebGPU:", err);
        });

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [forceUpdate, saveHistory]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!started) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
            
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                redo();
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (stateRef.current.selectedElement !== null) {
                    playSound('delete');
                    updateState(s => {
                        if (s.selectedElement !== null) {
                            s.elements.splice(s.selectedElement, 1);
                            s.selectedElement = null;
                        }
                    });
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [started, forceUpdate, undo, redo, saveHistory]);

    const handleLoadPreset = (key: string) => {
        const data = localStorage.getItem(key);
        if (data) {
            try {
                const parsed = JSON.parse(data);
                stateRef.current = parsed;
                playSound('boot');
                forceUpdate();
                engineRef.current?.requestRender();
            } catch (e) {
                console.error("Failed to parse preset", e);
            }
        }
    };

    const handleSavePreset = (name: string) => {
        localStorage.setItem('optics_preset_' + name, JSON.stringify(stateRef.current));
        playSound('click');
        forceUpdate();
    };

    const handleDeletePreset = (key: string) => {
        localStorage.removeItem(key);
        playSound('delete');
        forceUpdate();
    };

    const handleDeleteSelected = () => {
        if (stateRef.current.selectedElement !== null) {
            playSound('delete');
            updateState(s => {
                if (s.selectedElement !== null) {
                    s.elements.splice(s.selectedElement, 1);
                    s.selectedElement = null;
                }
            });
        }
    };

    return (
        <div className="relative w-screen h-screen bg-[#030305] overflow-hidden select-none touch-none font-sans text-white">
            <SplashScreen onStart={handleStart} />
            
            <div className="absolute inset-0">
                <canvas 
                    ref={glCanvasRef} 
                    className="absolute inset-0 w-full h-full z-[1]" 
                    style={{ filter: 'blur(1.5px) contrast(1.2) brightness(1.2)', mixBlendMode: 'screen' }}
                />
                <canvas 
                    ref={uiCanvasRef} 
                    className="absolute inset-0 w-full h-full z-[2] cursor-default" 
                />
            </div>

            {started && (
                <>
                    <LeftPanel 
                        state={stateRef.current} 
                        updateState={updateState} 
                        onReset={resetScene}
                        onLoadPreset={handleLoadPreset}
                        onSavePreset={handleSavePreset}
                        onDeletePreset={handleDeletePreset}
                        undo={undo}
                        redo={redo}
                        canUndo={historyState.index > 0}
                        canRedo={historyState.index < historyState.history.length - 1}
                    />
                    <RightPanel 
                        state={stateRef.current} 
                        updateState={updateState} 
                        onDelete={handleDeleteSelected}
                    />
                    <ZoomControls 
                        state={stateRef.current} 
                        updateState={updateState} 
                    />
                </>
            )}
        </div>
    );
}
