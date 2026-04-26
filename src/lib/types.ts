// Shared types for the engine + UI.

export type Vec2 = { x: number; y: number };

export type Planet = {
  pos: Vec2;
  mass: number;
  radius: number;
  repulsive: boolean;
};

export type AsteroidObstacle = {
  type: 'asteroid';
  pos: Vec2;
  radius: number;
  spin: number;
  rot: number;
};

export type MovingObstacle = {
  type: 'moving';
  baseX: number;
  baseY: number;
  amplitude: number;
  periodMs: number;
  phase: number;
  radius: number;
};

export type Obstacle = AsteroidObstacle | MovingObstacle;

export type Hole = {
  index: number;
  start: Vec2;
  target: Vec2;
  targetRadius: number;
  planets: Planet[];
  obstacles: Obstacle[];
  par: number;
  bounds: { w: number; h: number };
  difficulty: string;
};

export type HoleResult = {
  completed: boolean;
  strokes: number;
  par: number;
  slingshot: boolean;
  points: number;
};

export type ShotOutcome = 'flying' | 'target' | 'bounds' | 'crash' | 'stall';

export type Phase = 'aiming' | 'flight' | 'between' | 'idle';

export type Screen = 'start' | 'lobby' | 'game' | 'end';

export type Sim = {
  hole: Hole;
  rocket: {
    pos: Vec2;
    vel: Vec2;
    alive: boolean;
    minPlanetProximity: number;
    flightTimeMs: number;
    trail: Vec2[];
  };
  elapsedMs: number;
  stallTimer: number;
};

export type Aim = { start: Vec2; current: Vec2 };

export type RewardTier = {
  name: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  minScore: number;
  mult: number;
  cls: 'bronze' | 'silver' | 'gold' | 'platinum';
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  born: number;
  color: string;
  alpha: number;
};

export type FlashMsg = { text: string; nonce: number; durMs: number };
