'use client';

import HUD from './HUD';
import Flash from './Flash';
import PlayfieldCanvas from './PlayfieldCanvas';

export default function GameScreen() {
  const onResetHole = () => {
    window.dispatchEvent(new CustomEvent('orbital-golf:reset-hole'));
  };

  return (
    <section className="absolute inset-0 z-10 animate-fadein">
      <PlayfieldCanvas />
      <HUD />
      <div
        className="absolute left-0 right-0 z-20 px-4 pb-3 flex justify-center pointer-events-none"
        style={{ bottom: 'env(safe-area-inset-bottom, 12px)' }}
      >
        <button
          onClick={onResetHole}
          className="pointer-events-auto px-4 py-2.5 text-[13px] rounded-xl"
          style={{
            background: 'rgba(15, 18, 40, 0.65)',
            color: '#c3cdfb',
            border: '1px solid rgba(170, 190, 255, 0.25)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          ↻ Reset Hole (+1)
        </button>
      </div>
      <Flash />
    </section>
  );
}
