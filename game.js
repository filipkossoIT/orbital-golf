/* Orbital Golf — demo build
 * Self-contained playable demo. Mocks wallet + chain.
 * Physics: N-body gravitational pulls, fixed-timestep substep integration.
 * Levels: seeded procedural generation per spec §4.4.
 */

/* =========================================================================
 * Config
 * ========================================================================= */

const WORLD = { w: 1200, h: 2000 };

const CFG = {
  fixedDtMs: 1000 / 60,
  substeps: 4,
  gravityConstant: 1.8e7, // tuned for the 1200x2000 world
  rocketRadius: 14,
  maxLaunchSpeed: 950,    // world units / sec at full power
  maxSpeed: 2400,
  boundsPadding: 220,
  stallSpeed: 25,
  stallTimeMs: 2800,
  maxStrokesPerHole: 8,
  slingshotDistanceMult: 2.4, // rocket within this * radius = slingshot
};

const PARS     = [3, 3, 4, 4, 5];
const DIFFICULTY_LABEL = ['Tutorial', 'Easy', 'Medium', 'Hard', 'Expert'];

const REWARD_TIERS = [
  { name: 'Platinum', minScore: 20, mult: 10,  cls: 'platinum' },
  { name: 'Gold',     minScore: 15, mult: 3,   cls: 'gold'     },
  { name: 'Silver',   minScore: 10, mult: 1.5, cls: 'silver'   },
  { name: 'Bronze',   minScore: 5,  mult: 0.8, cls: 'bronze'   },
];
const ENTRY_FEE = 50;
const BURN_BPS = 5000; // 50%

/* =========================================================================
 * Deterministic RNG — string seed → mulberry32 sub-streams
 * ========================================================================= */

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function subStream(rootSeed, label) {
  return mulberry32(hashSeed(rootSeed + ':' + label));
}

function randomHex32() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/* =========================================================================
 * Helpers
 * ========================================================================= */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const dist  = (a, b) => Math.sqrt(dist2(a, b));

/* =========================================================================
 * Level generation — spec §4.4 (with §2.5 planet/obstacle shape)
 * ========================================================================= */

function generateHole(rootSeed, holeIndex) {
  const rng = subStream(rootSeed, `levelgen:hole:${holeIndex}`);
  const { w, h } = WORLD;

  const start = {
    x: clamp(w / 2 + (rng() * 2 - 1) * 220, 180, w - 180),
    y: h - 180 - rng() * 120,
  };
  const target = {
    x: clamp(w / 2 + (rng() * 2 - 1) * 320, 180, w - 180),
    y: 200 + rng() * 120,
  };
  const targetRadius = 52;

  // Shape per spec §2.5
  const planetCount = [1, 2, 3, 3, 4][holeIndex];
  const repulsorIdx = (holeIndex === 3) ? planetCount - 1 : -1;

  const planets = [];
  const minGap = 230;
  let tries = 0;
  while (planets.length < planetCount && tries < 400) {
    tries++;
    const mass = 0.55 + rng() * 1.55;
    const radius = 32 + ((mass - 0.55) / 1.55) * 38;
    const pos = {
      x: 180 + rng() * (w - 360),
      y: 320 + rng() * (h - 640),
    };
    const okStart = dist(pos, start) > minGap + radius;
    const okTarget = dist(pos, target) > minGap + radius + targetRadius;
    const okOthers = planets.every(p => dist(pos, p.pos) > minGap + radius + p.radius);
    if (okStart && okTarget && okOthers) {
      planets.push({
        pos, mass, radius,
        repulsive: planets.length === repulsorIdx,
      });
    }
  }

  const obstacles = [];
  const addCluster = (t, n) => {
    const cx = start.x + (target.x - start.x) * t + (rng() * 2 - 1) * 140;
    const cy = start.y + (target.y - start.y) * t + (rng() * 2 - 1) * 140;
    // keep clusters away from planets
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
    start, target, targetRadius,
    planets, obstacles,
    par: PARS[holeIndex],
    bounds: { w, h },
    difficulty: DIFFICULTY_LABEL[holeIndex],
  };
}

function generateRound(seed) {
  const holes = [];
  for (let i = 0; i < 5; i++) holes.push(generateHole(seed, i));
  return holes;
}

/* =========================================================================
 * Physics simulation
 * ========================================================================= */

function createSim(hole) {
  return {
    hole,
    rocket: {
      pos: { ...hole.start },
      vel: { x: 0, y: 0 },
      alive: true,
      minPlanetProximity: Infinity, // ratio of rocket-to-planet-center / planet.radius
      flightTimeMs: 0,
      trail: [],
    },
    elapsedMs: 0,
    stallTimer: 0,
  };
}

function resetRocket(sim) {
  sim.rocket.pos = { ...sim.hole.start };
  sim.rocket.vel = { x: 0, y: 0 };
  sim.rocket.alive = true;
  sim.rocket.minPlanetProximity = Infinity;
  sim.rocket.flightTimeMs = 0;
  sim.rocket.trail = [];
  sim.stallTimer = 0;
}

function launchRocket(sim, angle, power) {
  const speed = clamp(power, 0, 1) * CFG.maxLaunchSpeed;
  sim.rocket.vel.x = Math.cos(angle) * speed;
  sim.rocket.vel.y = Math.sin(angle) * speed;
  sim.rocket.alive = true;
  sim.rocket.minPlanetProximity = Infinity;
  sim.rocket.flightTimeMs = 0;
  sim.rocket.trail = [{ ...sim.rocket.pos }];
  sim.stallTimer = 0;
}

function obstacleWorldPos(o, elapsedMs) {
  if (o.type === 'moving') {
    const t = elapsedMs / o.periodMs * Math.PI * 2 + o.phase;
    return { x: o.baseX + Math.sin(t) * o.amplitude, y: o.baseY + Math.cos(t * 0.7) * 30 };
  }
  return o.pos;
}

/**
 * Step the sim forward by dtMs. Returns one of:
 *   'flying'  | rocket still moving
 *   'target'  | rocket reached wormhole
 *   'bounds'  | out of bounds, lost stroke
 *   'crash'   | planet/obstacle collision, lost stroke
 *   'stall'   | rocket stalled, lost stroke
 */
function stepSim(sim, dtMs) {
  const { rocket, hole } = sim;
  sim.elapsedMs += dtMs;

  const sdtMs = dtMs / CFG.substeps;
  const sdt = sdtMs / 1000;

  for (let step = 0; step < CFG.substeps; step++) {
    // Accumulate forces from planets (F = G m / r², direction along planet dir)
    let ax = 0, ay = 0;
    for (const p of hole.planets) {
      const dx = p.pos.x - rocket.pos.x;
      const dy = p.pos.y - rocket.pos.y;
      let r2 = dx * dx + dy * dy;
      if (r2 < 100) r2 = 100; // avoid singularity near center
      const r = Math.sqrt(r2);
      const sign = p.repulsive ? -1 : 1;
      const f = sign * CFG.gravityConstant * p.mass / r2;
      ax += f * dx / r;
      ay += f * dy / r;

      // slingshot proximity tracking (non-repulsive only)
      if (!p.repulsive) {
        const ratio = r / p.radius;
        if (ratio < rocket.minPlanetProximity) rocket.minPlanetProximity = ratio;
      }
    }

    rocket.vel.x += ax * sdt;
    rocket.vel.y += ay * sdt;

    // speed cap
    const sp = Math.hypot(rocket.vel.x, rocket.vel.y);
    if (sp > CFG.maxSpeed) {
      const k = CFG.maxSpeed / sp;
      rocket.vel.x *= k;
      rocket.vel.y *= k;
    }

    rocket.pos.x += rocket.vel.x * sdt;
    rocket.pos.y += rocket.vel.y * sdt;

    rocket.flightTimeMs += sdtMs;

    // target check
    const td = Math.hypot(hole.target.x - rocket.pos.x, hole.target.y - rocket.pos.y);
    if (td < hole.targetRadius) return 'target';

    // bounds check
    const P = CFG.boundsPadding;
    if (rocket.pos.x < -P || rocket.pos.x > hole.bounds.w + P ||
        rocket.pos.y < -P || rocket.pos.y > hole.bounds.h + P) {
      return 'bounds';
    }

    // planet collision (absorbing)
    for (const p of hole.planets) {
      const d = Math.hypot(p.pos.x - rocket.pos.x, p.pos.y - rocket.pos.y);
      if (d < p.radius + CFG.rocketRadius) return 'crash';
    }

    // obstacle collision
    for (const o of hole.obstacles) {
      const op = obstacleWorldPos(o, sim.elapsedMs - (CFG.substeps - 1 - step) * sdtMs);
      const d = Math.hypot(op.x - rocket.pos.x, op.y - rocket.pos.y);
      if (d < o.radius + CFG.rocketRadius) return 'crash';
    }
  }

  // trail sampling (every tick)
  rocket.trail.push({ x: rocket.pos.x, y: rocket.pos.y });
  if (rocket.trail.length > 140) rocket.trail.shift();

  // stall detection
  const speedNow = Math.hypot(rocket.vel.x, rocket.vel.y);
  if (speedNow < CFG.stallSpeed) {
    sim.stallTimer += dtMs;
    if (sim.stallTimer > CFG.stallTimeMs) return 'stall';
  } else {
    sim.stallTimer = 0;
  }

  return 'flying';
}

// Pure simulation (no side effects) — used for trajectory preview.
function previewTrajectory(hole, startPos, angle, power, steps) {
  const speed = clamp(power, 0, 1) * CFG.maxLaunchSpeed;
  const r = {
    pos: { ...startPos },
    vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
  };
  const pts = [];
  const sdtMs = CFG.fixedDtMs / CFG.substeps;
  const sdt = sdtMs / 1000;
  for (let s = 0; s < steps; s++) {
    let ax = 0, ay = 0;
    for (const p of hole.planets) {
      const dx = p.pos.x - r.pos.x;
      const dy = p.pos.y - r.pos.y;
      let r2 = dx * dx + dy * dy;
      if (r2 < 100) r2 = 100;
      const rr = Math.sqrt(r2);
      const sign = p.repulsive ? -1 : 1;
      const f = sign * CFG.gravityConstant * p.mass / r2;
      ax += f * dx / rr;
      ay += f * dy / rr;
    }
    r.vel.x += ax * sdt;
    r.vel.y += ay * sdt;
    r.pos.x += r.vel.x * sdt;
    r.pos.y += r.vel.y * sdt;

    // sample every 2 steps for perf
    if (s % 2 === 0) pts.push({ x: r.pos.x, y: r.pos.y });

    // stop early if out of bounds or hits target/planet
    if (r.pos.x < -100 || r.pos.x > hole.bounds.w + 100 ||
        r.pos.y < -100 || r.pos.y > hole.bounds.h + 100) break;
    for (const p of hole.planets) {
      const d = Math.hypot(p.pos.x - r.pos.x, p.pos.y - r.pos.y);
      if (d < p.radius + CFG.rocketRadius) return pts;
    }
    const td = Math.hypot(hole.target.x - r.pos.x, hole.target.y - r.pos.y);
    if (td < hole.targetRadius) { pts.push({ x: r.pos.x, y: r.pos.y, hit: true }); break; }
  }
  return pts;
}

/* =========================================================================
 * Scoring — spec §2.3
 * ========================================================================= */

function scoreHole(result) {
  if (!result.completed) return 0;
  let pts = Math.max(0, result.par - result.strokes + 1);
  if (result.strokes === 1) pts += 3;
  if (result.slingshot) pts += 2;
  return pts;
}

function tierForScore(score) {
  for (const t of REWARD_TIERS) if (score >= t.minScore) return t;
  return null;
}

/* =========================================================================
 * Mock wallet
 * ========================================================================= */

const wallet = {
  connected: false,
  pubkey: null,
  balance: 1000,
  totalBurned: 0,
  prizePool: 0,
  connect() {
    this.connected = true;
    this.pubkey = randomPubkey();
    syncChips();
  },
  chargeEntry() {
    if (this.balance < ENTRY_FEE) return false;
    this.balance -= ENTRY_FEE;
    const burn = Math.floor(ENTRY_FEE * BURN_BPS / 10000);
    this.totalBurned += burn;
    this.prizePool += ENTRY_FEE - burn;
    syncChips();
    return true;
  },
  credit(amt) {
    this.balance += amt;
    syncChips();
  },
};

function randomPubkey() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 44; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function formatAddr(a) { return a.slice(0, 4) + '…' + a.slice(-4); }

/* =========================================================================
 * Game state
 * ========================================================================= */

const game = {
  seed: null,
  holes: [],
  currentHoleIdx: 0,
  sim: null,
  phase: 'idle', // 'aiming' | 'flight' | 'between' | 'done'
  strokes: 0,
  slingshotThisHole: false,
  results: [], // per-hole { completed, strokes, par, slingshot, points }

  // Input
  aim: null, // { startWorld, currentWorld } during drag

  // Effects
  particles: [],
  flashTimer: 0,
};

/* =========================================================================
 * Canvas + viewport
 * ========================================================================= */

const gameCanvas = document.getElementById('game-canvas');
const gctx = gameCanvas.getContext('2d');

const starCanvas = document.getElementById('starfield');
const sctx = starCanvas.getContext('2d');

let vp = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1, cssW: 0, cssH: 0 };

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;

  // Starfield (covers whole window)
  starCanvas.width = window.innerWidth * dpr;
  starCanvas.height = window.innerHeight * dpr;
  starCanvas.style.width = window.innerWidth + 'px';
  starCanvas.style.height = window.innerHeight + 'px';
  drawStarfield();

  // Game canvas
  const cssW = gameCanvas.clientWidth;
  const cssH = gameCanvas.clientHeight;
  gameCanvas.width = cssW * dpr;
  gameCanvas.height = cssH * dpr;

  const scaleX = gameCanvas.width / WORLD.w;
  const scaleY = gameCanvas.height / WORLD.h;
  const scale = Math.min(scaleX, scaleY);
  vp = {
    scale,
    offsetX: (gameCanvas.width - WORLD.w * scale) / 2,
    offsetY: (gameCanvas.height - WORLD.h * scale) / 2,
    dpr,
    cssW, cssH,
  };
}

function worldToScreen(x, y) {
  return { x: x * vp.scale + vp.offsetX, y: y * vp.scale + vp.offsetY };
}

function clientToWorld(clientX, clientY) {
  const rect = gameCanvas.getBoundingClientRect();
  const sx = (clientX - rect.left) * vp.dpr;
  const sy = (clientY - rect.top) * vp.dpr;
  return { x: (sx - vp.offsetX) / vp.scale, y: (sy - vp.offsetY) / vp.scale };
}

/* =========================================================================
 * Starfield (drawn once per resize)
 * ========================================================================= */

function drawStarfield() {
  const w = starCanvas.width, h = starCanvas.height;
  sctx.clearRect(0, 0, w, h);

  // Nebula blobs
  const blobs = 5;
  const rng = mulberry32(0xC0FFEE);
  for (let i = 0; i < blobs; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const rad = 180 * vp.dpr + rng() * 300 * vp.dpr;
    const hue = 220 + Math.floor(rng() * 80);
    const grd = sctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grd.addColorStop(0, `hsla(${hue}, 80%, 55%, 0.18)`);
    grd.addColorStop(1, 'hsla(240, 60%, 30%, 0)');
    sctx.fillStyle = grd;
    sctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }

  // Stars
  const count = Math.floor((w * h) / (8000 * vp.dpr));
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (rng() * rng() * 1.8 + 0.3) * vp.dpr;
    sctx.fillStyle = `rgba(255, 255, 255, ${0.3 + rng() * 0.6})`;
    sctx.beginPath();
    sctx.arc(x, y, r, 0, Math.PI * 2);
    sctx.fill();
  }
}

/* =========================================================================
 * Rendering
 * ========================================================================= */

let lastRafTime = 0;

function render(now) {
  if (!game.sim) return;

  const W = gameCanvas.width, H = gameCanvas.height;
  gctx.clearRect(0, 0, W, H);

  // Draw the playable bounds softly
  const tl = worldToScreen(0, 0);
  const br = worldToScreen(WORLD.w, WORLD.h);
  const bw = br.x - tl.x, bh = br.y - tl.y;

  gctx.save();
  gctx.beginPath();
  gctx.rect(tl.x, tl.y, bw, bh);
  gctx.clip();

  // Subtle inner-world background to distinguish playfield from overflow
  const grd = gctx.createLinearGradient(0, tl.y, 0, br.y);
  grd.addColorStop(0, 'rgba(20, 22, 50, 0.25)');
  grd.addColorStop(1, 'rgba(8, 9, 22, 0.1)');
  gctx.fillStyle = grd;
  gctx.fillRect(tl.x, tl.y, bw, bh);

  const hole = game.sim.hole;
  const elapsed = game.sim.elapsedMs;

  // Planets
  for (const p of hole.planets) drawPlanet(p, elapsed);

  // Obstacles
  for (const o of hole.obstacles) drawObstacle(o, elapsed);

  // Target / wormhole
  drawTarget(hole.target, hole.targetRadius, elapsed);

  // Trail
  drawTrail(game.sim.rocket.trail);

  // Trajectory preview while aiming
  if (game.phase === 'aiming' && game.aim) {
    const { angle, power } = aimVector();
    if (power > 0.02) {
      const pts = previewTrajectory(hole, hole.start, angle, power, 420);
      drawTrajectoryPreview(pts);
    }
  }

  // Rocket
  drawRocket(game.sim.rocket, game.phase);

  // Aim indicator
  if (game.phase === 'aiming' && game.aim) drawAimIndicator();

  // Particles
  drawParticles(now || performance.now());

  gctx.restore();

  // Thin frame around bounds
  gctx.strokeStyle = 'rgba(120, 150, 255, 0.12)';
  gctx.lineWidth = 1;
  gctx.strokeRect(tl.x, tl.y, bw, bh);
}

function drawPlanet(p, elapsed) {
  const sc = worldToScreen(p.pos.x, p.pos.y);
  const r = p.radius * vp.scale;

  // atmosphere glow
  const glowR = r * 1.8;
  const glowGrd = gctx.createRadialGradient(sc.x, sc.y, r * 0.8, sc.x, sc.y, glowR);
  if (p.repulsive) {
    glowGrd.addColorStop(0, 'rgba(255, 120, 100, 0.35)');
    glowGrd.addColorStop(1, 'rgba(255, 80, 60, 0)');
  } else {
    glowGrd.addColorStop(0, 'rgba(150, 180, 255, 0.25)');
    glowGrd.addColorStop(1, 'rgba(120, 150, 255, 0)');
  }
  gctx.fillStyle = glowGrd;
  gctx.beginPath();
  gctx.arc(sc.x, sc.y, glowR, 0, Math.PI * 2);
  gctx.fill();

  // Body with shading
  const bodyGrd = gctx.createRadialGradient(
    sc.x - r * 0.35, sc.y - r * 0.35, r * 0.1,
    sc.x, sc.y, r
  );
  if (p.repulsive) {
    bodyGrd.addColorStop(0, '#ffb199');
    bodyGrd.addColorStop(0.5, '#d04a44');
    bodyGrd.addColorStop(1, '#5a1416');
  } else {
    const hueBase = Math.floor(((p.mass - 0.5) / 1.5) * 180);
    bodyGrd.addColorStop(0, `hsl(${180 + hueBase}, 60%, 75%)`);
    bodyGrd.addColorStop(0.6, `hsl(${200 + hueBase * 0.5}, 55%, 45%)`);
    bodyGrd.addColorStop(1, `hsl(${220 + hueBase * 0.3}, 60%, 18%)`);
  }
  gctx.fillStyle = bodyGrd;
  gctx.beginPath();
  gctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
  gctx.fill();

  // Subtle rim
  gctx.strokeStyle = p.repulsive ? 'rgba(255, 180, 160, 0.5)' : 'rgba(170, 200, 255, 0.28)';
  gctx.lineWidth = Math.max(1, vp.scale * 1.5);
  gctx.stroke();

  // Repulsor mark
  if (p.repulsive) {
    gctx.strokeStyle = 'rgba(255, 230, 230, 0.9)';
    gctx.lineWidth = Math.max(2, vp.scale * 2);
    const tickLen = r * 0.45;
    gctx.beginPath();
    gctx.moveTo(sc.x - tickLen, sc.y);
    gctx.lineTo(sc.x + tickLen, sc.y);
    gctx.moveTo(sc.x, sc.y - tickLen);
    gctx.lineTo(sc.x, sc.y + tickLen);
    gctx.stroke();
  }
}

function drawObstacle(o, elapsed) {
  const pos = obstacleWorldPos(o, elapsed);
  const sc = worldToScreen(pos.x, pos.y);
  const r = o.radius * vp.scale;

  if (o.type === 'moving') {
    // pulsing warning ring
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.005);
    const rr = r * (1.2 + pulse * 0.3);
    const grd = gctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, rr * 1.5);
    grd.addColorStop(0, 'rgba(255, 90, 130, 0.35)');
    grd.addColorStop(1, 'rgba(255, 90, 130, 0)');
    gctx.fillStyle = grd;
    gctx.beginPath();
    gctx.arc(sc.x, sc.y, rr * 1.5, 0, Math.PI * 2);
    gctx.fill();

    gctx.fillStyle = '#ff4a6e';
    gctx.beginPath();
    gctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = '#ffd0dc';
    gctx.lineWidth = Math.max(1, vp.scale * 1.2);
    gctx.stroke();
    return;
  }

  // asteroid — irregular polygon
  const sides = 7;
  const rot = o.rot + (o.spin * elapsed / 1000);
  gctx.save();
  gctx.translate(sc.x, sc.y);
  gctx.rotate(rot);
  gctx.fillStyle = '#4a4550';
  gctx.strokeStyle = 'rgba(200, 200, 230, 0.4)';
  gctx.lineWidth = Math.max(1, vp.scale);
  gctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const rr = r * (0.78 + 0.22 * Math.sin(i * 2.3));
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) gctx.moveTo(x, y); else gctx.lineTo(x, y);
  }
  gctx.closePath();
  gctx.fill();
  gctx.stroke();
  gctx.restore();
}

function drawTarget(pos, radius, elapsed) {
  const sc = worldToScreen(pos.x, pos.y);
  const r = radius * vp.scale;
  const t = elapsed * 0.001;

  // outer glow
  const grd = gctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, r * 2.6);
  grd.addColorStop(0, 'rgba(160, 240, 255, 0.35)');
  grd.addColorStop(0.5, 'rgba(140, 120, 255, 0.18)');
  grd.addColorStop(1, 'rgba(80, 40, 200, 0)');
  gctx.fillStyle = grd;
  gctx.beginPath();
  gctx.arc(sc.x, sc.y, r * 2.6, 0, Math.PI * 2);
  gctx.fill();

  // rotating swirl
  gctx.save();
  gctx.translate(sc.x, sc.y);
  gctx.rotate(t * 1.2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const x = Math.cos(a) * r * 0.55;
    const y = Math.sin(a) * r * 0.55;
    const grd2 = gctx.createRadialGradient(x, y, 0, x, y, r * 0.6);
    grd2.addColorStop(0, 'rgba(220, 240, 255, 0.75)');
    grd2.addColorStop(1, 'rgba(160, 100, 255, 0)');
    gctx.fillStyle = grd2;
    gctx.beginPath();
    gctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
    gctx.fill();
  }
  gctx.restore();

  // inner event horizon
  gctx.fillStyle = 'rgba(10, 8, 30, 0.9)';
  gctx.beginPath();
  gctx.arc(sc.x, sc.y, r * 0.5, 0, Math.PI * 2);
  gctx.fill();

  // ring
  gctx.strokeStyle = 'rgba(170, 220, 255, 0.9)';
  gctx.lineWidth = Math.max(2, vp.scale * 2);
  gctx.beginPath();
  gctx.arc(sc.x, sc.y, r * (1 + 0.06 * Math.sin(t * 2.5)), 0, Math.PI * 2);
  gctx.stroke();
}

function drawRocket(r, phase) {
  const sc = worldToScreen(r.pos.x, r.pos.y);
  let angle = Math.atan2(r.vel.y, r.vel.x);
  if (Math.hypot(r.vel.x, r.vel.y) < 1) angle = -Math.PI / 2; // pointing up at rest

  gctx.save();
  gctx.translate(sc.x, sc.y);
  gctx.rotate(angle);

  const rr = CFG.rocketRadius * vp.scale;

  // flame when in flight
  if (phase === 'flight') {
    const flick = 0.6 + Math.random() * 0.7;
    const g = gctx.createLinearGradient(-rr * 0.8, 0, -rr * 2.6 * flick, 0);
    g.addColorStop(0, 'rgba(255, 230, 140, 0.95)');
    g.addColorStop(0.5, 'rgba(255, 150, 80, 0.7)');
    g.addColorStop(1, 'rgba(255, 80, 60, 0)');
    gctx.fillStyle = g;
    gctx.beginPath();
    gctx.moveTo(-rr * 0.6, -rr * 0.45);
    gctx.lineTo(-rr * 2.6 * flick, 0);
    gctx.lineTo(-rr * 0.6, rr * 0.45);
    gctx.closePath();
    gctx.fill();
  }

  // body
  const body = gctx.createLinearGradient(-rr, 0, rr, 0);
  body.addColorStop(0, '#7c8fce');
  body.addColorStop(0.55, '#e8ecff');
  body.addColorStop(1, '#9cb6ff');
  gctx.fillStyle = body;
  gctx.strokeStyle = '#1f2750';
  gctx.lineWidth = Math.max(1, vp.scale);
  gctx.beginPath();
  gctx.moveTo(rr * 1.2, 0);
  gctx.lineTo(-rr * 0.6, -rr * 0.7);
  gctx.lineTo(-rr * 0.3, 0);
  gctx.lineTo(-rr * 0.6, rr * 0.7);
  gctx.closePath();
  gctx.fill();
  gctx.stroke();

  // window
  gctx.fillStyle = '#5a80ff';
  gctx.beginPath();
  gctx.arc(rr * 0.3, 0, rr * 0.22, 0, Math.PI * 2);
  gctx.fill();

  gctx.restore();

  // pulse when aiming
  if (phase === 'aiming') {
    const t = (performance.now() % 1200) / 1200;
    gctx.strokeStyle = `rgba(160, 200, 255, ${0.7 - t * 0.7})`;
    gctx.lineWidth = 2;
    gctx.beginPath();
    gctx.arc(sc.x, sc.y, (CFG.rocketRadius + 6) * vp.scale * (1 + t * 1.2), 0, Math.PI * 2);
    gctx.stroke();
  }
}

function drawTrail(trail) {
  if (trail.length < 2) return;
  for (let i = 1; i < trail.length; i++) {
    const a = worldToScreen(trail[i - 1].x, trail[i - 1].y);
    const b = worldToScreen(trail[i].x, trail[i].y);
    const t = i / trail.length;
    gctx.strokeStyle = `rgba(170, 210, 255, ${t * 0.75})`;
    gctx.lineWidth = Math.max(1, vp.scale * (1 + t * 1.5));
    gctx.beginPath();
    gctx.moveTo(a.x, a.y);
    gctx.lineTo(b.x, b.y);
    gctx.stroke();
  }
}

function drawTrajectoryPreview(pts) {
  if (pts.length < 2) return;
  for (let i = 0; i < pts.length; i++) {
    const sc = worldToScreen(pts[i].x, pts[i].y);
    const alpha = Math.max(0, 0.75 - (i / pts.length) * 0.75);
    gctx.fillStyle = pts[i].hit ? 'rgba(180, 255, 220, 1)' : `rgba(220, 230, 255, ${alpha})`;
    gctx.beginPath();
    gctx.arc(sc.x, sc.y, Math.max(1.4, vp.scale * 2), 0, Math.PI * 2);
    gctx.fill();
  }
}

function drawAimIndicator() {
  const { angle, power } = aimVector();
  const start = game.sim.hole.start;
  const sc = worldToScreen(start.x, start.y);
  const len = power * CFG.maxLaunchSpeed * 0.24 * vp.scale; // visual only

  // power bar arc
  gctx.strokeStyle = 'rgba(170, 200, 255, 0.45)';
  gctx.lineWidth = Math.max(2, vp.scale * 3);
  gctx.setLineDash([6, 6]);
  gctx.beginPath();
  gctx.moveTo(sc.x, sc.y);
  gctx.lineTo(sc.x + Math.cos(angle) * len, sc.y + Math.sin(angle) * len);
  gctx.stroke();
  gctx.setLineDash([]);

  // arrow head
  const ax = sc.x + Math.cos(angle) * len;
  const ay = sc.y + Math.sin(angle) * len;
  const ah = 10 * vp.scale;
  gctx.fillStyle = power > 0.75 ? '#ffba80' : '#b2c8ff';
  gctx.beginPath();
  gctx.moveTo(ax + Math.cos(angle) * ah, ay + Math.sin(angle) * ah);
  gctx.lineTo(ax + Math.cos(angle + 2.4) * ah, ay + Math.sin(angle + 2.4) * ah);
  gctx.lineTo(ax + Math.cos(angle - 2.4) * ah, ay + Math.sin(angle - 2.4) * ah);
  gctx.closePath();
  gctx.fill();

  // power label
  gctx.fillStyle = 'rgba(230, 240, 255, 0.85)';
  gctx.font = `${Math.max(11, vp.scale * 14)}px -apple-system, "Segoe UI", sans-serif`;
  gctx.textAlign = 'center';
  gctx.textBaseline = 'bottom';
  gctx.fillText(`${Math.round(power * 100)}%`, ax, ay - 10);
}

function drawParticles(now) {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    const age = now - p.born;
    if (age > p.life) { game.particles.splice(i, 1); continue; }
    const t = age / p.life;
    const sc = worldToScreen(p.x, p.y);
    gctx.fillStyle = `rgba(${p.color}, ${(1 - t) * p.alpha})`;
    gctx.beginPath();
    gctx.arc(sc.x, sc.y, p.r * (1 - t * 0.3) * vp.scale, 0, Math.PI * 2);
    gctx.fill();
    p.x += p.vx * 0.016;
    p.y += p.vy * 0.016;
    p.vx *= 0.98;
    p.vy *= 0.98;
  }
}

function spawnBurst(x, y, color, n = 24, speed = 300) {
  const now = performance.now();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.8);
    game.particles.push({
      x, y,
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

/* =========================================================================
 * Input handling (pointer events — unified touch + mouse)
 * ========================================================================= */

function aimVector() {
  if (!game.aim) return { angle: 0, power: 0 };
  const dx = game.aim.current.x - game.aim.start.x;
  const dy = game.aim.current.y - game.aim.start.y;
  const lenWorld = Math.hypot(dx, dy);
  // 380 world units of drag = full power
  const power = clamp(lenWorld / 380, 0, 1);
  const angle = Math.atan2(dy, dx);
  return { angle, power };
}

function onPointerDown(e) {
  if (game.phase !== 'aiming') return;
  e.preventDefault();
  const p = clientToWorld(e.clientX, e.clientY);
  game.aim = { start: p, current: p };
  gameCanvas.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!game.aim) return;
  e.preventDefault();
  game.aim.current = clientToWorld(e.clientX, e.clientY);
}

function onPointerUp(e) {
  if (!game.aim) return;
  e.preventDefault();
  const { angle, power } = aimVector();
  game.aim = null;
  try { gameCanvas.releasePointerCapture(e.pointerId); } catch (_) {}

  if (power < 0.05) return; // too small, ignore as a miss-tap

  // fire!
  launchRocket(game.sim, angle, power);
  game.phase = 'flight';
  game.strokes += 1;
  updateHUD();
}

gameCanvas.addEventListener('pointerdown', onPointerDown);
gameCanvas.addEventListener('pointermove', onPointerMove);
gameCanvas.addEventListener('pointerup',   onPointerUp);
gameCanvas.addEventListener('pointercancel', onPointerUp);

/* =========================================================================
 * Flow control
 * ========================================================================= */

function startRound() {
  game.seed = randomHex32();
  game.holes = generateRound(game.seed);
  game.currentHoleIdx = 0;
  game.results = [];
  loadHole(0);
  showScreen('screen-game');
  game.phase = 'aiming';
  updateHUD();
}

function loadHole(i) {
  game.currentHoleIdx = i;
  game.strokes = 0;
  game.slingshotThisHole = false;
  game.sim = createSim(game.holes[i]);
  game.phase = 'aiming';
  updateHUD();
  flashMsg(`Hole ${i + 1} · ${game.holes[i].difficulty} · Par ${game.holes[i].par}`, 1400);
}

function recordHoleResult(completed) {
  const hole = game.sim.hole;
  const result = {
    completed,
    strokes: game.strokes,
    par: hole.par,
    slingshot: completed && game.slingshotThisHole,
  };
  result.points = scoreHole(result);
  game.results.push(result);
}

function advanceHole() {
  if (game.currentHoleIdx + 1 >= game.holes.length) {
    finishRound();
  } else {
    loadHole(game.currentHoleIdx + 1);
  }
}

function finishRound() {
  const total = game.results.reduce((s, r) => s + r.points, 0);
  const tier = tierForScore(total);
  const payout = tier ? Math.round(ENTRY_FEE * tier.mult) : 0;

  document.getElementById('final-score').textContent = total;

  const badge = document.getElementById('tier-badge');
  if (tier) {
    badge.textContent = tier.name;
    badge.className = 'tier-badge ' + tier.cls;
  } else {
    badge.textContent = 'No Tier';
    badge.className = 'tier-badge';
  }

  const breakdown = document.getElementById('hole-breakdown');
  breakdown.innerHTML = '';
  game.results.forEach((r, i) => {
    const li = document.createElement('li');
    const stats = r.completed
      ? `${r.strokes}/${r.par}${r.strokes === 1 ? ' · hole-in-one' : ''}${r.slingshot ? ' · slingshot' : ''}`
      : `failed · max strokes`;
    li.innerHTML = `
      <span class="hole-label">Hole ${i + 1}</span>
      <span class="hole-stats">${stats}</span>
      <span class="hole-points ${r.points === 0 ? 'zero' : ''}">+${r.points}</span>`;
    breakdown.appendChild(li);
  });

  document.getElementById('reward-amount').textContent = payout;

  // stash for claim button
  game._pendingReward = payout;

  game.phase = 'done';
  showScreen('screen-end');
}

function onShotOutcome(outcome) {
  const r = game.sim.rocket;
  if (outcome === 'target') {
    // Slingshot detection: this shot brought rocket within slingshotDistanceMult * planet.radius
    if (r.minPlanetProximity < CFG.slingshotDistanceMult) {
      game.slingshotThisHole = true;
    }
    spawnBurst(game.sim.hole.target.x, game.sim.hole.target.y, '200, 230, 255', 36, 340);
    flashMsg(game.strokes === 1 ? 'HOLE-IN-ONE!' : 'HOLE COMPLETE', 1200);
    recordHoleResult(true);
    game.phase = 'between';
    setTimeout(advanceHole, 1400);
    return;
  }

  // lost stroke outcomes
  const explodeColor = outcome === 'crash' ? '255, 140, 90' : '150, 170, 255';
  if (outcome === 'crash' || outcome === 'bounds') {
    spawnBurst(r.pos.x, r.pos.y, explodeColor, 18, 260);
  }

  if (game.strokes >= CFG.maxStrokesPerHole) {
    flashMsg('OUT OF STROKES', 1100);
    recordHoleResult(false);
    game.phase = 'between';
    setTimeout(advanceHole, 1400);
    return;
  }

  // Reset rocket for next stroke
  const subtitles = { crash: 'crashed', bounds: 'out of bounds', stall: 'stalled' };
  flashMsg(subtitles[outcome] || 'miss', 700);
  setTimeout(() => {
    resetRocket(game.sim);
    game.phase = 'aiming';
    updateHUD();
  }, 550);
}

function resetHoleBtn() {
  if (game.phase !== 'aiming' && game.phase !== 'flight') return;
  if (game.strokes >= CFG.maxStrokesPerHole) return;
  game.strokes += 1;
  resetRocket(game.sim);
  game.phase = 'aiming';
  updateHUD();
  flashMsg('reset hole (+1)', 700);
}

/* =========================================================================
 * UI glue
 * ========================================================================= */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  if (id === 'screen-game') {
    // resize after it's actually on screen & has dimensions
    requestAnimationFrame(resizeCanvas);
  }
}

function syncChips() {
  const addrEl = document.getElementById('wallet-addr');
  const balEl = document.getElementById('balance');
  const burnEl = document.getElementById('total-burned');
  if (wallet.connected) addrEl.textContent = formatAddr(wallet.pubkey);
  if (balEl) balEl.textContent = wallet.balance.toLocaleString();
  if (burnEl) burnEl.textContent = wallet.totalBurned.toLocaleString();
}

function updateHUD() {
  document.getElementById('hud-hole').textContent = `${game.currentHoleIdx + 1}/5`;
  document.getElementById('hud-strokes').textContent = String(game.strokes);
  const hole = game.holes[game.currentHoleIdx];
  document.getElementById('hud-par').textContent = hole ? String(hole.par) : '–';
  const runningScore = game.results.reduce((s, r) => s + r.points, 0);
  document.getElementById('hud-score').textContent = String(runningScore);
}

function flashMsg(text, durMs = 1000) {
  const el = document.getElementById('flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashMsg._t);
  flashMsg._t = setTimeout(() => el.classList.remove('show'), durMs);
}

/* =========================================================================
 * Button wiring
 * ========================================================================= */

document.getElementById('btn-connect').addEventListener('click', () => {
  wallet.connect();
  showScreen('screen-lobby');
  syncChips();
});

document.getElementById('btn-start-round').addEventListener('click', () => {
  if (!wallet.chargeEntry()) {
    flashMsg('insufficient $STARS', 1200);
    return;
  }
  startRound();
});

document.getElementById('btn-reset-hole').addEventListener('click', resetHoleBtn);

document.getElementById('btn-claim').addEventListener('click', () => {
  const amt = game._pendingReward || 0;
  if (amt > 0) wallet.credit(amt);
  game._pendingReward = 0;
  showScreen('screen-lobby');
  syncChips();
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  // Forfeit any unclaimed reward — pressing "play again" skips claim
  game._pendingReward = 0;
  showScreen('screen-lobby');
  syncChips();
});

/* =========================================================================
 * Main loop
 * ========================================================================= */

let physAccumulator = 0;

function tick(now) {
  const dt = Math.min(now - (lastRafTime || now), 100);
  lastRafTime = now;

  // Physics (fixed timestep)
  if (game.phase === 'flight' && game.sim) {
    physAccumulator += dt;
    while (physAccumulator >= CFG.fixedDtMs && game.phase === 'flight') {
      const outcome = stepSim(game.sim, CFG.fixedDtMs);
      physAccumulator -= CFG.fixedDtMs;
      if (outcome !== 'flying') {
        onShotOutcome(outcome);
        physAccumulator = 0;
        break;
      }
    }
  } else {
    // keep obstacles animating and elapsedMs ticking even when idle
    if (game.sim) game.sim.elapsedMs += dt;
    physAccumulator = 0;
  }

  if (game.sim) render(now);

  requestAnimationFrame(tick);
}

/* =========================================================================
 * Boot
 * ========================================================================= */

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
showScreen('screen-start');
requestAnimationFrame(tick);
