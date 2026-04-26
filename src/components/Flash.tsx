'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/store/game';

/**
 * Center-screen ephemeral message tied to the store's `flash` field.
 * Each flash has a `nonce` so repeated identical messages still re-trigger.
 */
export default function Flash() {
  const flash = useGameStore((s) => s.flash);
  const [visibleNonce, setVisibleNonce] = useState<number | null>(null);

  useEffect(() => {
    if (!flash) return;
    setVisibleNonce(flash.nonce);
    const t = window.setTimeout(() => setVisibleNonce((n) => (n === flash.nonce ? null : n)), flash.durMs);
    return () => window.clearTimeout(t);
  }, [flash]);

  const show = flash !== null && visibleNonce === flash.nonce;

  return (
    <div
      className="absolute z-30 pointer-events-none whitespace-nowrap text-center font-extrabold"
      style={{
        top: '35%',
        left: '50%',
        transform: show
          ? 'translate(-50%, -50%) scale(1)'
          : 'translate(-50%, -50%) scale(0.8)',
        opacity: show ? 1 : 0,
        fontSize: 34,
        letterSpacing: 2,
        color: '#fff',
        textShadow: '0 0 20px rgba(180, 200, 255, 0.8)',
        transition: 'opacity 0.25s, transform 0.3s cubic-bezier(0.2, 1.6, 0.4, 1)',
      }}
    >
      {flash?.text ?? ''}
    </div>
  );
}
