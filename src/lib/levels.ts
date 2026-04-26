import { DIFFICULTY_LABEL, PARS, WORLD } from './config';
import { subStream } from './rng';
import type { Hole, Obstacle, Planet, Vec2 } from './types';
import { clamp } from './physics';

const dist = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function generateHole(rootSeed: string, holeIndex: number): Hole {
  const rng = subStream(rootSeed, `levelgen:hole:${holeIndex}`);
  const { w, h } = WORLD;

  const start: Vec2 = {
    x: clamp(w / 2 + (rng() * 2 - 1) * 220, 180, w - 180),
    y: h - 180 - rng() * 120,
  };
  const target: Vec2 = {
    x: clamp(w / 2 + (rng() * 2 - 1) * 320, 180, w - 180),
    y: 200 + rng() * 120,
  };
  const targetRadius = 52;

  const planetCounts = [1, 2, 3, 3, 4] as const;
  const planetCount = planetCounts[holeIndex] ?? 1;
  const repulsorIdx = holeIndex === 3 ? planetCount - 1 : -1;

  const planets: Planet[] = [];
  const minGap = 230;
  let tries = 0;
  while (planets.length < planetCount && tries < 400) {
    tries++;
    const mass = 0.55 + rng() * 1.55;
    const radius = 32 + ((mass - 0.55) / 1.55) * 38;
    const pos: Vec2 = {
      x: 180 + rng() * (w - 360),
      y: 320 + rng() * (h - 640),
    };
    const okStart = dist(pos, start) > minGap + radius;
    const okTarget = dist(pos, target) > minGap + radius + targetRadius;
    const okOthers = planets.every((p) => dist(pos, p.pos) > minGap + radius + p.radius);
    if (okStart && okTarget && okOthers) {
      planets.push({
        pos,
        mass,
        radius,
        repulsive: planets.length === repulsorIdx,
      });
    }
  }

  const obstacles: Obstacle[] = [];
  const addCluster = (t: number, n: number) => {
    const cx = start.x + (target.x - start.x) * t + (rng() * 2 - 1) * 140;
    const cy = start.y + (target.y - start.y) * t + (rng() * 2 - 1) * 140;
    for (const p of planets) {
      const d = Math.hypot(p.pos.x - cx, p.pos.y - cy);
      if (d < p.radius + 120) return;
    }
    for (let j = 0; j < n; j++) {
      obstacles.push({
        type: 'asteroid',
        pos: { x: cx + (rng() * 2 - 1) * 80, y: cy + (rng() * 2 - 1) * 80 },
        radius: 11 + rng() * 11,
        spin: (rng() * 2 - 1) * 0.8,
        rot: rng() * Math.PI * 2,
      });
    }
  };

  if (holeIndex === 1) addCluster(0.5, 5);
  if (holeIndex === 2) {
    obstacles.push({
      type: 'moving',
      baseX: w / 2 + (rng() * 2 - 1) * 120,
      baseY: 600 + rng() * (h - 1200),
      amplitude: 260 + rng() * 120,
      periodMs: 3200 + rng() * 1400,
      phase: rng() * Math.PI * 2,
      radius: 28,
    });
  }
  if (holeIndex === 3) {
    addCluster(0.3, 4);
    addCluster(0.55, 5);
    addCluster(0.75, 4);
  }
  if (holeIndex === 4) {
    addCluster(0.25, 4);
    addCluster(0.45, 5);
    addCluster(0.65, 5);
    addCluster(0.82, 4);
    obstacles.push({
      type: 'moving',
      baseX: w / 2 + (rng() * 2 - 1) * 80,
      baseY: 450 + rng() * 250,
      amplitude: 200 + rng() * 100,
      periodMs: 2800 + rng() * 1200,
      phase: rng() * Math.PI * 2,
      radius: 26,
    });
  }

  return {
    index: holeIndex,
    start,
    target,
    targetRadius,
    planets,
    obstacles,
    par: PARS[holeIndex] ?? 3,
    bounds: { w, h },
    difficulty: DIFFICULTY_LABEL[holeIndex] ?? 'Hole',
  };
}

export function generateRound(seed: string): Hole[] {
  const holes: Hole[] = [];
  for (let i = 0; i < 5; i++) holes.push(generateHole(seed, i));
  return holes;
}
