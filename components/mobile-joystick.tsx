import React, { useRef, useState, useEffect } from 'react';

type MobileMove = { x: number; y: number; magnitude: number };

export interface MobileJoystickProps {
  moveRef: React.MutableRefObject<MobileMove>;
  deadzone?: number;
}

export function MobileJoystick({ moveRef, deadzone = 0.1 }: MobileJoystickProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbPos, setThumbPos] = useState({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);
  
  const reset = () => {
    activePointerId.current = null;
    setThumbPos({ x: 0, y: 0 });
    moveRef.current = { x: 0, y: 0, magnitude: 0 };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // Only accept one pointer
    if (activePointerId.current !== null) return;
    
    // Prevent default interactions like scrolling or other UI clicks
    e.preventDefault();
    e.stopPropagation();
    
    // Capture this pointer
    if (containerRef.current) {
      containerRef.current.setPointerCapture(e.pointerId);
    }
    
    activePointerId.current = e.pointerId;
    updateThumb(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activePointerId.current !== e.pointerId) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    updateThumb(e.clientX, e.clientY);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (activePointerId.current !== e.pointerId) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    if (containerRef.current && containerRef.current.hasPointerCapture(e.pointerId)) {
      containerRef.current.releasePointerCapture(e.pointerId);
    }
    
    reset();
  };

  const updateThumb = (clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width / 2 - 14;
    
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    
    let distance = Math.hypot(dx, dy);
    
    // Clamp thumb visually
    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
      distance = maxRadius;
    }
    
    setThumbPos({ x: dx, y: dy });
    
    // Calculate normalized output
    let nx = dx / maxRadius;
    let ny = dy / maxRadius;
    let mag = distance / maxRadius;
    
    let adjMag = 0;
    if (mag >= deadzone) {
      adjMag = (mag - deadzone) / (1 - deadzone);
      adjMag = Math.min(1, Math.max(0, adjMag));
    }
    
    if (adjMag > 0) {
      const dirX = nx / mag;
      const dirY = ny / mag;
      moveRef.current = {
        x: dirX * adjMag,
        y: dirY * adjMag, // y is screen-down, which corresponds to backward in 3D
        magnitude: adjMag
      };
    } else {
      moveRef.current = { x: 0, y: 0, magnitude: 0 };
    }
  };

  // Ensure cleanup on unmount
  useEffect(() => {
    return () => {
      moveRef.current = { x: 0, y: 0, magnitude: 0 };
    };
  }, [moveRef]);

  return (
    <div 
      className="mobile-joystick-area"
      data-ui-control="true"
    >
      <div 
        className="mobile-joystick-base" 
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onLostPointerCapture={reset}
        style={{ touchAction: 'none' }}
      >
        <div 
          className="mobile-joystick-thumb" 
          style={{ 
            transform: `translate(calc(-50% + ${thumbPos.x}px), calc(-50% + ${thumbPos.y}px))` 
          }} 
        />
      </div>
    </div>
  );
}
