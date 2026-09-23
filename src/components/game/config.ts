/**
 * Neon Snake — shared configuration and data tables.
 *
 * Everything level/theme related lives here so the game component stays
 * focused on the engine: zones recolor the board every few levels, skins are
 * unlockable snake colors, and obstacles are generated deterministically per
 * level (same layout on respawn — fair and predictable).
 */

export const GRID = 21; // grid is 21×21 cells (odd → symmetric centre spawn)
export const CANVAS = 462; // logical canvas size in px (GRID × 22px cells)
export const CELL = CANVAS / GRID;

export const START_LIVES = 3;
export const MAX_LEVEL = 15;
export const LEVELS_PER_ZONE = 3; // 15 levels → 5 color zones
export const FOODS_PER_LEVEL = 6;
export const POINTS_FOOD = 10;
export const POINTS_BONUS = 40;

/** ms per step, indexed by level (level 1 → 170ms, level 15 → 52ms). */
export const LEVELS_SPEED_MS = [
  170, 158, 146, 135, 124, 114, 105, 97, 89, 82, 76, 70, 64, 58, 52,
];

export const POWERUP_INTERVAL = 9000; // ms between power-up spawns
export const POWERUP_LIFETIME = 7000; // ms a power-up stays on the board
export const GHOST_MS = 5000; // ghost (phase through everything) duration
export const SLOW_MS = 6000; // slow-motion duration
export const RESPAWN_MS = 900; // death pause before respawn / game over
export const MAX_PARTICLES = 80; // hard cap for the particle system

export type Pt = { x: number; y: number };
export type Dir = "up" | "down" | "left" | "right";
export type Phase = "start" | "playing" | "paused" | "dying" | "over" | "won";
export type PowerType = "bonus" | "slow" | "ghost" | "shrink";

export const DIR_V: Record<Dir, Pt> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
export const POWER_LETTER: Record<PowerType, string> = {
  bonus: "+",
  slow: "S",
  ghost: "G",
  shrink: "−",
};

/* ------------------------------------------------------------------ */
/*  Zones — the board recolors every LEVELS_PER_ZONE levels            */
/* ------------------------------------------------------------------ */

export type Zone = {
  name: string;
  bg: string; // board background
  dot: string; // dot-grid color
  wall: string; // obstacles + border
  food: string; // food discs
  accent: string; // highlights (ghost border, particles fallback)
};

export const ZONES: Zone[] = [
  {
    name: "Graphite",
    bg: "#0b0b0c",
    dot: "rgba(255,255,255,0.05)",
    wall: "rgba(255,255,255,0.28)",
    food: "#e4e4e7",
    accent: "#ffffff",
  },
  {
    name: "Signal Green",
    bg: "#071008",
    dot: "rgba(74,222,128,0.12)",
    wall: "rgba(74,222,128,0.45)",
    food: "#86efac",
    accent: "#4ade80",
  },
  {
    name: "Cyan Circuit",
    bg: "#061014",
    dot: "rgba(34,211,238,0.12)",
    wall: "rgba(34,211,238,0.45)",
    food: "#67e8f9",
    accent: "#22d3ee",
  },
  {
    name: "Magenta Drive",
    bg: "#120610",
    dot: "rgba(232,121,249,0.12)",
    wall: "rgba(232,121,249,0.45)",
    food: "#f0abfc",
    accent: "#e879f9",
  },
  {
    name: "Amber Core",
    bg: "#140c04",
    dot: "rgba(251,191,36,0.12)",
    wall: "rgba(251,191,36,0.45)",
    food: "#fcd34d",
    accent: "#fbbf24",
  },
];

export function zoneIndexForLevel(level: number): number {
  return Math.min(ZONES.length - 1, Math.floor((level - 1) / LEVELS_PER_ZONE));
}
export function zoneForLevel(level: number): Zone {
  return ZONES[zoneIndexForLevel(level)];
}

/* ------------------------------------------------------------------ */
/*  Skins — unlockable snake colors                                    */
/* ------------------------------------------------------------------ */

export type SkinUnlock =
  | { type: "free" }
  | { type: "level"; value: number }
  | { type: "score"; value: number }
  | { type: "achievement"; id: string };

export type Skin = {
  id: string;
  name: string;
  head: string; // solid head color
  body: string; // solid body color (rendered with an alpha fade)
  duo?: [string, string]; // two-color gradient body
  rainbow?: boolean; // animated hue-cycling body
  unlock: SkinUnlock;
};

export const SKINS: Skin[] = [
  { id: "mono", name: "Mono", head: "#ffffff", body: "#ffffff", unlock: { type: "free" } },
  { id: "graphite", name: "Graphite", head: "#d4d4d8", body: "#a1a1aa", unlock: { type: "free" } },
  { id: "acid", name: "Acid", head: "#a3e635", body: "#84cc16", unlock: { type: "level", value: 5 } },
  { id: "cyan", name: "Cyan", head: "#22d3ee", body: "#0891b2", unlock: { type: "score", value: 500 } },
  { id: "magenta", name: "Magenta", head: "#e879f9", body: "#c026d3", unlock: { type: "score", value: 1000 } },
  { id: "solar", name: "Solar", head: "#fbbf24", body: "#d97706", unlock: { type: "level", value: 10 } },
  {
    id: "inferno",
    name: "Inferno",
    head: "#f87171",
    body: "#fb923c",
    duo: ["#f87171", "#fbbf24"],
    unlock: { type: "achievement", id: "flawless" },
  },
  {
    id: "glacier",
    name: "Glacier",
    head: "#93c5fd",
    body: "#38bdf8",
    duo: ["#93c5fd", "#38bdf8"],
    unlock: { type: "achievement", id: "champion" },
  },
  {
    id: "vapor",
    name: "Vaporwave",
    head: "#f0abfc",
    body: "#67e8f9",
    duo: ["#f0abfc", "#67e8f9"],
    unlock: { type: "achievement", id: "zone-4" },
  },
  {
    id: "rainbow",
    name: "Rainbow",
    head: "#ffffff",
    body: "#ffffff",
    rainbow: true,
    unlock: { type: "score", value: 2000 },
  },
];

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** CSS background for a skin swatch (handles gradient skins). */
export function cssForSkin(s: Skin): string {
  if (s.rainbow) {
    return "linear-gradient(90deg,#f87171,#fbbf24,#a3e635,#22d3ee,#e879f9)";
  }
  if (s.duo) return `linear-gradient(135deg,${s.duo[0]},${s.duo[1]})`;
  return s.head;
}

export function unlockText(u: SkinUnlock): string {
  switch (u.type) {
    case "free":
      return "Available from the start";
    case "level":
      return `Reach level ${u.value}`;
    case "score":
      return `Score ${u.value.toLocaleString()} in one run`;
    case "achievement": {
      const a = ACHIEVEMENTS.find((x) => x.id === u.id);
      return a ? `Unlock “${a.name}”` : "Hidden achievement";
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Achievements                                                       */
/* ------------------------------------------------------------------ */

export type Achievement = { id: string; name: string; desc: string };

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-meal", name: "First Bite", desc: "Eat your first disc." },
  { id: "level-5", name: "Warming Up", desc: "Reach level 5." },
  { id: "zone-2", name: "Green Room", desc: "Enter the Signal Green zone." },
  { id: "zone-4", name: "Vaporwave", desc: "Enter the Magenta Drive zone." },
  { id: "score-500", name: "Half K", desc: "Score 500 in one run." },
  { id: "score-1500", name: "Neon Legend", desc: "Score 1,500 in one run." },
  { id: "collector", name: "Collector", desc: "Grab 4 power-ups in one run." },
  { id: "ghost-save", name: "Phase Shift", desc: "Wrap through a wall while ghosted." },
  { id: "flawless", name: "Untouchable", desc: "Clear 3 levels in a row without dying." },
  { id: "champion", name: "Champion", desc: "Clear all 15 levels." },
];

/* ------------------------------------------------------------------ */
/*  Seeded RNG + obstacle generation                                   */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG so each level's obstacle layout is stable per run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Obstacles for a level. None before level 3, then bar clusters plus
 * scattered singles that grow denser with level. Keeps the spawn corridor
 * and the outer lanes clear so layouts stay fair and food stays reachable.
 */
export function buildObstacles(level: number): Pt[] {
  if (level < 3) return [];
  const rng = mulberry32(level * 1013 + 7);
  const cx = Math.floor(GRID / 2);
  const cells: Pt[] = [];

  const has = (x: number, y: number) => cells.some((c) => c.x === x && c.y === y);
  const safe = (x: number, y: number) => {
    if (x < 2 || y < 2 || x > GRID - 3 || y > GRID - 3) return false; // clear outer lanes
    if (Math.abs(y - cx) <= 1 && x >= cx - 7 && x <= cx + 3) return false; // spawn corridor
    return true;
  };
  const put = (x: number, y: number) => {
    if (safe(x, y) && !has(x, y)) {
      cells.push({ x, y });
    }
  };

  // bar clusters — up to 6, length 2–4
  const bars = Math.min(6, Math.floor((level - 1) / 2));
  for (let b = 0; b < bars; b++) {
    const horiz = rng() > 0.5;
    const len = 2 + Math.floor(rng() * 3);
    const x0 = 2 + Math.floor(rng() * (GRID - 5));
    const y0 = 2 + Math.floor(rng() * (GRID - 5));
    for (let i = 0; i < len; i++) put(horiz ? x0 + i : x0, horiz ? y0 : y0 + i);
  }

  // scattered singles — grow with level, capped
  const singles = Math.min(10, level - 2);
  for (let s = 0; s < singles; s++) {
    put(2 + Math.floor(rng() * (GRID - 4)), 2 + Math.floor(rng() * (GRID - 4)));
  }

  return cells;
}

/* ------------------------------------------------------------------ */
/*  Color helpers                                                      */
/* ------------------------------------------------------------------ */

/** Linear interpolation between two #rrggbb colors (t ∈ 0..1). */
export function hexLerp(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}
