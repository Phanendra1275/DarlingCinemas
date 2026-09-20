import { useState, useEffect, useCallback, useRef } from 'react';

export function useAutoHide(isPlaying: boolean, isSeated: boolean) {
  const [showHUD, setShowHUD] = useState(true);
  const [interactionDepth, setInteractionDepth] = useState(0);
  const timeoutRef = useRef<number | null>(null);

  const beginInteraction = useCallback(() => {
    setInteractionDepth(d => d + 1);
  }, []);

  const endInteraction = useCallback(() => {
    setInteractionDepth(d => Math.max(0, d - 1));
  }, []);

  const resetTimer = useCallback(() => {
    setShowHUD(true);
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    
    // Only auto-hide if seated, playing, and not currently interacting
    if (isSeated && isPlaying && interactionDepth === 0) {
      timeoutRef.current = window.setTimeout(() => {
        setShowHUD(false);
      }, 3000);
    }
  }, [isPlaying, isSeated, interactionDepth]);

  useEffect(() => {
    resetTimer();
    
    const events = ['pointerdown', 'pointermove', 'keydown'];
    const handleEvent = () => resetTimer();
    
    events.forEach(e => window.addEventListener(e, handleEvent));
    
    return () => {
      events.forEach(e => window.removeEventListener(e, handleEvent));
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [resetTimer]);

  return { showHUD, beginInteraction, endInteraction };
}
