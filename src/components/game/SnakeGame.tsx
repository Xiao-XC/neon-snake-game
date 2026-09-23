/**
 * Neon Snake — a minimalist arcade snake game.
 *
 * Rendering: HTML5 <canvas>, fixed 21×21 logical grid, DPR-aware backing
 * store, requestAnimationFrame loop with a fixed-timestep simulation.
 *          The static layer (background, dot grid, obstacles) is prebaked to
 *          an offscreen canvas once per zone/level and blitted per frame —
 *          keeps the per-frame cost flat and the game smooth on mobile.
 * Input:   keyboard (arrows/WASD/Space/R/M/Enter) + touch swipe + on-screen
 *          d-pad on small screens.
 * Audio:   procedural WebAudio blips (no asset files), with mute toggle.
 * Storage: high score / best level / mute / reduced-fx / skins /
 *          achievements persisted in localStorage.
 * Visuals: near-monochrome minimalism theme with unlockable neon snake
 *          colors; the board recolors every 3 levels (5 color zones) and
 *          obstacles appear from level 3. Generated shapes only — no assets.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Info,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  ACHIEVEMENTS,
  CANVAS,
  CELL,
  COMBO_WINDOW_MS,
  comboMultiplier,
  DIR_V,
  FOODS_PER_LEVEL,
  GHOST_MS,
  GRID,
  LEVELS_SPEED_MS,
  MAX_LEVEL,
  MAX_PARTICLES,
  OPPOSITE,
  POINTS_BONUS,
  POINTS_FOOD,
  POWERUP_INTERVAL,
  POWERUP_LIFETIME,
  POWER_LETTER,
  RESPAWN_MS,
  RISK_DISC_CHANCE,
  RISK_FOOD_COLOR,
  RISK_POINTS,
  SKINS,
  SLOW_MS,
  SPEED_LABELS,
  START_LIVES,
  ZONES,
  buildObstacles,
  cssForSkin,
  hexLerp,
  skinById,
  unlockText,
  zoneForLevel,
  zoneIndexForLevel,
  type Achievement,
  type Dir,
  type Phase,
  type PowerType,
  type Pt,
  type Skin,
} from "./config";

/* ------------------------------------------------------------------ */
/*  Local types + storage keys                                         */
/* ------------------------------------------------------------------ */

const LS = {
  high: "neon-snake:high",
  bestLevel: "neon-snake:best-level",
  muted: "neon-snake:muted",
  fx: "neon-snake:reduced-fx",
  skin: "neon-snake:skin",
  ach: "neon-snake:achievements",
};

type PowerUp = { cell: Pt; type: PowerType; born: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number };

/* ------------------------------------------------------------------ */
/*  Tiny helpers                                                       */
/* ------------------------------------------------------------------ */

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}
function lsGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function randCell(): number {
  return Math.floor(Math.random() * GRID);
}

/** Rounded-rect path (used for the snake head). */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/*  Risk/reward disc placement                                         */
/* ------------------------------------------------------------------ */

const NEIGHBORS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Find a meaningfully risky free cell for a risk/reward disc: adjacent to an
 * obstacle, hugging a wall, or in a tight gap. Levels without obstacles fall
 * back to any free cell on the outer edge. Returns null when no risky spot
 * exists — the caller then spawns a normal disc instead.
 */
function pickRiskyCell(obstacles: Pt[], isFree: (x: number, y: number) => boolean): Pt | null {
  if (obstacles.length === 0) {
    const edge: Pt[] = [];
    for (let i = 0; i < GRID; i++) {
      const cands: Array<[number, number]> = [[i, 0], [i, GRID - 1], [0, i], [GRID - 1, i]];
      for (const [x, y] of cands) if (isFree(x, y)) edge.push({ x, y });
    }
    return edge.length > 0 ? edge[Math.floor(Math.random() * edge.length)] : null;
  }

  // score sampled free cells: wall proximity + obstacle adjacency + tight gaps
  let best: Pt | null = null;
  let bestScore = 0;
  for (let i = 0; i < 90; i++) {
    const x = randCell();
    const y = randCell();
    if (!isFree(x, y)) continue;
    const edge = Math.min(x, y, GRID - 1 - x, GRID - 1 - y);
    let score = edge === 0 ? 2 : edge === 1 ? 1 : 0;
    let freeN = 0;
    let obsN = 0;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      if (obstacles.some((o) => o.x === nx && o.y === ny)) obsN += 1;
      else freeN += 1;
    }
    score += obsN * 2;
    if (freeN <= 2) score += 1; // hemmed in on two sides
    if (score >= 1 && score > bestScore) {
      bestScore = score;
      best = { x, y };
      if (bestScore >= 4) break; // risky enough — stop sampling
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Procedural sound effects (WebAudio, no files)                      */
/* ------------------------------------------------------------------ */

class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private beep(freq: number, dur: number, type: OscillatorType, vol = 0.1, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  eat() {
    this.beep(620, 0.07, "square", 0.08);
    this.beep(930, 0.09, "square", 0.07, 0.05);
  }
  riskEat() {
    // distinct high-value arpeggio for risk/reward discs
    this.beep(740, 0.07, "square", 0.09);
    this.beep(1108, 0.07, "square", 0.09, 0.06);
    this.beep(1480, 0.14, "triangle", 0.1, 0.12);
  }
  power() {
    this.beep(523, 0.08, "triangle", 0.1);
    this.beep(659, 0.08, "triangle", 0.1, 0.07);
    this.beep(784, 0.12, "triangle", 0.1, 0.14);
  }
  levelUp() {
    this.beep(440, 0.1, "square", 0.08);
    this.beep(660, 0.1, "square", 0.08, 0.09);
    this.beep(880, 0.16, "square", 0.08, 0.18);
  }
  zone() {
    this.beep(392, 0.12, "triangle", 0.1);
    this.beep(523, 0.12, "triangle", 0.1, 0.1);
    this.beep(659, 0.12, "triangle", 0.1, 0.2);
    this.beep(784, 0.2, "triangle", 0.1, 0.3);
  }
  achievement() {
    this.beep(880, 0.09, "triangle", 0.09);
    this.beep(1175, 0.14, "triangle", 0.09, 0.09);
  }
  die() {
    this.beep(220, 0.16, "square", 0.12);
    this.beep(160, 0.18, "square", 0.12, 0.14);
    this.beep(110, 0.3, "square", 0.12, 0.3);
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.16, "triangle", 0.11, i * 0.13));
  }
}

/* ------------------------------------------------------------------ */
/*  Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

/** Micro stat pill used in the HUD row. */
function Pill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 border border-border bg-card/50 px-3 py-1.5">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}

/** Tiny keycap for the desktop control legend. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center border border-border bg-card/50 px-1.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}

/** Minimal generated board mark — 21×21 pixel grid as tiny rects. */
function BoardMark({ className = "h-6 w-6" }: { className?: string }) {
  const cells: Array<[number, number]> = [
    [10, 3], [10, 4], [10, 5], [10, 6], [10, 7],
    [11, 7], [12, 7], [13, 7],
    [4, 14], [5, 14], [6, 14], [7, 14], [8, 14], [9, 14], [10, 14],
    [16, 5], [16, 6], [16, 7], [16, 8], [16, 9],
  ];
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden="true">
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
      <circle cx="16.5" cy="15.5" r="0.6" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

/** Shared overlay shell for start / pause / over / win / help screens. */
function Overlay({
  children,
  label,
  wide,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-10 flex items-center justify-center bg-background/90 backdrop-blur-[2px]"
      role="dialog"
      aria-label={label}
    >
      <div className={`w-full px-6 text-center ${wide ? "max-w-sm" : "max-w-xs"}`}>{children}</div>
    </motion.div>
  );
}

/** Big minimal CTA button used on overlays. */
function OverlayButton({
  children,
  onClick,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "solid" | "ghost";
}) {
  return (
    <button
      onClick={onClick}
      className={
        variant === "solid"
          ? "w-full bg-foreground px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-background transition-opacity hover:opacity-80"
          : "w-full border border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] transition-colors hover:bg-accent"
      }
    >
      {children}
    </button>
  );
}

/** Square icon button for the header controls. */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center border border-border text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function SnakeGame() {
  const navigate = useNavigate();

  /* ---------- mutable game state (refs — never trigger re-render) ---------- */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null); // prebaked board layer
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const snake = useRef<Pt[]>([]);
  const obstacles = useRef<Pt[]>([]);
  const dir = useRef<Dir>("right");
  const queued = useRef<Dir[]>([]);
  const food = useRef<Pt>({ x: 0, y: 0 });
  const power = useRef<PowerUp | null>(null);
  const timers = useRef({ ghostUntil: 0, slowUntil: 0, nextPowerAt: 0 });
  const particles = useRef<Particle[]>([]);
  const shake = useRef(0);
  const stepAcc = useRef(0);
  const lastT = useRef(0);
  const raf = useRef(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(START_LIVES);
  const levelRef = useRef(1);
  const eatenRef = useRef(0);
  const comboRef = useRef(0); // consecutive in-window disc eats
  const comboExpireRef = useRef(0); // wall-clock ms timestamp of window end
  const comboPulse = useRef(0); // increments to retrigger the HUD pulse
  const isRiskDisc = useRef(false); // current food is a risk/reward disc
  const phaseRef = useRef<Phase>("start");
  const fxRef = useRef(false); // true → reduced motion
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const sfx = useRef<Sfx | null>(null);
  const skinRef = useRef<Skin>(skinById(lsGet(LS.skin) ?? "mono"));
  const zoneIdxRef = useRef(0);
  const powersTaken = useRef(0);
  const flawlessStreak = useRef(0);
  const diedThisLevel = useRef(false);
  const lastGhostShown = useRef(0);
  const lastSlowShown = useRef(0);
  const achRef = useRef<Set<string>>(new Set(lsGetJSON<string[]>(LS.ach, [])));

  /* ---------- reactive state (only what the HUD/overlays show) ---------- */
  const [phase, setPhaseState] = useState<Phase>("start");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [level, setLevel] = useState(1);
  const [high, setHigh] = useState(() => Number(lsGet(LS.high) ?? 0));
  const [bestLevel, setBestLevel] = useState(() => Number(lsGet(LS.bestLevel) ?? 1));
  const [muted, setMuted] = useState(() => lsGet(LS.muted) === "1");
  const [reducedFx, setReducedFx] = useState(() => lsGet(LS.fx) === "1");
  const [skinId, setSkinId] = useState(() => lsGet(LS.skin) ?? "mono");
  const [unlocked, setUnlocked] = useState<string[]>(() => [...achRef.current]);
  const [ghostSecs, setGhostSecs] = useState(0);
  const [slowSecs, setSlowSecs] = useState(0);
  const [combo, setCombo] = useState<{ n: number; mult: number; pulse: number } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showSkins, setShowSkins] = useState(false);
  const [showAch, setShowAch] = useState(false);
  const [skinHint, setSkinHint] = useState<string | null>(null);
  const [zoneBanner, setZoneBanner] = useState<string | null>(null);
  const [achToast, setAchToast] = useState<Achievement | null>(null);
  const [zoneIdx, setZoneIdx] = useState(0);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  /* lazily construct Sfx on first client render + seed the static board */
  useEffect(() => {
    sfx.current = new Sfx();
    sfx.current.muted = muted;
    fxRef.current = reducedFx;
    const cx = Math.floor(GRID / 2);
    snake.current = [
      { x: cx - 1, y: cx },
      { x: cx - 2, y: cx },
      { x: cx - 3, y: cx },
    ];
    obstacles.current = buildObstacles(1);
    spawnFood();
    bakeStatic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sfx.current) sfx.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    fxRef.current = reducedFx;
  }, [reducedFx]);

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      const v = !m;
      lsSet(LS.muted, v ? "1" : "0");
      return v;
    });
  }, []);

  const toggleReducedFx = useCallback(() => {
    setReducedFx((r) => {
      const v = !r;
      lsSet(LS.fx, v ? "1" : "0");
      return v;
    });
  }, []);

  /* ---------- achievements ---------- */

  const unlock = useCallback((id: string) => {
    if (achRef.current.has(id)) return;
    achRef.current.add(id);
    lsSet(LS.ach, JSON.stringify([...achRef.current]));
    setUnlocked([...achRef.current]);
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) {
      setAchToast(a);
      // auto-dismiss the unlock toast
      window.setTimeout(() => setAchToast(null), 2800);
    }
    sfx.current?.achievement();
  }, []);

  /* ---------- score + skins ---------- */

  /** Add points; keep the high score live-updated and persisted. */
  const addScore = useCallback(
    (n: number) => {
      scoreRef.current += n;
      setScore(scoreRef.current);
      if (scoreRef.current >= 500) unlock("score-500");
      if (scoreRef.current >= 1500) unlock("score-1500");
      setHigh((h) => {
        if (scoreRef.current > h) {
          lsSet(LS.high, String(scoreRef.current));
          return scoreRef.current;
        }
        return h;
      });
    },
    [unlock],
  );

  function isSkinUnlocked(s: Skin): { ok: boolean; hint: string } {
    const u = s.unlock;
    switch (u.type) {
      case "free":
        return { ok: true, hint: "" };
      case "level":
        return {
          ok: bestLevel >= u.value,
          hint: `Reach level ${u.value} — best so far: ${bestLevel}`,
        };
      case "score":
        return {
          ok: high >= u.value,
          hint: `Score ${u.value.toLocaleString()} in one run — best: ${high.toLocaleString()}`,
        };
      case "achievement": {
        const a = ACHIEVEMENTS.find((x) => x.id === u.id);
        return { ok: achRef.current.has(u.id), hint: a ? unlockText(u) : "" };
      }
    }
  }

  const isSkinUnlockedStable = useCallback(isSkinUnlocked, [bestLevel, high, unlocked]);

  const pickSkin = useCallback(
    (s: Skin) => {
      if (!isSkinUnlocked(s).ok) {
        setSkinHint(unlockText(s.unlock));
        return;
      }
      setSkinId(s.id);
      skinRef.current = s;
      lsSet(LS.skin, s.id);
      setSkinHint(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [high, bestLevel, unlocked],
  );

  const unlockedSkinCount = useMemo(
    () => SKINS.filter((s) => isSkinUnlockedStable(s).ok).length,
    [isSkinUnlockedStable],
  );

  /* ---------- static layer (background + dots + obstacles) ---------- */

  /** Rebuild the prebaked board layer for the current level's zone + obstacles. */
  const bakeStatic = useCallback(() => {
    let c = staticRef.current;
    if (!c) {
      c = document.createElement("canvas");
      staticRef.current = c;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = CANVAS * dpr;
    c.height = CANVAS * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const z = zoneForLevel(levelRef.current);
    ctx.fillStyle = z.bg;
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    ctx.fillStyle = z.dot;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        ctx.fillRect(x * CELL + CELL / 2 - 1, y * CELL + CELL / 2 - 1, 2, 2);
      }
    }
    ctx.fillStyle = z.wall;
    for (const o of obstacles.current) {
      ctx.fillRect(o.x * CELL + 2, o.y * CELL + 2, CELL - 4, CELL - 4);
    }
  }, []);

  /* ---------- spawning ---------- */

  const spawnFood = useCallback(() => {
    const taken = new Set(snake.current.map((p) => `${p.x},${p.y}`));
    for (const o of obstacles.current) taken.add(`${o.x},${o.y}`);
    if (power.current) taken.add(`${power.current.cell.x},${power.current.cell.y}`);
    const isFree = (x: number, y: number) => !taken.has(`${x},${y}`);
    const randomFree = (): Pt => {
      let x = 0;
      let y = 0;
      do {
        x = randCell();
        y = randCell();
      } while (!isFree(x, y));
      return { x, y };
    };

    // ~1 in 4–5 spawns is a risk/reward disc placed somewhere dangerous;
    // downgrade to a normal disc when no risky spot is available
    let cell: Pt | null = null;
    let risk = Math.random() < RISK_DISC_CHANCE;
    if (risk) {
      cell = pickRiskyCell(obstacles.current, isFree);
      risk = cell !== null;
    }
    food.current = cell ?? randomFree();
    isRiskDisc.current = risk;
  }, []);

  const spawnPower = useCallback(() => {
    const taken = new Set(snake.current.map((p) => `${p.x},${p.y}`));
    for (const o of obstacles.current) taken.add(`${o.x},${o.y}`);
    taken.add(`${food.current.x},${food.current.y}`);
    let x = 0;
    let y = 0;
    do {
      x = randCell();
      y = randCell();
    } while (taken.has(`${x},${y}`));
    const types: PowerType[] = ["bonus", "slow", "ghost", "shrink"];
    const type = types[Math.floor(Math.random() * types.length)];
    power.current = { cell: { x, y }, type, born: performance.now() };
  }, []);

  /** Particle burst at a logical board position. */
  const burst = useCallback((x: number, y: number, count: number) => {
    if (fxRef.current) return;
    if (particles.current.length > MAX_PARTICLES) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 110;
      particles.current.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.4,
        max: 0.8,
      });
    }
    if (particles.current.length > MAX_PARTICLES) {
      particles.current = particles.current.slice(-MAX_PARTICLES);
    }
  }, []);

  /* ---------- power-up pickup ---------- */

  const applyPower = useCallback(
    (type: PowerType) => {
      const now = performance.now();
      powersTaken.current += 1;
      if (powersTaken.current >= 4) unlock("collector");
      switch (type) {
        case "bonus":
          addScore(POINTS_BONUS);
          break;
        case "slow":
          timers.current.slowUntil = now + SLOW_MS;
          setSlowSecs(Math.ceil(SLOW_MS / 1000));
          break;
        case "ghost":
          timers.current.ghostUntil = now + GHOST_MS;
          setGhostSecs(Math.ceil(GHOST_MS / 1000));
          break;
        case "shrink": {
          const keep = Math.max(3, Math.floor(snake.current.length / 2));
          snake.current = snake.current.slice(0, keep);
          break;
        }
      }
      sfx.current?.power();
    },
    [addScore, unlock],
  );

  /* ---------- lifecycle: reset / death / win ---------- */

  const resetRun = useCallback(() => {
    const cx = Math.floor(GRID / 2);
    snake.current = [
      { x: cx - 1, y: cx },
      { x: cx - 2, y: cx },
      { x: cx - 3, y: cx },
    ];
    dir.current = "right";
    queued.current = [];
    scoreRef.current = 0;
    setScore(0);
    livesRef.current = START_LIVES;
    setLives(START_LIVES);
    levelRef.current = 1;
    setLevel(1);
    eatenRef.current = 0;
    powersTaken.current = 0;
    flawlessStreak.current = 0;
    diedThisLevel.current = false;
    obstacles.current = buildObstacles(1);
    timers.current = {
      ghostUntil: 0,
      slowUntil: 0,
      nextPowerAt: performance.now() + POWERUP_INTERVAL,
    };
    power.current = null;
    particles.current = [];
    shake.current = 0;
    stepAcc.current = 0;
    zoneIdxRef.current = 0;
    setZoneIdx(0);
    setGhostSecs(0);
    setSlowSecs(0);
    comboRef.current = 0;
    comboExpireRef.current = 0;
    setCombo(null);
    bakeStatic();
    spawnFood();
  }, [bakeStatic, spawnFood]);

  const beginGame = useCallback(() => {
    resetRun();
    setPhase("playing");
  }, [resetRun, setPhase]);

  const respawn = useCallback(() => {
    const cx = Math.floor(GRID / 2);
    snake.current = [
      { x: cx - 1, y: cx },
      { x: cx - 2, y: cx },
      { x: cx - 3, y: cx },
    ];
    dir.current = "right";
    queued.current = [];
    power.current = null;
    timers.current.ghostUntil = 0;
    timers.current.slowUntil = 0;
    obstacles.current = buildObstacles(levelRef.current); // same seed → same layout
    setGhostSecs(0);
    setSlowSecs(0);
    stepAcc.current = 0;
    bakeStatic();
    spawnFood();
    setPhase("playing");
  }, [bakeStatic, spawnFood, setPhase]);

  /** Death sequence: burst, shake, pause, then respawn or game over. */
  const die = useCallback(() => {
    setPhase("dying");
    sfx.current?.die();
    diedThisLevel.current = true;
    flawlessStreak.current = 0;
    // dying always breaks the combo
    comboRef.current = 0;
    setCombo(null);
    const head = snake.current[0];
    burst((head.x + 0.5) * CELL, (head.y + 0.5) * CELL, 20);
    if (!fxRef.current) shake.current = 10;
    window.setTimeout(() => {
      if (phaseRef.current !== "dying") return; // user restarted meanwhile
      livesRef.current -= 1;
      setLives(livesRef.current);
      if (livesRef.current <= 0) {
        setPhase("over");
      } else {
        respawn();
      }
    }, RESPAWN_MS);
  }, [burst, respawn, setPhase]);

  const winGame = useCallback(() => {
    setPhase("won");
    comboRef.current = 0;
    setCombo(null);
    unlock("champion");
    sfx.current?.win();
  }, [setPhase, unlock]);

  /* ---------- level progression ---------- */

  /** Advance to the next level: rebuild obstacles, recolor zone, celebrate. */
  const advanceLevel = useCallback(() => {
    eatenRef.current = 0;
    levelRef.current += 1;
    setLevel(levelRef.current);
    const lvl = levelRef.current;
    if (lvl > bestLevel) {
      setBestLevel(lvl);
      lsSet(LS.bestLevel, String(lvl));
    }
    if (lvl >= 5) unlock("level-5");
    if (!diedThisLevel.current) {
      flawlessStreak.current += 1;
      if (flawlessStreak.current >= 3) unlock("flawless");
    } else {
      flawlessStreak.current = 0;
    }
    diedThisLevel.current = false;
    obstacles.current = buildObstacles(lvl);

    const zi = zoneIndexForLevel(lvl);
    const zoneChanged = zi !== zoneIdxRef.current;
    if (zoneChanged) {
      zoneIdxRef.current = zi;
      setZoneIdx(zi);
      const z = zoneForLevel(lvl);
      setZoneBanner(z.name);
      window.setTimeout(() => setZoneBanner(null), 1900);
      if (zi >= 1) unlock("zone-2");
      if (zi >= 3) unlock("zone-4");
      sfx.current?.zone();
    } else {
      sfx.current?.levelUp();
    }
    bakeStatic();
  }, [bakeStatic, bestLevel, unlock]);

  /* ---------- one simulation step (fixed timestep) ---------- */

  const step = useCallback(() => {
    const s = snake.current;

    // consume one buffered direction (blocks 180° reversals)
    while (queued.current.length > 0) {
      const nd = queued.current.shift()!;
      if (nd !== dir.current && nd !== OPPOSITE[dir.current]) {
        dir.current = nd;
        break;
      }
    }

    const v = DIR_V[dir.current];
    let hx = s[0].x + v.x;
    let hy = s[0].y + v.y;
    const ghost = performance.now() < timers.current.ghostUntil;
    const out = hx < 0 || hy < 0 || hx >= GRID || hy >= GRID;

    if (out && !ghost) {
      die();
      return;
    }
    if (out) {
      hx = (hx + GRID) % GRID; // ghost mode wraps through walls
      hy = (hy + GRID) % GRID;
      unlock("ghost-save");
    }

    // obstacle collision (ghost phases through)
    if (!ghost && obstacles.current.some((o) => o.x === hx && o.y === hy)) {
      die();
      return;
    }

    // self collision (ignore the tail cell — it moves away this step)
    // ghost mode also phases through the body, per the power's promise
    if (!ghost) {
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i].x === hx && s[i].y === hy) {
          die();
          return;
        }
      }
    }

    s.unshift({ x: hx, y: hy });

    // food — the combo window is wall-clock based; ghost/slow never pause it
    if (hx === food.current.x && hy === food.current.y) {
      const nowMs = performance.now();
      comboRef.current = nowMs <= comboExpireRef.current ? comboRef.current + 1 : 1;
      comboExpireRef.current = nowMs + COMBO_WINDOW_MS;
      const mult = comboMultiplier(comboRef.current);
      comboPulse.current += 1;
      setCombo({ n: comboRef.current, mult, pulse: comboPulse.current });
      addScore((isRiskDisc.current ? RISK_POINTS : POINTS_FOOD) * mult);
      eatenRef.current += 1;
      if (isRiskDisc.current) sfx.current?.riskEat();
      else sfx.current?.eat();
      burst((hx + 0.5) * CELL, (hy + 0.5) * CELL, 8);
      unlock("first-meal");
      if (eatenRef.current >= FOODS_PER_LEVEL) {
        if (levelRef.current >= MAX_LEVEL) {
          winGame();
          return;
        }
        advanceLevel();
      }
      spawnFood();
    } else {
      s.pop(); // no growth → tail moves
    }

    // power-up pickup
    if (power.current && power.current.cell.x === hx && power.current.cell.y === hy) {
      const type = power.current.type;
      power.current = null;
      timers.current.nextPowerAt = performance.now() + POWERUP_INTERVAL;
      applyPower(type);
    }
  }, [addScore, advanceLevel, applyPower, burst, die, spawnFood, unlock, winGame]);

  /* ---------- frame render ---------- */

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const stat = staticRef.current;
    if (!canvas || !ctx || !stat) return;
    const now = performance.now();
    const s = snake.current;
    if (s.length === 0) return; // nothing seeded yet (first frames)
    const ghost = now < timers.current.ghostUntil;
    const z = zoneForLevel(levelRef.current);
    const skin = skinRef.current;

    ctx.clearRect(0, 0, CANVAS, CANVAS);

    // subtle screen shake on death
    ctx.save();
    if (shake.current > 0 && !fxRef.current) {
      const d = shake.current / 10;
      ctx.translate((Math.random() - 0.5) * d * 6, (Math.random() - 0.5) * d * 6);
    }

    // prebaked static layer: background, dot grid, obstacles
    ctx.drawImage(stat, 0, 0, CANVAS, CANVAS);

    // food — pulsing disc in the zone color; risk discs glow rose, faster
    const fx = (food.current.x + 0.5) * CELL;
    const fy = (food.current.y + 0.5) * CELL;
    if (isRiskDisc.current) {
      const pulse = 0.9 + 0.18 * Math.sin(now / 90);
      ctx.fillStyle = RISK_FOOD_COLOR;
      ctx.globalAlpha = 0.22 + 0.14 * Math.sin(now / 90);
      ctx.beginPath();
      ctx.arc(fx, fy, CELL * 0.52 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(fx, fy, CELL * 0.3 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = RISK_FOOD_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(fx, fy, CELL * 0.44, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const pulse = 0.85 + 0.15 * Math.sin(now / 180);
      ctx.fillStyle = z.food;
      ctx.beginPath();
      ctx.arc(fx, fy, CELL * 0.26 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // power-up — lettered disc in the zone accent, blinks before expiring
    if (power.current) {
      const { cell: c, type, born } = power.current;
      const age = now - born;
      const blink = age > POWERUP_LIFETIME - 2000 ? (Math.sin(now / 80) + 1) / 2 : 1;
      ctx.globalAlpha = 0.55 + 0.45 * blink;
      ctx.fillStyle = z.accent;
      ctx.beginPath();
      ctx.arc((c.x + 0.5) * CELL, (c.y + 0.5) * CELL, CELL * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#0b0b0c";
      ctx.font = `bold ${Math.floor(CELL * 0.62)}px ui-monospace, SFMono-Regular, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWER_LETTER[type], (c.x + 0.5) * CELL, (c.y + 0.5) * CELL + 1);
    }

    // snake body — selected skin, fading toward the tail
    for (let i = s.length - 1; i >= 1; i--) {
      const seg = s[i];
      const t = i / Math.max(1, s.length - 1);
      let color = skin.body;
      if (skin.rainbow) {
        color = `hsl(${(t * 360 + (now / 12) * 360) % 360} 90% 62%)`;
      } else if (skin.duo) {
        color = hexLerp(skin.duo[0], skin.duo[1], t);
      }
      ctx.globalAlpha = (ghost ? 0.5 : 0.78) * (0.35 + 0.65 * (1 - t));
      ctx.fillStyle = color;
      ctx.fillRect(seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4);
    }
    ctx.globalAlpha = 1;

    // ghost-mode wrap hint: soft border glow while active
    if (ghost) {
      ctx.strokeStyle = `${z.accent}55`;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, CANVAS - 4, CANVAS - 4);
    }

    // head — always solid
    ctx.fillStyle = skin.head;
    roundRect(ctx, s[0].x * CELL + 1, s[0].y * CELL + 1, CELL - 2, CELL - 2, 5);

    // particles
    ctx.fillStyle = z.accent;
    for (const p of particles.current) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // hairline board border in the zone wall color
    ctx.strokeStyle = z.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CANVAS - 1, CANVAS - 1);

    ctx.restore();
  }, []);

  /* ---------- main loop: fixed-timestep sim + per-frame render ---------- */

  /* Keep stable refs to the latest step/render so the loop subscribes once. */
  const stepRef = useRef(step);
  const renderRef = useRef(render);
  stepRef.current = step;
  renderRef.current = render;

  useEffect(() => {
    let cancelled = false;

    const loop = (t: number) => {
      if (cancelled) return;
      const dt = Math.min(50, t - lastT.current);
      lastT.current = t;

      // decay visual effects regardless of phase
      if (shake.current > 0) shake.current -= 1;
      if (particles.current.length > 0) {
        for (const p of particles.current) {
          p.x += (p.vx * dt) / 1000;
          p.y += (p.vy * dt) / 1000;
          p.life -= dt / 1000;
        }
        particles.current = particles.current.filter((p) => p.life > 0);
      }

      if (phaseRef.current === "playing") {
        const now = performance.now();

        // combo expiry — wall-clock only; ghost/slow never pause or extend it
        if (comboRef.current > 0 && now > comboExpireRef.current) {
          comboRef.current = 0;
          setCombo(null);
        }

        // schedule / expire power-ups
        if (!power.current && now >= timers.current.nextPowerAt) {
          spawnPower();
        }
        if (power.current && now - power.current.born > POWERUP_LIFETIME) {
          power.current = null;
          timers.current.nextPowerAt = now + POWERUP_INTERVAL;
        }

        // fixed-timestep stepping, slowed while slow-power is active
        const base = LEVELS_SPEED_MS[Math.min(levelRef.current - 1, LEVELS_SPEED_MS.length - 1)];
        const interval = now < timers.current.slowUntil ? base * 1.65 : base;
        stepAcc.current += dt;
        let guard = 0;
        while (stepAcc.current >= interval && phaseRef.current === "playing" && guard < 4) {
          stepAcc.current -= interval;
          guard += 1;
          stepRef.current();
        }

        // expire timed powers (HUD countdown — only touch state on change)
        const gLeft = timers.current.ghostUntil > now ? Math.ceil((timers.current.ghostUntil - now) / 1000) : 0;
        const sLeft = timers.current.slowUntil > now ? Math.ceil((timers.current.slowUntil - now) / 1000) : 0;
        if (gLeft !== lastGhostShown.current) {
          lastGhostShown.current = gLeft;
          setGhostSecs(gLeft);
        }
        if (sLeft !== lastSlowShown.current) {
          lastSlowShown.current = sLeft;
          setSlowSecs(sLeft);
        }
      }

      renderRef.current();
      raf.current = requestAnimationFrame(loop);
    };

    raf.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf.current);
    };
  }, [spawnPower]);

  /* ---------- DPR-aware canvas backing store ---------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = CANVAS * dpr;
      canvas.height = CANVAS * dpr;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  /* ---------- input: direction queue ---------- */

  const queueDir = useCallback((d: Dir) => {
    const last = queued.current.length > 0 ? queued.current[queued.current.length - 1] : dir.current;
    if (d === last || d === OPPOSITE[last]) return;
    if (queued.current.length < 3) queued.current.push(d);
  }, []);

  const togglePause = useCallback(() => {
    if (phaseRef.current === "playing") setPhase("paused");
    else if (phaseRef.current === "paused") setPhase("playing");
  }, [setPhase]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) e.preventDefault();

      if (k === "ArrowUp" || k === "w" || k === "W") queueDir("up");
      else if (k === "ArrowDown" || k === "s" || k === "S") queueDir("down");
      else if (k === "ArrowLeft" || k === "a" || k === "A") queueDir("left");
      else if (k === "ArrowRight" || k === "d" || k === "D") queueDir("right");
      else if (k === " ") togglePause();
      else if (k === "m" || k === "M") toggleMuted();
      else if (k === "Escape") {
        if (showHelp) setShowHelp(false);
        else if (showSkins) setShowSkins(false);
        else if (showAch) setShowAch(false);
        else if (phaseRef.current === "playing") setPhase("paused");
      } else if (k === "Enter" || k === "r" || k === "R") {
        if (phaseRef.current !== "dying") beginGame();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beginGame, queueDir, setPhase, showAch, showHelp, showSkins, toggleMuted, togglePause]);

  /* ---------- auto-pause when the tab is hidden ---------- */

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && phaseRef.current === "playing") setPhase("paused");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [setPhase]);

  /* ---------- touch: swipe anywhere on the board ---------- */

  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      swipe.current = { x: t.clientX, y: t.clientY };
    };
    const onMove = (e: TouchEvent) => {
      if (!swipe.current) return;
      const t = e.touches[0];
      const dx = t.clientX - swipe.current.x;
      const dy = t.clientY - swipe.current.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      queueDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
      swipe.current = null;
      e.preventDefault();
    };
    const onEnd = () => {
      swipe.current = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [queueDir]);

  /* ---------- derived UI ---------- */

  const playing = phase === "playing";
  const zone = ZONES[zoneIdx];
  const speedLabel = SPEED_LABELS[level - 1] ?? "";

  /* ---------- render ---------- */

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── header ─────────────────────────────────────────────── */}
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <IconButton label="Back to home" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </IconButton>
            <span style={{ color: zone.accent }}>
              <BoardMark className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-semibold leading-none tracking-tight">Neon Snake</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {zone.name} zone
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconButton label="How to play" onClick={() => setShowHelp(true)}>
              <Info className="h-4 w-4" />
            </IconButton>
            <IconButton label="Achievements" onClick={() => setShowAch(true)}>
              <Trophy className="h-4 w-4" />
            </IconButton>
            <IconButton label={muted ? "Unmute" : "Mute"} onClick={toggleMuted}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </IconButton>
            <IconButton
              label={playing ? "Pause" : "Resume"}
              onClick={togglePause}
              disabled={!playing && phase !== "paused"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </IconButton>
            <IconButton
              label="Restart"
              onClick={beginGame}
              disabled={phase === "start" || phase === "dying"}
            >
              <RotateCcw className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </header>

      {/* ── HUD ────────────────────────────────────────────────── */}
      <section className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill label="Score" value={score.toLocaleString()} />
            <Pill label="High" value={high.toLocaleString()} />
            <Pill label="Level" value={`${level}/${MAX_LEVEL}`} />
            <Pill label="Lives" value={"●".repeat(lives) || "—"} />
          </div>
          <div className="flex items-center gap-2">
            <AnimatePresence>
              {combo && (
                <motion.span
                  key="combo"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="border border-border bg-card/50 px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground"
                >
                  <motion.span
                    key={combo.pulse}
                    initial={{ scale: 1.4 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="inline-block text-foreground"
                  >
                    {combo.n} COMBO
                  </motion.span>
                  {combo.mult > 1 && <span style={{ color: zone.accent }}> ×{combo.mult}</span>}
                </motion.span>
              )}
            </AnimatePresence>
            {ghostSecs > 0 && (
              <span className="border border-border bg-card/50 px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                GHOST {ghostSecs}s
              </span>
            )}
            {slowSecs > 0 && (
              <span className="border border-border bg-card/50 px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                SLOW {slowSecs}s
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── board ──────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col items-center px-4 py-6">
        <div ref={boardWrapRef} className="w-full max-w-[462px]">
          <div
            className="relative aspect-square w-full border transition-colors duration-500"
            style={{ borderColor: zone.wall }}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full touch-none select-none"
              aria-label="Snake game board"
              role="img"
            />

            {/* zone-change banner */}
            <AnimatePresence>
              {zoneBanner && (
                <motion.div
                  key="zone"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
                >
                  <div className="text-center">
                    <p
                      className="text-[10px] uppercase tracking-[0.3em]"
                      style={{ color: zone.accent }}
                    >
                      Zone {zoneIdx + 1} of {ZONES.length}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{zoneBanner}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* achievement toast */}
            <AnimatePresence>
              {achToast && (
                <motion.div
                  key={achToast.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="absolute left-1/2 top-3 z-20 -translate-x-1/2 border border-border bg-background/95 px-4 py-2.5 shadow-sm"
                >
                  <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    <Trophy className="h-3.5 w-3.5" style={{ color: zone.accent }} />
                    Achievement
                  </p>
                  <p className="mt-1 text-sm font-semibold">{achToast.name}</p>
                  <p className="text-[11px] text-muted-foreground">{achToast.desc}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {/* start */}
              {phase === "start" && !showHelp && !showSkins && !showAch && (
                <Overlay label="Start screen">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Ready</p>
                  <h1 className="mt-3 text-3xl font-semibold tracking-tight">Neon Snake</h1>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    Eat. Grow. Clear {MAX_LEVEL} levels across {ZONES.length} color zones. Grab
                    power-ups, dodge obstacles — and don&apos;t touch the walls, or yourself.
                  </p>
                  <div className="mt-6 space-y-2">
                    <OverlayButton onClick={beginGame}>Start game</OverlayButton>
                    <OverlayButton variant="ghost" onClick={() => setShowSkins(true)}>
                      Snake colors
                    </OverlayButton>
                    <OverlayButton variant="ghost" onClick={() => setShowHelp(true)}>
                      How to play
                    </OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* paused */}
              {phase === "paused" && !showHelp && !showSkins && !showAch && (
                <Overlay label="Paused">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Paused</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">Take a breath</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Score {score.toLocaleString()} · Level {level}
                  </p>
                  <div className="mt-6 space-y-2">
                    <OverlayButton onClick={togglePause}>Resume</OverlayButton>
                    <OverlayButton variant="ghost" onClick={() => setShowSkins(true)}>
                      Snake colors
                    </OverlayButton>
                    <OverlayButton variant="ghost" onClick={beginGame}>
                      Restart
                    </OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* game over */}
              {phase === "over" && !showHelp && !showSkins && !showAch && (
                <Overlay label="Game over">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Game over
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">Out of lives</h2>
                  <dl className="mx-auto mt-5 grid w-44 grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-left text-muted-foreground">Score</dt>
                    <dd className="text-right font-mono tabular-nums">{score.toLocaleString()}</dd>
                    <dt className="text-left text-muted-foreground">Level</dt>
                    <dd className="text-right font-mono tabular-nums">{level}</dd>
                    <dt className="text-left text-muted-foreground">High</dt>
                    <dd className="text-right font-mono tabular-nums">{high.toLocaleString()}</dd>
                  </dl>
                  <div className="mt-6 space-y-2">
                    <OverlayButton onClick={beginGame}>Play again</OverlayButton>
                    <OverlayButton variant="ghost" onClick={() => setShowAch(true)}>
                      Achievements
                    </OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* win */}
              {phase === "won" && !showHelp && !showSkins && !showAch && (
                <Overlay label="You win">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Cleared
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">All {MAX_LEVEL} levels</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Flawless run through every zone.
                  </p>
                  <dl className="mx-auto mt-5 grid w-44 grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-left text-muted-foreground">Score</dt>
                    <dd className="text-right font-mono tabular-nums">{score.toLocaleString()}</dd>
                    <dt className="text-left text-muted-foreground">High</dt>
                    <dd className="text-right font-mono tabular-nums">{high.toLocaleString()}</dd>
                  </dl>
                  <div className="mt-6 space-y-2">
                    <OverlayButton onClick={beginGame}>Play again</OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* instructions / help */}
              {showHelp && (
                <Overlay label="How to play" wide>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    How to play
                  </p>
                  <ul className="mt-4 space-y-2.5 text-left text-xs leading-relaxed text-muted-foreground">
                    <li>
                      <span className="text-foreground">Move</span> — arrow keys / WASD, or swipe the
                      board and use the pad on touch screens.
                    </li>
                    <li>
                      <span className="text-foreground">Pause</span> — Space (or Esc). Restart with R
                      or Enter.
                    </li>
                    <li>
                      <span className="text-foreground">Goal</span> — eat {FOODS_PER_LEVEL} discs to
                      clear each of {MAX_LEVEL} levels. Speed rises every level; obstacles appear
                      from level 3.
                    </li>
                    <li>
                      <span className="text-foreground">Zones</span> — every 3 levels the board
                      recolors: {ZONES.map((z) => z.name).join(" → ")}.
                    </li>
                    <li>
                      <span className="text-foreground">Lose</span> — hit a wall, an obstacle, or
                      your own body; three lives total.
                    </li>
                    <li>
                      <span className="text-foreground">Power-ups</span> —{" "}
                      <span className="font-mono text-foreground">+</span> bonus points,{" "}
                      <span className="font-mono text-foreground">S</span> slow motion,{" "}
                      <span className="font-mono text-foreground">G</span> ghost (wrap through
                      everything),{" "}
                      <span className="font-mono text-foreground">−</span> shrink your tail.
                    </li>
                    <li>
                      <span className="text-foreground">Combo</span> — eat again within 2.5s to
                      chain: ×2 at 3, ×3 at 6, ×4 at 10 consecutive discs.
                    </li>
                    <li>
                      <span className="text-foreground">Risk discs</span> — glowing rose discs
                      near obstacles and walls pay 5× points.
                    </li>
                    <li>
                      <span className="text-foreground">Colors</span> — snake skins unlock as you
                      score, level up, and win achievements.
                    </li>
                  </ul>
                  <div className="mt-6">
                    <OverlayButton onClick={() => setShowHelp(false)}>Back</OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* skin picker */}
              {showSkins && (
                <Overlay label="Snake colors" wide>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Snake colors
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">Pick your neon</h2>
                  <div className="mt-5 grid grid-cols-5 gap-2.5">
                    {SKINS.map((s) => {
                      const u = isSkinUnlockedStable(s);
                      const selected = skinId === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => pickSkin(s)}
                          title={u.ok ? s.name : unlockText(s.unlock)}
                          aria-label={u.ok ? s.name : `Locked: ${unlockText(s.unlock)}`}
                          aria-pressed={selected}
                          className={`relative flex h-11 w-full items-center justify-center border transition-opacity ${
                            selected ? "border-foreground" : "border-border"
                          } ${u.ok ? "hover:opacity-80" : "opacity-30"}`}
                          style={{ background: cssForSkin(s) }}
                        >
                          {!u.ok && <Lock className="h-3.5 w-3.5 text-background mix-blend-difference" />}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 min-h-8 text-[11px] leading-relaxed text-muted-foreground">
                    {skinHint ??
                      `${unlockedSkinCount} of ${SKINS.length} unlocked · gradients and rainbow skins are achievements`}
                  </p>
                  <div className="mt-3">
                    <OverlayButton onClick={() => setShowSkins(false)}>Back</OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* achievements list */}
              {showAch && (
                <Overlay label="Achievements" wide>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Achievements
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                    {unlocked.length} / {ACHIEVEMENTS.length}
                  </h2>
                  <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto pr-1 text-left">
                    {ACHIEVEMENTS.map((a) => {
                      const got = achRef.current.has(a.id);
                      return (
                        <li
                          key={a.id}
                          className={`border px-3 py-2 ${got ? "border-border" : "border-border/50 opacity-50"}`}
                        >
                          <p className="text-xs font-semibold">{got ? a.name : "· · ·"}</p>
                          <p className="text-[11px] text-muted-foreground">{a.desc}</p>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-4">
                    <OverlayButton onClick={() => setShowAch(false)}>Back</OverlayButton>
                  </div>
                </Overlay>
              )}
            </AnimatePresence>

            {/* subtle white flash while dying */}
            <div
              className={`pointer-events-none absolute inset-0 bg-foreground transition-opacity duration-200 ${
                phase === "dying" ? "opacity-[0.08]" : "opacity-0"
              }`}
            />
          </div>

          {/* level / speed / zone caption */}
          <p className="mt-3 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Level {level} · {speedLabel} · <span style={{ color: zone.accent }}>{zone.name}</span>
          </p>

          {/* touch d-pad (small screens) */}
          <div className="mx-auto mt-6 grid w-44 grid-cols-3 gap-1.5 md:hidden">
            <span />
            <TouchKey label="Up" onPress={() => queueDir("up")}>
              <ArrowUp className="h-4 w-4" />
            </TouchKey>
            <span />
            <TouchKey label="Left" onPress={() => queueDir("left")}>
              <ArrowLeft className="h-4 w-4" />
            </TouchKey>
            <TouchKey label="Down" onPress={() => queueDir("down")}>
              <ArrowDown className="h-4 w-4" />
            </TouchKey>
            <TouchKey label="Right" onPress={() => queueDir("right")}>
              <ArrowRight className="h-4 w-4" />
            </TouchKey>
          </div>

          {/* reduced-motion toggle */}
          <div className="mt-6 flex justify-center">
            <button
              onClick={toggleReducedFx}
              className="border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:bg-accent"
              aria-pressed={reducedFx}
            >
              Reduced motion {reducedFx ? "on" : "off"}
            </button>
          </div>
        </div>
      </main>

      {/* ── desktop control legend ─────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>←</Kbd>
            <Kbd>↓</Kbd>
            <Kbd>→</Kbd>
            <span className="ml-1">move</span>
            <Kbd>Space</Kbd>
            <span>pause</span>
            <Kbd>R</Kbd>
            <span>restart</span>
            <Kbd>M</Kbd>
            <span>mute</span>
          </div>
          <span>
            {MAX_LEVEL} levels · {ZONES.length} zones · 3 lives · {SKINS.length} skins
          </span>
        </div>
      </footer>
    </div>
  );
}

/** D-pad key for touch play. */
function TouchKey({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className="flex h-14 items-center justify-center border border-border text-foreground/80 transition-colors active:bg-accent"
    >
      {children}
    </button>
  );
}
