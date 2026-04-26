'use client';

import { useEffect, useRef } from 'react';
import { CFG, WORLD } from '@/lib/config';
import {
  clamp,
  createSim,
  launchRocket,
  obstacleWorldPos,
  previewTrajectory,
  resetRocket,
  stepSim,
} from '@/lib/physics';
import { useGameStore } from '@/store/game';
import type { Aim, Particle, Phase, Sim } from '@/lib/types';

type Viewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
  dpr: number;
};

/**
 * The playfield canvas. Owns the imperative game loop via refs so we don't
 * trigger React renders on every frame. Bridges to Zustand only on phase
 * transitions (stroke counted, hole complete, hole failed).
 */
export default function PlayfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Refs for sim state — never trigger re-renders.
  const simRef = useRef<Sim | null>(null);
  const aimRef = useRef<Aim | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const particlesRef = useRef<Particle[]>([]);
  const physAccRef = useRef(0);
  const lastFrameRef = useRef(0);
  const vpRef = useRef<Viewport>({ scale: 1, offsetX: 0, offsetY: 0, dpr: 1 });
  const pendingTimeoutsRef = useRef<number[]>([]);

  // Mirror current store values into refs so the RAF loop has fresh data
  // without subscribing/re-rendering each frame.
  const currentHoleIdx = useGameStore((s) => s.currentHoleIdx);
  const holes = useGameStore((s) => s.holes);
  const screen = useGameStore((s) => s.screen);

  // Latest store values inside callbacks
  const strokesRef = useRef(0);
  const slingshotThisHoleRef = useRef(false);
  useEffect(() => {
    strokesRef.current = useGameStore.getState().strokes;
    return useGameStore.subscribe((s) => {
      strokesRef.current = s.strokes;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Sim lifecycle: (re)create when the active hole changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const hole = holes[currentHoleIdx];
    if (!hole) return;
    simRef.current = createSim(hole);
    aimRef.current = null;
    phaseRef.current = 'aiming';
    particlesRef.current = [];
    physAccRef.current = 0;
    slingshotThisHoleRef.current = false;

    const showFlash = useGameStore.getState().showFlash;
    showFlash(`Hole ${hole.index + 1} · ${hole.difficulty} · Par ${hole.par}`, 1400);
  }, [currentHoleIdx, holes]);

  // ---------------------------------------------------------------------------
  // Resize / viewport math.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      const scaleX = canvas.width / WORLD.w;
      const scaleY = canvas.height / WORLD.h;
      const scale = Math.min(scaleX, scaleY);
      vpRef.current = {
        scale,
        offsetX: (canvas.width - WORLD.w * scale) / 2,
        offsetY: (canvas.height - WORLD.h * scale) / 2,
        dpr,
      };
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ---------------------------------------------------------------------------
  // Pointer input.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const clientToWorld = (clientX: number, clientY: number) => {
      const vp = vpRef.current;
      const rect = canvas.getBoundingClientRect();
      const sx = (clientX - rect.left) * vp.dpr;
      const sy = (clientY - rect.top) * vp.dpr;
      return { x: (sx - vp.offsetX) / vp.scale, y: (sy - vp.offsetY) / vp.scale };
    };

    const onDown = (e: PointerEvent) => {
      if (phaseRef.current !== 'aiming') return;
      e.preventDefault();
      const p = clientToWorld(e.clientX, e.clientY);
      aimRef.current = { start: p, current: p };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!aimRef.current) return;
      e.preventDefault();
      aimRef.current.current = clientToWorld(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent) => {
      if (!aimRef.current || !simRef.current) return;
      e.preventDefault();
      const aim = aimRef.current;
      aimRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      const dx = aim.current.x - aim.start.x;
      const dy = aim.current.y - aim.start.y;
      const lenWorld = Math.hypot(dx, dy);
      const power = clamp(lenWorld / 380, 0, 1);
      if (power < 0.05) return; // miss-tap
      const angle = Math.atan2(dy, dx);
      launchRocket(simRef.current, angle, power);
      phaseRef.current = 'flight';
      useGameStore.getState().incrementStrokes();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // RAF main loop (physics + render).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    let rafId = 0;

    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        // remove from list when fired
        pendingTimeoutsRef.current = pendingTimeoutsRef.current.filter((x) => x !== id);
        if (!cancelled) fn();
      }, ms);
      pendingTimeoutsRef.current.push(id);
    };

    const onShotOutcome = (outcome: 'target' | 'crash' | 'bounds' | 'stall') => {
      const sim = simRef.current;
      if (!sim) return;
      const store = useGameStore.getState();
      const r = sim.rocket;

      if (outcome === 'target') {
        if (r.minPlanetProximity < CFG.slingshotDistanceMult) {
          slingshotThisHoleRef.current = true;
        }
        spawnBurst(sim.hole.target.x, sim.hole.target.y, '200, 230, 255', 36, 340);
        store.showFlash(strokesRef.current === 1 ? 'HOLE-IN-ONE!' : 'HOLE COMPLETE', 1200);
        store.recordHoleResult({
          completed: true,
          strokes: strokesRef.current,
          par: sim.hole.par,
          slingshot: slingshotThisHoleRef.current,
          points: 0, // recomputed inside the action
        });
        phaseRef.current = 'between';
        schedule(() => useGameStore.getState().advanceHole(), 1400);
        return;
      }

      const explodeColor = outcome === 'crash' ? '255, 140, 90' : '150, 170, 255';
      if (outcome === 'crash' || outcome === 'bounds') {
        spawnBurst(r.pos.x, r.pos.y, explodeColor, 18, 260);
      }

      if (strokesRef.current >= CFG.maxStrokesPerHole) {
        store.showFlash('OUT OF STROKES', 1100);
        store.recordHoleResult({
          completed: false,
          strokes: strokesRef.current,
          par: sim.hole.par,
          slingshot: false,
          points: 0,
        });
        phaseRef.current = 'between';
        schedule(() => useGameStore.getState().advanceHole(), 1400);
        return;
      }

      const subtitles: Record<string, string> = {
        crash: 'crashed',
        bounds: 'out of bounds',
        stall: 'stalled',
      };
      store.showFlash(subtitles[outcome] || 'miss', 700);
      schedule(() => {
        const s = simRef.current;
        if (!s) return;
        resetRocket(s);
        phaseRef.current = 'aiming';
      }, 550);
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(now - (lastFrameRef.current || now), 100);
      lastFrameRef.current = now;

      const sim = simRef.current;

      if (phaseRef.current === 'flight' && sim) {
        physAccRef.current += dt;
        while (physAccRef.current >= CFG.fixedDtMs && phaseRef.current === 'flight') {
          const outcome = stepSim(sim, CFG.fixedDtMs);
          physAccRef.current -= CFG.fixedDtMs;
          if (outcome !== 'flying') {
            onShotOutcome(outcome);
            physAccRef.current = 0;
            break;
          }
        }
      } else if (sim) {
        // keep obstacles animating between strokes
        sim.elapsedMs += dt;
        physAccRef.current = 0;
      }

      if (sim) render(ctx, canvas, sim, vpRef.current, particlesRef.current, phaseRef.current, aimRef.current, now);

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      pendingTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      pendingTimeoutsRef.current = [];
    };
  }, []);

  // ---------------------------------------------------------------------------
  // External: reset-hole button (lives in GameScreen) calls into here via
  // a custom event. Simpler than threading a ref upward.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onReset = () => {
      const sim = simRef.current;
      if (!sim) return;
      const phase = phaseRef.current;
      if (phase !== 'aiming' && phase !== 'flight') return;
      if (strokesRef.current >= CFG.maxStrokesPerHole) return;
      useGameStore.getState().resetHoleAddStroke();
      resetRocket(sim);
      phaseRef.current = 'aiming';
      useGameStore.getState().showFlash('reset hole (+1)', 700);
    };
    window.addEventListener('orbital-golf:reset-hole', onReset);
    return () => window.removeEventListener('orbital-golf:reset-hole', onReset);
  }, []);

  // Helper for particle bursts (closes over particlesRef).
  function spawnBurst(x: number, y: number, color: string, n = 24, speed = 300) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 2 + Math.random() * 3,
        life: 600 + Math.random() * 500,
        born: now,
        color,
        alpha: 0.9,
      });
    }
  }

  // Don't render the canvas if we're not on the game screen — saves some work.
  if (screen !== 'game') return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block z-10"
      style={{ touchAction: 'none' }}
    />
  );
}

/* ===========================================================================
 * Drawing
 * ===========================================================================
 */

function worldToScreen(x: number, y: number, vp: Viewport) {
  return { x: x * vp.scale + vp.offsetX, y: y * vp.scale + vp.offsetY };
}

function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sim: Sim,
  vp: Viewport,
  particles: Particle[],
  phase: Phase,
  aim: Aim | null,
  now: number
) {
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const tl = worldToScreen(0, 0, vp);
  const br = worldToScreen(WORLD.w, WORLD.h, vp);
  const bw = br.x - tl.x;
  const bh = br.y - tl.y;

  ctx.save();
  ctx.beginPath();
  ctx.rect(tl.x, tl.y, bw, bh);
  ctx.clip();

  const grd = ctx.createLinearGradient(0, tl.y, 0, br.y);
  grd.addColorStop(0, 'rgba(20, 22, 50, 0.25)');
  grd.addColorStop(1, 'rgba(8, 9, 22, 0.1)');
  ctx.fillStyle = grd;
  ctx.fillRect(tl.x, tl.y, bw, bh);

  for (const p of sim.hole.planets) drawPlanet(ctx, p, vp);
  for (const o of sim.hole.obstacles) drawObstacle(ctx, o, vp, sim.elapsedMs);

  drawTarget(ctx, sim.hole.target, sim.hole.targetRadius, vp, sim.elapsedMs);
  drawTrail(ctx, sim.rocket.trail, vp);

  if (phase === 'aiming' && aim) {
    const dx = aim.current.x - aim.start.x;
    const dy = aim.current.y - aim.start.y;
    const lenWorld = Math.hypot(dx, dy);
    const power = clamp(lenWorld / 380, 0, 1);
    if (power > 0.02) {
      const angle = Math.atan2(dy, dx);
      const pts = previewTrajectory(sim.hole, sim.hole.start, angle, power, 420);
      drawTrajectoryPreview(ctx, pts, vp);
      drawAimIndicator(ctx, sim.hole.start, angle, power, vp);
    }
  }

  drawRocket(ctx, sim.rocket, vp, phase);
  drawParticles(ctx, particles, vp, now);

  ctx.restore();

  ctx.strokeStyle = 'rgba(120, 150, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(tl.x, tl.y, bw, bh);
}

function drawPlanet(
  ctx: CanvasRenderingContext2D,
  p: Sim['hole']['planets'][number],
  vp: Viewport
) {
  const sc = worldToScreen(p.pos.x, p.pos.y, vp);
  const r = p.radius * vp.scale;

  const glowR = r * 1.8;
  const glow = ctx.createRadialGradient(sc.x, sc.y, r * 0.8, sc.x, sc.y, glowR);
  if (p.repulsive) {
    glow.addColorStop(0, 'rgba(255, 120, 100, 0.35)');
    glow.addColorStop(1, 'rgba(255, 80, 60, 0)');
  } else {
    glow.addColorStop(0, 'rgba(150, 180, 255, 0.25)');
    glow.addColorStop(1, 'rgba(120, 150, 255, 0)');
  }
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, glowR, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(
    sc.x - r * 0.35,
    sc.y - r * 0.35,
    r * 0.1,
    sc.x,
    sc.y,
    r
  );
  if (p.repulsive) {
    body.addColorStop(0, '#ffb199');
    body.addColorStop(0.5, '#d04a44');
    body.addColorStop(1, '#5a1416');
  } else {
    const hueBase = Math.floor(((p.mass - 0.5) / 1.5) * 180);
    body.addColorStop(0, `hsl(${180 + hueBase}, 60%, 75%)`);
    body.addColorStop(0.6, `hsl(${200 + hueBase * 0.5}, 55%, 45%)`);
    body.addColorStop(1, `hsl(${220 + hueBase * 0.3}, 60%, 18%)`);
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = p.repulsive
    ? 'rgba(255, 180, 160, 0.5)'
    : 'rgba(170, 200, 255, 0.28)';
  ctx.lineWidth = Math.max(1, vp.scale * 1.5);
  ctx.stroke();

  if (p.repulsive) {
    ctx.strokeStyle = 'rgba(255, 230, 230, 0.9)';
    ctx.lineWidth = Math.max(2, vp.scale * 2);
    const tickLen = r * 0.45;
    ctx.beginPath();
    ctx.moveTo(sc.x - tickLen, sc.y);
    ctx.lineTo(sc.x + tickLen, sc.y);
    ctx.moveTo(sc.x, sc.y - tickLen);
    ctx.lineTo(sc.x, sc.y + tickLen);
    ctx.stroke();
  }
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  o: Sim['hole']['obstacles'][number],
  vp: Viewport,
  elapsed: number
) {
  const pos = obstacleWorldPos(o, elapsed);
  const sc = worldToScreen(pos.x, pos.y, vp);
  const r = o.radius * vp.scale;

  if (o.type === 'moving') {
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.005);
    const rr = r * (1.2 + pulse * 0.3);
    const grd = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, rr * 1.5);
    grd.addColorStop(0, 'rgba(255, 90, 130, 0.35)');
    grd.addColorStop(1, 'rgba(255, 90, 130, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, rr * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff4a6e';
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd0dc';
    ctx.lineWidth = Math.max(1, vp.scale * 1.2);
    ctx.stroke();
    return;
  }

  const sides = 7;
  const rot = o.rot + (o.spin * elapsed) / 1000;
  ctx.save();
  ctx.translate(sc.x, sc.y);
  ctx.rotate(rot);
  ctx.fillStyle = '#4a4550';
  ctx.strokeStyle = 'rgba(200, 200, 230, 0.4)';
  ctx.lineWidth = Math.max(1, vp.scale);
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const rr = r * (0.78 + 0.22 * Math.sin(i * 2.3));
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTarget(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  radius: number,
  vp: Viewport,
  elapsed: number
) {
  const sc = worldToScreen(pos.x, pos.y, vp);
  const r = radius * vp.scale;
  const t = elapsed * 0.001;

  const grd = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, r * 2.6);
  grd.addColorStop(0, 'rgba(160, 240, 255, 0.35)');
  grd.addColorStop(0.5, 'rgba(140, 120, 255, 0.18)');
  grd.addColorStop(1, 'rgba(80, 40, 200, 0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, r * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(sc.x, sc.y);
  ctx.rotate(t * 1.2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const x = Math.cos(a) * r * 0.55;
    const y = Math.sin(a) * r * 0.55;
    const grd2 = ctx.createRadialGradient(x, y, 0, x, y, r * 0.6);
    grd2.addColorStop(0, 'rgba(220, 240, 255, 0.75)');
    grd2.addColorStop(1, 'rgba(160, 100, 255, 0)');
    ctx.fillStyle = grd2;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(10, 8, 30, 0.9)';
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(170, 220, 255, 0.9)';
  ctx.lineWidth = Math.max(2, vp.scale * 2);
  ctx.beginPath();
  ctx.arc(sc.x, sc.y, r * (1 + 0.06 * Math.sin(t * 2.5)), 0, Math.PI * 2);
  ctx.stroke();
}

function drawRocket(
  ctx: CanvasRenderingContext2D,
  rocket: Sim['rocket'],
  vp: Viewport,
  phase: Phase
) {
  const sc = worldToScreen(rocket.pos.x, rocket.pos.y, vp);
  let angle = Math.atan2(rocket.vel.y, rocket.vel.x);
  if (Math.hypot(rocket.vel.x, rocket.vel.y) < 1) angle = -Math.PI / 2;

  ctx.save();
  ctx.translate(sc.x, sc.y);
  ctx.rotate(angle);

  const rr = CFG.rocketRadius * vp.scale;

  if (phase === 'flight') {
    const flick = 0.6 + Math.random() * 0.7;
    const g = ctx.createLinearGradient(-rr * 0.8, 0, -rr * 2.6 * flick, 0);
    g.addColorStop(0, 'rgba(255, 230, 140, 0.95)');
    g.addColorStop(0.5, 'rgba(255, 150, 80, 0.7)');
    g.addColorStop(1, 'rgba(255, 80, 60, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-rr * 0.6, -rr * 0.45);
    ctx.lineTo(-rr * 2.6 * flick, 0);
    ctx.lineTo(-rr * 0.6, rr * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  const body = ctx.createLinearGradient(-rr, 0, rr, 0);
  body.addColorStop(0, '#7c8fce');
  body.addColorStop(0.55, '#e8ecff');
  body.addColorStop(1, '#9cb6ff');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#1f2750';
  ctx.lineWidth = Math.max(1, vp.scale);
  ctx.beginPath();
  ctx.moveTo(rr * 1.2, 0);
  ctx.lineTo(-rr * 0.6, -rr * 0.7);
  ctx.lineTo(-rr * 0.3, 0);
  ctx.lineTo(-rr * 0.6, rr * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#5a80ff';
  ctx.beginPath();
  ctx.arc(rr * 0.3, 0, rr * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  if (phase === 'aiming') {
    const t = (performance.now() % 1200) / 1200;
    ctx.strokeStyle = `rgba(160, 200, 255, ${0.7 - t * 0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      sc.x,
      sc.y,
      (CFG.rocketRadius + 6) * vp.scale * (1 + t * 1.2),
      0,
      Math.PI * 2
    );
    ctx.stroke();
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: { x: number; y: number }[],
  vp: Viewport
) {
  if (trail.length < 2) return;
  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1];
    const curr = trail[i];
    if (!prev || !curr) continue;
    const a = worldToScreen(prev.x, prev.y, vp);
    const b = worldToScreen(curr.x, curr.y, vp);
    const t = i / trail.length;
    ctx.strokeStyle = `rgba(170, 210, 255, ${t * 0.75})`;
    ctx.lineWidth = Math.max(1, vp.scale * (1 + t * 1.5));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawTrajectoryPreview(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number; hit?: boolean }>,
  vp: Viewport
) {
  if (pts.length < 2) return;
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    if (!pt) continue;
    const sc = worldToScreen(pt.x, pt.y, vp);
    const alpha = Math.max(0, 0.75 - (i / pts.length) * 0.75);
    ctx.fillStyle = pt.hit ? 'rgba(180, 255, 220, 1)' : `rgba(220, 230, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, Math.max(1.4, vp.scale * 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAimIndicator(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  angle: number,
  power: number,
  vp: Viewport
) {
  const sc = worldToScreen(start.x, start.y, vp);
  const len = power * CFG.maxLaunchSpeed * 0.24 * vp.scale;

  ctx.strokeStyle = 'rgba(170, 200, 255, 0.45)';
  ctx.lineWidth = Math.max(2, vp.scale * 3);
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(sc.x, sc.y);
  ctx.lineTo(sc.x + Math.cos(angle) * len, sc.y + Math.sin(angle) * len);
  ctx.stroke();
  ctx.setLineDash([]);

  const ax = sc.x + Math.cos(angle) * len;
  const ay = sc.y + Math.sin(angle) * len;
  const ah = 10 * vp.scale;
  ctx.fillStyle = power > 0.75 ? '#ffba80' : '#b2c8ff';
  ctx.beginPath();
  ctx.moveTo(ax + Math.cos(angle) * ah, ay + Math.sin(angle) * ah);
  ctx.lineTo(ax + Math.cos(angle + 2.4) * ah, ay + Math.sin(angle + 2.4) * ah);
  ctx.lineTo(ax + Math.cos(angle - 2.4) * ah, ay + Math.sin(angle - 2.4) * ah);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(230, 240, 255, 0.85)';
  ctx.font = `${Math.max(11, vp.scale * 14)}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.round(power * 100)}%`, ax, ay - 10);
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  vp: Viewport,
  now: number
) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (!p) continue;
    const age = now - p.born;
    if (age > p.life) {
      particles.splice(i, 1);
      continue;
    }
    const t = age / p.life;
    const sc = worldToScreen(p.x, p.y, vp);
    ctx.fillStyle = `rgba(${p.color}, ${(1 - t) * p.alpha})`;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, p.r * (1 - t * 0.3) * vp.scale, 0, Math.PI * 2);
    ctx.fill();
    p.x += p.vx * 0.016;
    p.y += p.vy * 0.016;
    p.vx *= 0.98;
    p.vy *= 0.98;
  }
}
