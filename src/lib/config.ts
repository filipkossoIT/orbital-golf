import type { RewardTier } from './types';

export const WORLD = { w: 1200, h: 2000 } as const;

export const CFG = {
  fixedDtMs: 1000 / 60,
  substeps: 4,
  gravityConstant: 1.8e7, // tuned for the 1200x2000 world
  rocketRadius: 14,
  maxLaunchSpeed: 950, // world units / sec at full power
  maxSpeed: 2400,
  boundsPadding: 220,
  stallSpeed: 25,
  stallTimeMs: 2800,
  maxStrokesPerHole: 8,
  slingshotDistanceMult: 2.4,
} as const;

export const PARS = [3, 3, 4, 4, 5] as const;
export const DIFFICULTY_LABEL = ['Tutorial', 'Easy', 'Medium', 'Hard', 'Expert'] as const;

export const REWARD_TIERS: RewardTier[] = [
  { name: 'Platinum', minScore: 20, mult: 10,  cls: 'platinum' },
  { name: 'Gold',     minScore: 15, mult: 3,   cls: 'gold'     },
  { name: 'Silver',   minScore: 10, mult: 1.5, cls: 'silver'   },
  { name: 'Bronze',   minScore: 5,  mult: 0.8, cls: 'bronze'   },
];

export const ENTRY_FEE = 50;
export const BURN_BPS = 5000; // 50%
