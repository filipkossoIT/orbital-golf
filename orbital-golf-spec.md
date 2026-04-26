# Orbital Golf — Game Specification

> Mobile-first physics-puzzle game for StarLaunch.
> Pay $STARS → play 5 procedurally generated holes → verified server-side → reward paid out.

---

## 1. Overview

**Concept.** Angry Birds / mini-golf hybrid in a space-physics setting. Player launches a rocket through a procedurally generated planetary system to reach a wormhole target. Fewer launches = higher score. A round is 5 holes, ~3–6 minutes total.

**Why it fits StarLaunch:**
- Mirrors the existing "pay $STARS → chance at prize" mental model from raffles
- 50% entry burn matches StarLaunch's existing deflationary mechanic
- Async PvP via daily shared-seed tournaments (no real-time server)
- Skill-expressive, so it differentiates from the two pure-reflex demos already built

**Non-goals:**
- No in-game token transactions
- No real-time multiplayer
- No persistent player progression beyond skins & streaks (keeps scope contained)

---

## 2. Game Design

### 2.1 Core Loop

1. Player connects Solana wallet
2. Player pays entry fee (50 $STARS default) → 25 burned, 25 to prize pool
3. Anchor program creates a `GameSession` account with an on-chain seed
4. Client reads the seed, generates all 5 holes deterministically
5. Player plays all 5 holes (fully offline-safe — no chain calls during gameplay)
6. Client submits launch-param replay + claimed score to verifier service
7. Verifier re-runs canonical physics, signs an attestation if scores match
8. Anchor program accepts the attestation; player claims reward per tier

### 2.2 Controls (Mobile-First)

- **Drag** from rocket to aim; release to launch. Drag length = power (capped).
- **Trajectory preview**: fading ghost line showing first ~1s of predicted path.
- **Tap "reset hole"** to retry current hole (costs +1 stroke).
- **Pinch** to zoom, **two-finger drag** to pan.
- All interactions work equally with mouse for desktop.

### 2.3 Scoring

| Condition | Points |
|---|---|
| Completed hole in ≤ par strokes | `par - strokes + 1` |
| Hole-in-one | +3 bonus |
| Gravity-assist (no thrust mid-flight, ≥ 1 planet slingshot) | +2 bonus |
| Failed to complete (max strokes hit) | 0 for that hole |

Final score = sum across 5 holes. Max theoretical ~30.

### 2.4 Reward Tiers

| Tier | Score | Payout (of entry) |
|---|---|---|
| Bronze | ≥ 5 | 0.8× |
| Silver | ≥ 10 | 1.5× |
| Gold | ≥ 15 | 3× |
| Platinum | ≥ 20 | 10× |

Tiers & multipliers are stored in `GameConfig` and tunable by admin. Expected value is tuned <1× at launch to keep the pool solvent; burn + skill differentiation carry the economics.

### 2.5 Hole Progression

| # | Difficulty | Planets | Obstacles | Par |
|---|---|---|---|---|
| 1 | Tutorial | 1 | none | 3 |
| 2 | Easy | 2 | 1 asteroid cluster | 3 |
| 3 | Medium | 3 | 1 moving obstacle | 4 |
| 4 | Hard | 2 + 1 repulsor | asteroid field | 4 |
| 5 | Expert | 4 | asteroid maze | 5 |

---

## 3. Technical Architecture

### 3.1 Stack

- **Frontend:** Next.js 14 (App Router), TypeScript strict, Tailwind, Zustand for state
- **Physics:** Matter.js wrapped in a deterministic runner (fixed timestep, seeded RNG)
- **Rendering:** Canvas2D (sufficient for this visual complexity; PIXI.js is overkill)
- **Wallet:** `@solana/wallet-adapter-react` + `-react-ui`
- **On-chain:** Anchor (Rust)
- **API:** Next.js API routes for the lightweight stuff; standalone Fastify verifier service (reuses shared engine package)
- **DB:** Postgres (Neon or Supabase) for leaderboards & session metadata. Chain is source of truth for payments/rewards.

### 3.2 Repo Structure

```
orbital-golf/
├── apps/
│   ├── web/                    # Next.js client
│   └── verifier/               # Fastify replay verifier
├── programs/
│   └── orbital-golf/           # Anchor program
├── packages/
│   ├── engine/                 # deterministic physics + level gen (shared)
│   └── types/                  # shared TS types
└── scripts/                    # devnet setup, token mint, config init
```

Monorepo with pnpm workspaces. `packages/engine` is the critical shared piece — it must be imported unchanged by both client and verifier.

### 3.3 Determinism Strategy

**The problem:** Matter.js is not bit-exact deterministic across JS engines (V8 vs Safari's JSC differ in float ops). Naively trusting client physics = trivial cheat.

**The solution:** **Server-authoritative scoring.**
- Client runs Matter.js purely for *UX* (visuals, immediate feedback)
- Client records every launch parameter (`angle`, `power`, `timestamp`)
- After the round, client submits the parameter list to the verifier
- Verifier runs canonical physics on a locked runtime (pinned Node.js version, pinned Matter.js version) and computes the canonical score
- Client's perceived score may differ by a stroke or two — tolerable UX cost

**Guardrails to minimize drift:**
- Pin Matter.js in both client and verifier to exact same version
- Fixed timestep `1000/60ms`, substeps = 4
- Disable Matter's default gravity; apply per-planet `F = G·m/r²` each tick inside a `beforeUpdate` hook
- Seed all randomness via `seedrandom` (Alea) — works identically in all JS runtimes
- Do not use `Math.random()` anywhere in the engine package (lint rule)

---

## 4. Deterministic Engine Spec

### 4.1 Seed Source

- Seed = `sha256(slot_hash || player_pubkey || nonce)` computed in the Anchor program at `start_session`
- Stored immutably in `GameSession.seed: [u8; 32]`
- Client reads the account and uses seed for all generation & RNG

### 4.2 RNG

- `seedrandom/alea` as the only RNG primitive
- One root RNG per session, derived sub-streams by label:
  - `levelgen:hole:{i}` — level generation
  - `obstacle:{i}` — obstacle motion
  - `visual:{i}` — particle effects (**not read by physics — purely cosmetic drift is fine**)
- Visual RNG drift does not affect scoring, so the verifier skips it entirely.

### 4.3 Physics Config

```ts
// packages/engine/physics.ts
export const PHYSICS_CONFIG = {
  timestepMs: 1000 / 60,
  substeps: 4,
  gravityConstant: 0.0012,   // tune to feel
  rocketMass: 1.0,
  maxLaunchPower: 18.0,      // units/sec
  rocketRadius: 8,
  boundsPadding: 200,        // outside = stroke lost
  stallVelocity: 0.05,       // below this for 5s = stroke lost
  stallTimeMs: 5000,
  maxStrokesPerHole: 8,
} as const;
```

### 4.4 Level Generator

Inputs: `seed: string`, `holeIndex: 0..4`
Output:
```ts
type Hole = {
  start: Vec2;
  target: Vec2;
  targetRadius: number;
  planets: { pos: Vec2; mass: number; radius: number; repulsive: boolean }[];
  obstacles: Obstacle[];
  par: number;
  bounds: { w: number; h: number };  // fixed 1200x2000 portrait logical
};
```

Algorithm:
1. Deterministic RNG for this hole = `rootRng.subStream("levelgen:hole:" + holeIndex)`
2. Fixed canvas 1200×2000 logical units (portrait)
3. Start position: bottom 300px band, ±200 horizontal jitter
4. Target: top 300px band, ±300 horizontal jitter, radius 40
5. Planet count `= min(1 + holeIndex, 4)`; except hole 4 includes one repulsive
6. Place planets with rejection sampling: min 250 unit distance from start, target, and other planets
7. Planet mass ∈ `[0.5, 2.0]` uniform; radius ∈ `[30, 70]` correlated to mass
8. Obstacles: `holeIndex ≥ 2` adds 1–2 asteroid clusters on the straight-line path; `holeIndex == 3` adds a moving obstacle with deterministic sinusoidal motion
9. Par computed by A*-style search over discretized launch angle (36 buckets) × power (8 buckets) — min strokes found to reach target, then + 1 for safety margin

### 4.5 Replay Format

```ts
type Shot = {
  holeIndex: number;      // 0..4
  strokeIndex: number;    // 0..N within hole
  angle: number;          // radians
  power: number;          // 0..1
  clientTsMs: number;     // ms since session start
};

type GameSubmission = {
  sessionPda: string;
  shots: Shot[];
  claimedScore: number;
  clientVersion: string;
};
```

---

## 5. Anti-Cheat

### 5.1 Verifier Pipeline

For each submission:

1. Load `GameSession` account from chain → extract `seed`
2. Generate all 5 holes canonically from `seed`
3. Initialize canonical Matter.js engine
4. For each shot in order:
   - Place rocket at current hole's start (or at last position if hole in progress)
   - Apply launch velocity from `angle, power`
   - Step engine until one of: rocket in target (hole complete), rocket out of bounds (stroke lost, rocket respawns), rocket stalled > stallTimeMs
5. Compute canonical score from canonical hole outcomes
6. Validate:
   - `claimedScore === canonicalScore` (integer equality — score is integer)
   - Shot `clientTsMs` monotonically increasing
   - Min 200ms between shots (no bots)
   - Max 8 strokes per hole
   - All shots have `power ∈ [0, 1]`, `angle ∈ [-π, π]`
7. If all pass: sign `{ sessionPda, score, timestamp }` with Ed25519 attestor key → return signature

### 5.2 Chain-Side Verification

- `submit_score(score, attestation_sig, timestamp)` instruction
- Program uses Solana's Ed25519 precompile to verify `attestation_sig` against hardcoded `attestor: Pubkey` in `GameConfig`
- Checks `timestamp` is within 10 minutes of current `Clock::unix_timestamp`
- Writes `session.score = Some(score)`

Attacker surfaces:
- Forging attestation → requires compromising attestor key (rotate regularly, or use multisig)
- Tampering client replay → canonical physics rejects mismatched score
- Replay attacks → attestation includes `sessionPda`, and `session.score` is write-once

---

## 6. Solana Program

### 6.1 Accounts

```rust
#[account]
pub struct GameConfig {
    pub authority: Pubkey,
    pub stars_mint: Pubkey,
    pub entry_fee: u64,              // smallest units of $STARS
    pub burn_bps: u16,               // 5000 = 50%
    pub treasury_vault: Pubkey,      // token account
    pub burn_address: Pubkey,
    pub attestor: Pubkey,            // Ed25519 pubkey
    pub reward_tiers: [RewardTier; 4],
    pub daily_seed_root: [u8; 32],
    pub daily_seed_epoch: i64,       // unix day
}

#[account]
pub struct GameSession {
    pub player: Pubkey,
    pub nonce: u64,
    pub seed: [u8; 32],
    pub created_at: i64,
    pub mode: u8,                    // 0 = solo, 1 = daily
    pub score: Option<u16>,
    pub reward_claimed: bool,
}

#[account]
pub struct DailyEntry {
    pub player: Pubkey,
    pub date: i64,                   // unix day
    pub session: Pubkey,             // GameSession ref
}
```

### 6.2 Instructions

| Instruction | Signers | Effect |
|---|---|---|
| `initialize_config` | authority | one-time setup |
| `update_config` | authority | tune fees/tiers/attestor |
| `start_session(mode)` | player | debit entry; split to burn/treasury; create `GameSession` with fresh seed |
| `submit_score(score, attestation, ts)` | player | verify Ed25519 attestation, write score |
| `claim_reward` | player | pay reward tier from treasury; mark claimed |
| `rotate_daily_seed` | authority (or clock-gated permissionless) | rotate `daily_seed_root` |
| `settle_daily_tournament(date, winners)` | authority | distribute daily pool to top N |

### 6.3 PDAs

- `GameConfig`: seeds `[b"config"]`
- `GameSession`: seeds `[b"session", player.key(), nonce.to_le_bytes()]`
- `Treasury`: seeds `[b"treasury"]`
- `DailyEntry`: seeds `[b"daily", player.key(), date.to_le_bytes()]`

### 6.4 Seed Derivation (`start_session`)

```rust
let clock = Clock::get()?;
let slot_hashes = ctx.accounts.slot_hashes.data.borrow();
let recent_slot_hash = &slot_hashes[8..40]; // first slot hash entry
let mut hasher = Sha256::new();
hasher.update(recent_slot_hash);
hasher.update(ctx.accounts.player.key().as_ref());
hasher.update(&session.nonce.to_le_bytes());
let seed: [u8; 32] = hasher.finalize().into();
session.seed = seed;
```

For `mode == 1` (daily tournament): use `daily_seed_root` directly (ignore slot hash), so all players share the same seed for that day.

---

## 7. Monetization Hooks

1. **Burn-on-entry** — 50% of every entry fee burned. Visible "🔥 $STARS burned today" ticker builds psychology.
2. **Daily tournament** — 08:00 UTC new seed; single entry per wallet; top 10% split the pool. Wordle/NYT Games retention pattern, applied to crypto.
3. **Streak multiplier** — play daily N days in a row → reward multiplier ramp (1.0× → 1.5× at 7 days). Missed day resets.
4. **Cosmetic rocket skins** — NFT-gated, purely visual. Uses StarLaunch's existing NFT framework if one exists, else a new collection. Zero physics impact keeps integrity intact.
5. **Hole-in-one replays** — `/replay/<sessionPda>` shareable URL renders the replay deterministically from seed + shots. Viral loop.

---

## 8. Build Phases

### Phase 1 — Local Gameplay (Week 1–2)
- [ ] Monorepo scaffold (pnpm workspaces, Next.js, Tailwind)
- [ ] `packages/engine`: deterministic Matter.js wrapper, seedrandom, fixed timestep, per-planet gravity
- [ ] Level generator (all 5 holes)
- [ ] `GameScene` React component: Canvas2D renderer, touch + mouse drag-to-aim, trajectory preview
- [ ] Scoring + end-of-round screen
- [ ] Hardcoded seed, no blockchain

### Phase 2 — Wallet + Mock Entry (Week 3)
- [ ] Solana wallet adapter (Phantom, Solflare)
- [ ] Stub `/api/start-session` returns random seed + mock sessionPda
- [ ] Gate Start behind wallet; show pubkey + mock $STARS balance
- [ ] Client deducts 50 $STARS from displayed balance (state only)

### Phase 3 — Anchor Program on Devnet (Week 4–5)
- [ ] Deploy mock $STARS SPL mint on devnet; `scripts/setup.ts` one-shot
- [ ] Anchor program: `GameConfig`, `GameSession`, `initialize_config`, `start_session`
- [ ] Client calls real `start_session`; reads seed from chain
- [ ] Burn + treasury splits work end-to-end

### Phase 4 — Replay Verifier + Rewards (Week 6)
- [ ] `apps/verifier` Fastify service importing `packages/engine`
- [ ] `POST /verify` → Ed25519-signed attestation
- [ ] Anchor: `submit_score` (Ed25519 precompile), `claim_reward`
- [ ] Full loop working: pay → play → verify → claim

### Phase 5 — Daily Tournament + Leaderboard (Week 7)
- [ ] `daily_seed_root` rotation (cron-triggered admin tx, or permissionless with clock gate)
- [ ] `mode=1` entry path; `DailyEntry` one-per-day enforcement
- [ ] Postgres `daily_submissions` table; `/api/leaderboard/:date` endpoint
- [ ] `/tournament` UI
- [ ] `settle_daily_tournament` admin instruction

---

## 9. Claude Code Prompts

Paste at the start of each phase.

### Phase 1

```
You are building Orbital Golf per SPEC.md (at repo root). Implement Phase 1 only.

Requirements:
- pnpm workspace monorepo: apps/web (Next.js 14 App Router, TS strict, Tailwind),
  packages/engine, packages/types
- packages/engine must be framework-agnostic and importable by both client
  and (future) server. Lint rule: no Math.random() anywhere in packages/engine.
- Deterministic physics: Matter.js pinned version, fixed timestep 1000/60ms with
  4 substeps, default gravity disabled, per-planet F = G*m/r² applied in
  engine 'beforeUpdate'. RNG via seedrandom/alea, sub-streams per SPEC §4.2.
- Level generator per SPEC §4.4 — all 5 holes, par via A* search over
  discretized (angle, power) grid.
- GameScene React component: Canvas2D rendering, touch + mouse drag-to-aim
  originating from rocket, trajectory preview (first ~1s ghost line), tap
  "reset hole" button (+1 stroke), pinch zoom & two-finger pan.
- Scoring & end-of-round screen per SPEC §2.3.

Use a hardcoded seed for now. No blockchain. No wallet. Deliverable: a
playable 5-hole round that works on a mobile viewport (test at 390x844).
```

### Phase 2

```
Phase 2 per SPEC.md §8.

- Install @solana/wallet-adapter-react, -react-ui, -wallets (Phantom, Solflare).
- Wrap app in WalletProvider; add connect button in header.
- Gate "Start Round" behind wallet connection.
- Show connected pubkey (truncated) and a mock $STARS balance (start at 1000).
- Add /api/start-session route that returns { seed: hex32, sessionPda: string }
  where seed is randomly generated server-side and sessionPda is a random string
  (this is a stub). Use the returned seed for level gen instead of hardcoded.
- On Start Round, decrement displayed balance by 50 $STARS (client state only).

No on-chain work yet. This phase just exercises the flow shape.
```

### Phase 3

```
Phase 3 per SPEC.md §6 and §8.

- Create programs/orbital-golf Anchor workspace.
- Implement GameConfig + GameSession accounts and these instructions:
  initialize_config, update_config, start_session. Match SPEC §6 exactly.
- start_session: transfer entry_fee from player ATA, split per burn_bps
  (send burn half to burn_address, rest to treasury_vault), create GameSession
  PDA with seed = sha256(recent_slot_hash || player.key || nonce). Use the
  SlotHashes sysvar.
- scripts/setup.ts: devnet one-shot that creates mock $STARS SPL mint, mints
  10_000 to a configurable test wallet, initializes the config with sensible
  defaults (entry_fee 50 * 10^6 assuming 6 decimals, burn_bps 5000, reward
  tiers per SPEC §2.4).
- Replace the /api/start-session stub: client now builds & sends a real
  start_session tx via the connected wallet, waits for confirmation, reads
  the session PDA, and uses its seed for level gen.

Deliverable: real devnet pay-to-play flow end to end, still no scoring
submission.
```

### Phase 4

```
Phase 4 per SPEC.md §5, §6, §8.

- apps/verifier: Fastify service. Import packages/engine (the SAME package
  the client uses — no divergence allowed).
- POST /verify takes GameSubmission (SPEC §4.5), loads the session PDA from
  chain, extracts seed, regenerates holes, replays all shots canonically,
  computes score, runs all validators from SPEC §5.1.
- On pass: sign { sessionPda, score, timestamp } with Ed25519 (nacl or
  @solana/web3.js Keypair.sign), return { signature, score, timestamp }.
  Store the attestor keypair in an env var (ATTESTOR_SECRET_KEY).
- Extend Anchor program with submit_score and claim_reward instructions
  per SPEC §6.2. submit_score uses the Ed25519 precompile; the player's tx
  must include an ed25519 program instruction before submit_score.
- Client: after round ends, record all shots, POST to verifier, build a
  tx that bundles the ed25519 verification ix + submit_score + claim_reward,
  sign and send.

Deliverable: full pay → play → verify → reward loop working on devnet.
```

### Phase 5

```
Phase 5 per SPEC.md §7, §8.

- Add mode field to start_session (0 = solo, 1 = daily). For mode 1, seed
  comes from daily_seed_root (not slot hash). Enforce one daily entry per
  wallet via DailyEntry PDA.
- rotate_daily_seed instruction: permissionless if current time >
  daily_seed_epoch + 86400; seed = sha256(recent_slot_hash || current_day).
- settle_daily_tournament(date, winners: Vec<Pubkey>): admin-only, distributes
  daily treasury pot to the top N winners (N = 10% of entries, min 1).
- Postgres table daily_submissions (wallet, date, score, session_pda,
  submitted_at). Write on successful submit_score for mode 1.
- GET /api/leaderboard/:date returns top 100 from DB.
- /tournament page: shows today's leaderboard, your rank, pool size,
  time-until-settlement.

Deliverable: full daily tournament loop, shareable leaderboard page.
```

---

## 10. Open Decisions

1. **Verifier tolerance.** Stick with strict integer-equality scoring (current plan) vs. allow ±1 stroke flex for edge-case drift? Current plan is strict.
2. **Leaderboard storage.** Postgres for speed (current plan) vs. fully on-chain for trust? Postgres + chain-settled pool is the pragmatic middle.
3. **Attestor key.** Single hot key on verifier vs. 2-of-3 multisig with rotation? Start single; rotate quarterly; upgrade to multisig if volume warrants.
4. **Free practice mode.** Give unconnected-wallet users 1 practice hole per session for discovery, or gate fully? Recommend: hole 1 playable unconnected, disables score submission.
5. **Rocket skins.** Mint new collection or gate on existing StarLaunch NFTs? Depends on existing IP — needs founder call.
6. **Mobile framework.** PWA-only (current plan) vs. Capacitor wrap for app stores? PWA is fine for v1; app stores care about crypto integrations which will require adjustments regardless.

---

## 11. Reference — Folder-Level Contract

What each package exports, so the client and verifier cannot drift:

**`packages/engine`**
```ts
export { PhysicsEngine } from './physics';       // the deterministic runner
export { generateHole, generateRound } from './levels';
export { scoreRound } from './scoring';
export { createSessionRng } from './rng';
export type { Hole, Shot, RoundResult, Vec2 } from './types';
```

**`packages/types`**
```ts
export type GameSubmission = { /* SPEC §4.5 */ };
export type Attestation = {
  sessionPda: string;
  score: number;
  timestamp: number;
  signature: string;  // base58 Ed25519 sig
};
```

If client and verifier both go through these exports and no one imports Matter.js directly outside of `packages/engine`, the determinism contract holds.
