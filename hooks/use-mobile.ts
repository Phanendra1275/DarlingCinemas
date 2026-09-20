import { useState, useEffect } from 'react';

export function useMobile() {
  const [isTouch, setIsTouch] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const update = () => {
      const hasTouch = navigator.maxTouchPoints > 0;
      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      setIsTouch(hasTouch || coarsePointer);

      const landscape = window.innerWidth > window.innerHeight;
      setIsLandscape(landscape);
    };

    update();
    
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return { isTouch, isLandscape };
}

// Compatibility for the bundled sidebar primitive.
export function useIsMobile() { return useMobile().isTouch; }
