import { create } from 'zustand';
import { BURN_BPS, ENTRY_FEE } from '@/lib/config';
import { generateRound } from '@/lib/levels';
import { randomHex32 } from '@/lib/rng';
import { scoreHole, tierForScore } from '@/lib/scoring';
import { randomPubkey } from '@/lib/wallet';
import type { FlashMsg, Hole, HoleResult, Screen } from '@/lib/types';

type State = {
  // UI
  screen: Screen;
  flash: FlashMsg | null;

  // Wallet
  walletConnected: boolean;
  pubkey: string | null;
  balance: number;
  totalBurned: number;
  prizePool: number;

  // Round
  seed: string | null;
  holes: Hole[];
  currentHoleIdx: number;
  strokes: number;
  results: HoleResult[];
  pendingReward: number;
  finalTierCls: 'bronze' | 'silver' | 'gold' | 'platinum' | null;
  finalTierName: string | null;
  finalScore: number;
};

type Actions = {
  setScreen: (s: Screen) => void;
  showFlash: (text: string, durMs?: number) => void;
  connectWallet: () => void;
  payAndStartRound: () => boolean;
  incrementStrokes: () => void;
  resetHoleAddStroke: () => void;
  recordHoleResult: (r: HoleResult) => void;
  advanceHole: () => void;
  claimReward: () => void;
  goToLobby: () => void;
};

let flashNonce = 0;

export const useGameStore = create<State & Actions>((set, get) => ({
  screen: 'start',
  flash: null,

  walletConnected: false,
  pubkey: null,
  balance: 1000,
  totalBurned: 0,
  prizePool: 0,

  seed: null,
  holes: [],
  currentHoleIdx: 0,
  strokes: 0,
  results: [],
  pendingReward: 0,
  finalTierCls: null,
  finalTierName: null,
  finalScore: 0,

  setScreen: (s) => set({ screen: s }),

  showFlash: (text, durMs = 1000) =>
    set({ flash: { text, durMs, nonce: ++flashNonce } }),

  connectWallet: () =>
    set({
      walletConnected: true,
      pubkey: randomPubkey(),
      screen: 'lobby',
    }),

  payAndStartRound: () => {
    const { balance, totalBurned, prizePool } = get();
    if (balance < ENTRY_FEE) {
      get().showFlash('insufficient $STARS', 1200);
      return false;
    }
    const burn = Math.floor((ENTRY_FEE * BURN_BPS) / 10000);
    const seed = randomHex32();
    set({
      balance: balance - ENTRY_FEE,
      totalBurned: totalBurned + burn,
      prizePool: prizePool + (ENTRY_FEE - burn),
      seed,
      holes: generateRound(seed),
      currentHoleIdx: 0,
      strokes: 0,
      results: [],
      pendingReward: 0,
      finalTierCls: null,
      finalTierName: null,
      finalScore: 0,
      screen: 'game',
    });
    return true;
  },

  incrementStrokes: () => set((s) => ({ strokes: s.strokes + 1 })),

  resetHoleAddStroke: () => set((s) => ({ strokes: s.strokes + 1 })),

  recordHoleResult: (r) => {
    const result = { ...r, points: scoreHole(r) };
    set((s) => ({ results: [...s.results, result] }));
  },

  advanceHole: () => {
    const { currentHoleIdx, holes, results } = get();
    if (currentHoleIdx + 1 >= holes.length) {
      const total = results.reduce((sum, r) => sum + r.points, 0);
      const tier = tierForScore(total);
      const reward = tier ? Math.round(ENTRY_FEE * tier.mult) : 0;
      set({
        screen: 'end',
        finalScore: total,
        finalTierCls: tier ? tier.cls : null,
        finalTierName: tier ? tier.name : null,
        pendingReward: reward,
      });
    } else {
      set({
        currentHoleIdx: currentHoleIdx + 1,
        strokes: 0,
      });
    }
  },

  claimReward: () => {
    const { pendingReward, balance } = get();
    set({
      balance: balance + pendingReward,
      pendingReward: 0,
      screen: 'lobby',
    });
  },

  goToLobby: () =>
    set({
      pendingReward: 0,
      screen: 'lobby',
    }),
}));
