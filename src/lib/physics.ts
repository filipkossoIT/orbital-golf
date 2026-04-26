import { CFG } from './config';
import type { Hole, Obstacle, ShotOutcome, Sim, Vec2 } from './types';

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export function createSim(hole: Hole): Sim {
  return {
    hole,
    rocket: {
      pos: { ...hole.start },
      vel: { x: 0, y: 0 },
      alive: true,
      minPlanetProximity: Infinity,
      flightTimeMs: 0,
      trail: [],
    },
    elapsedMs: 0,
    stallTimer: 0,
  };
}

export function resetRocket(sim: Sim): void {
  sim.rocket.pos = { ...sim.hole.start };
  sim.rocket.vel = { x: 0, y: 0 };
  sim.rocket.alive = true;
  sim.rocket.minPlanetProximity = Infinity;
  sim.rocket.flightTimeMs = 0;
  sim.rocket.trail = [];
  sim.stallTimer = 0;
}

export function launchRocket(sim: Sim, angle: number, power: number): void {
  const speed = clamp(power, 0, 1) * CFG.maxLaunchSpeed;
  sim.rocket.vel.x = Math.cos(angle) * speed;
  sim.rocket.vel.y = Math.sin(angle) * speed;
  sim.rocket.alive = true;
  sim.rocket.minPlanetProximity = Infinity;
  sim.rocket.flightTimeMs = 0;
  sim.rocket.trail = [{ ...sim.rocket.pos }];
  sim.stallTimer = 0;
}

export function obstacleWorldPos(o: Obstacle, elapsedMs: number): Vec2 {
  if (o.type === 'moving') {
    const t = (elapsedMs / o.periodMs) * Math.PI * 2 + o.phase;
    return {
      x: o.baseX + Math.sin(t) * o.amplitude,
      y: o.baseY + Math.cos(t * 0.7) * 30,
    };
  }
  return o.pos;
}

/**
 * Step the sim forward by dtMs. Returns the shot outcome.
 */
export function stepSim(sim: Sim, dtMs: number): ShotOutcome {
  const { rocket, hole } = sim;
  sim.elapsedMs += dtMs;

  const sdtMs = dtMs / CFG.substeps;
  const sdt = sdtMs / 1000;

  for (let step = 0; step < CFG.substeps; step++) {
    let ax = 0;
    let ay = 0;
    for (const p of hole.planets) {
      const dx = p.pos.x - rocket.pos.x;
      const dy = p.pos.y - rocket.pos.y;
      let r2 = dx * dx + dy * dy;
      if (r2 < 100) r2 = 100;
      const r = Math.sqrt(r2);
      const sign = p.repulsive ? -1 : 1;
      const f = (sign * CFG.gravityConstant * p.mass) / r2;
      ax += (f * dx) / r;
      ay += (f * dy) / r;

      if (!p.repulsive) {
        const ratio = r / p.radius;
        if (ratio < rocket.minPlanetProximity) rocket.minPlanetProximity = ratio;
      }
    }

    rocket.vel.x += ax * sdt;
    rocket.vel.y += ay * sdt;

    const sp = Math.hypot(rocket.vel.x, rocket.vel.y);
    if (sp > CFG.maxSpeed) {
      const k = CFG.maxSpeed / sp;
      rocket.vel.x *= k;
      rocket.vel.y *= k;
    }

    rocket.pos.x += rocket.vel.x * sdt;
    rocket.pos.y += rocket.vel.y * sdt;

    rocket.flightTimeMs += sdtMs;

    const td = Math.hypot(hole.target.x - rocket.pos.x, hole.target.y - rocket.pos.y);
    if (td < hole.targetRadius) return 'target';

    const P = CFG.boundsPadding;
    if (
      rocket.pos.x < -P ||
      rocket.pos.x > hole.bounds.w + P ||
      rocket.pos.y < -P ||
      rocket.pos.y > hole.bounds.h + P
    ) {
      return 'bounds';
    }

    for (const p of hole.planets) {
      const d = Math.hypot(p.pos.x - rocket.pos.x, p.pos.y - rocket.pos.y);
      if (d < p.radius + CFG.rocketRadius) return 'crash';
    }

    for (const o of hole.obstacles) {
      const op = obstacleWorldPos(o, sim.elapsedMs - (CFG.substeps - 1 - step) * sdtMs);
      const d = Math.hypot(op.x - rocket.pos.x, op.y - rocket.pos.y);
      if (d < o.radius + CFG.rocketRadius) return 'crash';
    }
  }

  rocket.trail.push({ x: rocket.pos.x, y: rocket.pos.y });
  if (rocket.trail.length > 140) rocket.trail.shift();

  const speedNow = Math.hypot(rocket.vel.x, rocket.vel.y);
  if (speedNow < CFG.stallSpeed) {
    sim.stallTimer += dtMs;
    if (sim.stallTimer > CFG.stallTimeMs) return 'stall';
  } else {
    sim.stallTimer = 0;
  }

  return 'flying';
}

export type PreviewPoint = Vec2 & { hit?: boolean };

/**
 * Pure trajectory simulation (no side effects). Used for the aim preview.
 */
export function previewTrajectory(
  hole: Hole,
  startPos: Vec2,
  angle: number,
  power: number,
  steps: number
): PreviewPoint[] {
  const speed = clamp(power, 0, 1) * CFG.maxLaunchSpeed;
  const r = {
    pos: { ...startPos },
    vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
  };
  const pts: PreviewPoint[] = [];
  const sdtMs = CFG.fixedDtMs / CFG.substeps;
  const sdt = sdtMs / 1000;

  for (let s = 0; s < steps; s++) {
    let ax = 0;
    let ay = 0;
    for (const p of hole.planets) {
      const dx = p.pos.x - r.pos.x;
      const dy = p.pos.y - r.pos.y;
      let r2 = dx * dx + dy * dy;
      if (r2 < 100) r2 = 100;
      const rr = Math.sqrt(r2);
      const sign = p.repulsive ? -1 : 1;
      const f = (sign * CFG.gravityConstant * p.mass) / r2;
      ax += (f * dx) / rr;
      ay += (f * dy) / rr;
    }
    r.vel.x += ax * sdt;
    r.vel.y += ay * sdt;
    r.pos.x += r.vel.x * sdt;
    r.pos.y += r.vel.y * sdt;

    if (s % 2 === 0) pts.push({ x: r.pos.x, y: r.pos.y });

    if (
      r.pos.x < -100 ||
      r.pos.x > hole.bounds.w + 100 ||
      r.pos.y < -100 ||
      r.pos.y > hole.bounds.h + 100
    )
      break;

    for (const p of hole.planets) {
      const d = Math.hypot(p.pos.x - r.pos.x, p.pos.y - r.pos.y);
      if (d < p.radius + CFG.rocketRadius) return pts;
    }

    const td = Math.hypot(hole.target.x - r.pos.x, hole.target.y - r.pos.y);
    if (td < hole.targetRadius) {
      pts.push({ x: r.pos.x, y: r.pos.y, hit: true });
      break;
    }
  }
  return pts;
}
