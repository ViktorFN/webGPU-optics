let audioCtx: AudioContext | null = null;
let lastSlideTime = 0;

export function initAudio() { 
    if (!audioCtx) { 
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)(); 
    } 
    if (audioCtx.state === 'suspended') audioCtx.resume(); 
}

export function playSound(type: 'boot' | 'click' | 'slide' | 'delete') {
    if (!audioCtx) return; 
    const now = audioCtx.currentTime;
    if (type === 'slide') { 
        if (now - lastSlideTime < 0.05) return; 
        lastSlideTime = now; 
    }
    const osc = audioCtx.createOscillator(); 
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode); 
    gainNode.connect(audioCtx.destination);
    
    if (type === 'boot') { 
        osc.type = 'sine'; 
        osc.frequency.setValueAtTime(220, now); 
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.8); 
        gainNode.gain.setValueAtTime(0, now); 
        gainNode.gain.linearRampToValueAtTime(0.3, now + 0.1); 
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.5); 
        osc.start(now); 
        osc.stop(now + 1.5); 
    } else if (type === 'click') { 
        osc.type = 'triangle'; 
        osc.frequency.setValueAtTime(800 + Math.random()*200, now); 
        osc.frequency.exponentialRampToValueAtTime(1600, now + 0.05); 
        gainNode.gain.setValueAtTime(0.15, now); 
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1); 
        osc.start(now); 
        osc.stop(now + 0.1); 
    } else if (type === 'slide') { 
        osc.type = 'square'; 
        osc.frequency.setValueAtTime(400 + Math.random()*100, now); 
        gainNode.gain.setValueAtTime(0.015, now); 
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.03); 
        osc.start(now); 
        osc.stop(now + 0.03); 
    } else if (type === 'delete') { 
        osc.type = 'sawtooth'; 
        osc.frequency.setValueAtTime(300, now); 
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.2); 
        gainNode.gain.setValueAtTime(0.15, now); 
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2); 
        osc.start(now); 
        osc.stop(now + 0.2); 
    }
}
