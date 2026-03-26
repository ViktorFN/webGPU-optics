import React, { useEffect, useState } from 'react';
import splashVideo from '../assets/z.mp4';

interface SplashScreenProps {
  onStart: () => void;
}

export default function SplashScreen({ onStart }: SplashScreenProps) {
  const [visible, setVisible] = useState(true);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const handleStart = () => {
      setOpacity(0);
      setTimeout(() => {
        setVisible(false);
        onStart();
      }, 800);
    };

    window.addEventListener('keydown', handleStart);
    window.addEventListener('mousedown', handleStart);
    window.addEventListener('touchstart', handleStart);

    return () => {
      window.removeEventListener('keydown', handleStart);
      window.removeEventListener('mousedown', handleStart);
      window.removeEventListener('touchstart', handleStart);
    };
  }, [onStart]);

  if (!visible) return null;

  return (
    <div 
      className="fixed inset-0 z-[9999] bg-black transition-opacity duration-800 ease-[cubic-bezier(0.4,0,0.2,1)] cursor-pointer flex items-center justify-center overflow-hidden"
      style={{ opacity }}
    >
      {/* ФОНОВАЯ ЗАСТАВКА (Видео z.mp4) */}
      <video 
        autoPlay 
        muted 
        loop 
        playsInline 
        className="absolute inset-0 w-full h-full object-contain opacity-60"
      >
        <source src={splashVideo} type="video/mp4" />
      </video>

      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 text-white/60 text-[10px] tracking-[0.4em] uppercase font-medium text-center w-full drop-shadow-lg">
        кафедра физики и химии
      </div>

      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 text-white/70 text-xs tracking-widest uppercase font-normal drop-shadow-md animate-pulse pointer-events-none">
        Нажмите любую клавишу или кликните мышью
      </div>
      <div className="text-center z-10 translate-y-[70px]">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-fuchsia-400 bg-clip-text text-transparent mb-4">
          OpticsRay
        </h1>
        <p className="text-white/50 tracking-widest uppercase text-sm">Analytical Math & Fiber</p>
      </div>
    </div>
  );
}
