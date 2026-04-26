'use client';

import { useGameStore } from '@/store/game';

export default function StartScreen() {
  const connectWallet = useGameStore((s) => s.connectWallet);

  return (
    <section className="absolute inset-0 z-10 flex flex-col items-center justify-center p-5 animate-fadein">
      <div className="panel">
        <h1 className="gradient-title text-[42px] font-extrabold tracking-[2px] mb-2">
          Orbital&nbsp;Golf
        </h1>
        <p className="text-[15px] opacity-85 mb-1.5">
          Slingshot your rocket through planets to reach the wormhole.
        </p>
        <p className="text-[12px] tracking-[1.5px] uppercase text-[#7d8bc1] mb-5">
          Pay $STARS · 5 holes · best score wins
        </p>
        <button className="btn-primary" onClick={connectWallet}>
          Connect Wallet
        </button>
        <p className="text-[11px] opacity-45 mt-3.5 tracking-[0.4px]">
          Demo build — wallet & chain interactions are mocked.
        </p>
      </div>
    </section>
  );
}
