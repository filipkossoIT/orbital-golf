'use client';

import { useGameStore } from '@/store/game';

export default function EndScreen() {
  const finalScore = useGameStore((s) => s.finalScore);
  const finalTierCls = useGameStore((s) => s.finalTierCls);
  const finalTierName = useGameStore((s) => s.finalTierName);
  const results = useGameStore((s) => s.results);
  const pendingReward = useGameStore((s) => s.pendingReward);
  const claimReward = useGameStore((s) => s.claimReward);
  const goToLobby = useGameStore((s) => s.goToLobby);

  return (
    <section className="absolute inset-0 z-10 flex flex-col items-center justify-center p-5 animate-fadein">
      <div className="panel">
        <h2 className="text-[22px] font-bold mb-3">Round Complete</h2>

        <div className="flex items-baseline justify-center my-3.5">
          <span className="gradient-score text-[72px] font-extrabold leading-none">
            {finalScore}
          </span>
          <span className="text-[22px] opacity-50 ml-1.5">/ 30</span>
        </div>

        <div className={`tier-badge ${finalTierCls ?? ''}`}>
          {finalTierName ?? 'No Tier'}
        </div>

        <ul
          className="list-none my-3.5 py-2.5 text-[13px]"
          style={{
            borderTop: '1px solid rgba(120, 150, 255, 0.12)',
            borderBottom: '1px solid rgba(120, 150, 255, 0.12)',
          }}
        >
          {results.map((r, i) => {
            const stats = r.completed
              ? `${r.strokes}/${r.par}${r.strokes === 1 ? ' · hole-in-one' : ''}${r.slingshot ? ' · slingshot' : ''}`
              : 'failed · max strokes';
            return (
              <li
                key={i}
                className="grid items-center gap-2.5 py-1.5"
                style={{ gridTemplateColumns: 'auto 1fr auto' }}
              >
                <span className="text-[#8494c9] text-[11px] tracking-[1px] uppercase">
                  Hole {i + 1}
                </span>
                <span className="text-[12px] opacity-70 text-left">{stats}</span>
                <span
                  className={`font-bold min-w-[38px] text-right ${
                    r.points === 0 ? 'text-[#8494c9]' : 'text-[#c79bff]'
                  }`}
                >
                  +{r.points}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="my-3.5 text-[17px]">
          Reward:{' '}
          <b className="text-[#ffe07a] text-[22px]">
            {pendingReward.toLocaleString()}&nbsp;$STARS
          </b>
        </div>

        <button className="btn-primary" onClick={claimReward}>
          Claim Reward
        </button>
        <button className="btn-ghost" onClick={goToLobby}>
          Play Again
        </button>
      </div>
    </section>
  );
}
