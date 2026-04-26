import { REWARD_TIERS } from './config';
import type { RewardTier } from './types';

export function scoreHole(result: {
  completed: boolean;
  strokes: number;
  par: number;
  slingshot: boolean;
}): number {
  if (!result.completed) return 0;
  let pts = Math.max(0, result.par - result.strokes + 1);
  if (result.strokes === 1) pts += 3;
  if (result.slingshot) pts += 2;
  return pts;
}

export function tierForScore(score: number): RewardTier | null {
  for (const t of REWARD_TIERS) if (score >= t.minScore) return t;
  return null;
}
