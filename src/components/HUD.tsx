'use client';

import { useGameStore } from '@/store/game';

export default function HUD() {
  const currentHoleIdx = useGameStore((s) => s.currentHoleIdx);
  const holes = useGameStore((s) => s.holes);
  const strokes = useGameStore((s) => s.strokes);
  const results = useGameStore((s) => s.results);

  const par = holes[currentHoleIdx]?.par ?? '–';
  const score = results.reduce((sum, r) => sum + r.points, 0);

  return (
    <header
      className="absolute left-0 right-0 z-20 flex justify-between gap-0.5 px-3 py-2.5 pointer-events-none"
      style={{ top: 'env(safe-area-inset-top, 8px)' }}
    >
      <div className="hud-card">
        <label className="block text-[9px] uppercase tracking-[1px] text-[#8a9bd0]">
          Hole
        </label>
        <span className="block text-[17px] font-bold">{currentHoleIdx + 1}/5</span>
      </div>
      <div className="hud-card">
        <label className="block text-[9px] uppercase tracking-[1px] text-[#8a9bd0]">
          Strokes
        </label>
        <span className="block text-[17px] font-bold">{strokes}</span>
      </div>
      <div className="hud-card">
        <label className="block text-[9px] uppercase tracking-[1px] text-[#8a9bd0]">
          Par
        </label>
        <span className="block text-[17px] font-bold">{par}</span>
      </div>
      <div className="hud-card">
        <label className="block text-[9px] uppercase tracking-[1px] text-[#8a9bd0]">
          Score
        </label>
        <span className="block text-[17px] font-bold">{score}</span>
      </div>
    </header>
  );
}
