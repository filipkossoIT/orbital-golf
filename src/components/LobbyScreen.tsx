'use client';

import { useGameStore } from '@/store/game';
import { formatAddr } from '@/lib/wallet';

const TIERS = [
  { name: 'Bronze', score: '≥ 5', mult: '0.8×', cls: 'bronze' },
  { name: 'Silver', score: '≥ 10', mult: '1.5×', cls: 'silver' },
  { name: 'Gold', score: '≥ 15', mult: '3×', cls: 'gold' },
  { name: 'Platinum', score: '≥ 20', mult: '10×', cls: 'platinum' },
] as const;

export default function LobbyScreen() {
  const pubkey = useGameStore((s) => s.pubkey);
  const balance = useGameStore((s) => s.balance);
  const totalBurned = useGameStore((s) => s.totalBurned);
  const payAndStartRound = useGameStore((s) => s.payAndStartRound);

  return (
    <section className="absolute inset-0 z-10 flex flex-col items-center justify-center p-5 animate-fadein">
      <header className="absolute top-4 left-4 right-4 flex justify-between items-center gap-2.5 z-20">
        <div className="chip">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: '#53f2a4', boxShadow: '0 0 8px #53f2a4' }}
          />
          <span>{pubkey ? formatAddr(pubkey) : '—'}</span>
        </div>
        <div className="chip">
          <span style={{ color: '#ffe07a', fontWeight: 600 }}>
            {balance.toLocaleString()}
          </span>
          <span style={{ color: '#ffb955', fontSize: 11 }}>$STARS</span>
        </div>
      </header>

      <div className="panel">
        <h2 className="text-[22px] font-bold mb-3">Ready to launch?</h2>
        <p className="text-[14px]">
          Entry fee&nbsp;<b>50 $STARS</b>
        </p>
        <ul className="flex justify-center gap-5 my-2.5 text-[13px] opacity-85 list-none">
          <li>
            <span className="text-[#ff7a4a] font-bold">🔥 25</span> burned
          </li>
          <li>
            <span className="text-[#6ce0ff] font-bold">◉ 25</span> to prize pool
          </li>
        </ul>

        <div
          className="mt-2 mb-4 rounded-xl overflow-hidden text-[13px]"
          style={{ border: '1px solid rgba(120, 150, 255, 0.15)' }}
        >
          <div
            className="grid grid-cols-3 px-3 py-2 text-[11px] tracking-[1.2px] uppercase text-[#8494c9]"
            style={{ background: 'rgba(120, 150, 255, 0.06)' }}
          >
            <span>Tier</span>
            <span>Score</span>
            <span>Payout</span>
          </div>
          {TIERS.map((t) => (
            <div
              key={t.name}
              className="grid grid-cols-3 px-3 py-2 items-center"
              style={{ borderTop: '1px solid rgba(120, 150, 255, 0.08)' }}
            >
              <span className={`tier-pill ${t.cls}`}>{t.name}</span>
              <span>{t.score}</span>
              <span>{t.mult}</span>
            </div>
          ))}
        </div>

        <button className="btn-primary" onClick={() => payAndStartRound()}>
          Pay 50 · Play Round
        </button>

        <div className="mt-3.5 text-[12px] opacity-65 tracking-[0.4px]">
          🔥{' '}
          <span className="text-[#ff9d70] font-bold">
            {totalBurned.toLocaleString()}
          </span>{' '}
          $STARS burned this session
        </div>
      </div>
    </section>
  );
}
