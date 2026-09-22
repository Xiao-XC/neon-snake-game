/**
 * Neon Snake — a minimalist arcade snake game.
 *
 * Rendering: HTML5 <canvas>, fixed 21×21 logical grid, DPR-aware backing
 * store, requestAnimationFrame loop with a fixed-timestep simulation.
 * Input:   keyboard (arrows/WASD/Space/R/M/Enter) + touch swipe + on-screen
 *          d-pad on small screens.
 * Audio:   procedural WebAudio blips (no asset files), with mute toggle.
 * Storage: high score / mute / reduced-fx persisted in localStorage.
 * Visuals: near-monochrome palette, generated shapes only — no assets.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Info,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const GRID = 21; // grid is 21×21 cells (odd → symmetric centre spawn)
const CANVAS = 462; // logical canvas size in px (GRID × 22px cells)
const CELL = CANVAS / GRID; // logical size of one cell

const START_LIVES = 3;
const MAX_LEVEL = 6;
const FOODS_PER_LEVEL = 8;
const POINTS_FOOD = 10;
const POINTS_BONUS = 40;
const LEVELS_SPEED_MS = [170, 145, 122, 102, 86, 72]; // ms per step per level
const POWERUP_INTERVAL = 9000; // ms between power-up spawns
const POWERUP_LIFETIME = 7000; // ms a power-up stays on the board
const GHOST_MS = 5000; // ghost (wrap-through) duration
const SLOW_MS = 6000; // slow-motion duration
const RESPAWN_MS = 900; // death pause before respawn / game over

/** Near-monochrome palette aligned with the minimalism theme tokens. */
const C = {
  bg: "#0b0b0c",
  dot: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.14)",
  snake: "#ffffff",
  food: "#e4e4e7",
  ink: "#0b0b0c",
  particle: "#ffffff",
  ghostTrail: "rgba(255,255,255,0.10)",
};

const LS = {
  high: "neon-snake:high",
  muted: "neon-snake:muted",
  fx: "neon-snake:reduced-fx",
};

type Pt = { x: number; y: number };
type Dir = "up" | "down" | "left" | "right";
type Phase = "start" | "playing" | "paused" | "dying" | "over" | "won";
type PowerType = "bonus" | "slow" | "ghost" | "shrink";
type PowerUp = { cell: Pt; type: PowerType; born: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number };

const DIR_V: Record<Dir, Pt> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const POWER_LETTER: Record<PowerType, string> = { bonus: "+", slow: "S", ghost: "G", shrink: "−" };

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
function randCell(): number {
  return Math.floor(Math.random() * GRID);
}

/** Rounded-rect path (used for snake segments). */
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
}: {
  children: React.ReactNode;
  label: string;
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
      <div className="w-full max-w-xs px-6 text-center">{children}</div>
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
  /* ---------- mutable game state (refs — never trigger re-render) ---------- */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const snake = useRef<Pt[]>([]);
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
  const phaseRef = useRef<Phase>("start");
  const fxRef = useRef(false); // true → reduced motion
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const sfx = useRef<Sfx | null>(null);

  /* ---------- reactive state (only what the HUD/overlays show) ---------- */
  const [phase, setPhaseState] = useState<Phase>("start");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [level, setLevel] = useState(1);
  const [high, setHigh] = useState(() => Number(lsGet(LS.high) ?? 0));
  const [muted, setMuted] = useState(() => lsGet(LS.muted) === "1");
  const [reducedFx, setReducedFx] = useState(() => lsGet(LS.fx) === "1");
  const [ghostSecs, setGhostSecs] = useState(0);
  const [slowSecs, setSlowSecs] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  /* lazily construct Sfx on first client render */
  useEffect(() => {
    sfx.current = new Sfx();
    sfx.current.muted = muted;
    fxRef.current = reducedFx;
    // Seed a static board so the pre-game render has something to draw.
    const cx = Math.floor(GRID / 2);
    snake.current = [
      { x: cx - 1, y: cx },
      { x: cx - 2, y: cx },
      { x: cx - 3, y: cx },
    ];
    spawnFood();
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

  /** Add points; keep the high score live-updated and persisted. */
  const addScore = useCallback((n: number) => {
    scoreRef.current += n;
    setScore(scoreRef.current);
    setHigh((h) => {
      if (scoreRef.current > h) {
        lsSet(LS.high, String(scoreRef.current));
        return scoreRef.current;
      }
      return h;
    });
  }, []);

  /* ---------- spawning ---------- */

  const spawnFood = useCallback(() => {
    const taken = new Set(snake.current.map((p) => `${p.x},${p.y}`));
    if (power.current) taken.add(`${power.current.cell.x},${power.current.cell.y}`);
    let x = 0;
    let y = 0;
    do {
      x = randCell();
      y = randCell();
    } while (taken.has(`${x},${y}`));
    food.current = { x, y };
  }, []);

  const spawnPower = useCallback(() => {
    const taken = new Set(snake.current.map((p) => `${p.x},${p.y}`));
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
  }, []);

  /* ---------- power-up pickup ---------- */

  const applyPower = useCallback(
    (type: PowerType) => {
      const now = performance.now();
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
    [addScore],
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
    timers.current = { ghostUntil: 0, slowUntil: 0, nextPowerAt: performance.now() + POWERUP_INTERVAL };
    power.current = null;
    particles.current = [];
    shake.current = 0;
    stepAcc.current = 0;
    setGhostSecs(0);
    setSlowSecs(0);
    spawnFood();
  }, [spawnFood]);

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
    setGhostSecs(0);
    setSlowSecs(0);
    stepAcc.current = 0;
    spawnFood();
    setPhase("playing");
  }, [spawnFood, setPhase]);

  /** Death sequence: burst, shake, pause, then respawn or game over. */
  const die = useCallback(() => {
    setPhase("dying");
    sfx.current?.die();
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
    sfx.current?.win();
  }, [setPhase]);

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

    // food
    if (hx === food.current.x && hy === food.current.y) {
      addScore(POINTS_FOOD);
      eatenRef.current += 1;
      sfx.current?.eat();
      burst((hx + 0.5) * CELL, (hy + 0.5) * CELL, 8);
      if (eatenRef.current >= FOODS_PER_LEVEL) {
        eatenRef.current = 0;
        if (levelRef.current >= MAX_LEVEL) {
          winGame();
          return;
        }
        levelRef.current += 1;
        setLevel(levelRef.current);
        sfx.current?.levelUp();
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
  }, [addScore, applyPower, burst, die, spawnFood, winGame]);

  /* ---------- frame render ---------- */

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const t = performance.now();
    const s = snake.current;
    if (s.length === 0) return; // nothing seeded yet (first frames)
    const ghost = t < timers.current.ghostUntil;

    ctx.clearRect(0, 0, CANVAS, CANVAS);

    // subtle screen shake on death
    ctx.save();
    if (shake.current > 0 && !fxRef.current) {
      const d = shake.current / 10;
      ctx.translate((Math.random() - 0.5) * d * 6, (Math.random() - 0.5) * d * 6);
    }

    // background + dot grid
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    ctx.fillStyle = C.dot;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        ctx.fillRect(x * CELL + CELL / 2 - 1, y * CELL + CELL / 2 - 1, 2, 2);
      }
    }

    // food — pulsing disc
    const pulse = 0.85 + 0.15 * Math.sin(t / 180);
    ctx.fillStyle = C.food;
    ctx.beginPath();
    ctx.arc((food.current.x + 0.5) * CELL, (food.current.y + 0.5) * CELL, CELL * 0.26 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // power-up — lettered disc, blinks before expiring
    if (power.current) {
      const { cell: c, type, born } = power.current;
      const age = t - born;
      const blink = age > POWERUP_LIFETIME - 2000 ? (Math.sin(t / 80) + 1) / 2 : 1;
      ctx.globalAlpha = 0.55 + 0.45 * blink;
      ctx.fillStyle = C.snake;
      ctx.beginPath();
      ctx.arc((c.x + 0.5) * CELL, (c.y + 0.5) * CELL, CELL * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.ink;
      ctx.font = `bold ${Math.floor(CELL * 0.62)}px ui-monospace, SFMono-Regular, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWER_LETTER[type], (c.x + 0.5) * CELL, (c.y + 0.5) * CELL + 1);
    }

    // snake body — fading rounded segments
    for (let i = s.length - 1; i >= 1; i--) {
      const seg = s[i];
      const fade = 0.28 + 0.44 * (1 - i / Math.max(1, s.length - 1));
      ctx.globalAlpha = ghost ? fade * 0.6 : fade;
      ctx.fillStyle = C.snake;
      roundRect(ctx, seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4, 4);
    }
    ctx.globalAlpha = 1;

    // ghost-mode wrap hint: soft border glow while active
    if (ghost) {
      ctx.strokeStyle = C.ghostTrail;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, CANVAS - 4, CANVAS - 4);
    }

    // head — always solid
    ctx.fillStyle = C.snake;
    roundRect(ctx, s[0].x * CELL + 1, s[0].y * CELL + 1, CELL - 2, CELL - 2, 5);

    // particles
    ctx.fillStyle = C.particle;
    for (const p of particles.current) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // hairline board border
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CANVAS - 1, CANVAS - 1);

    ctx.restore();
  }, []);

  /* ---------- main loop: fixed-timestep sim + per-frame render ---------- */

  useEffect(() => {
    let cancelled = false;

    const loop = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(50, now - lastT.current);
      lastT.current = now;

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
        const t = performance.now();

        // schedule / expire power-ups
        if (!power.current && t >= timers.current.nextPowerAt) {
          spawnPower();
        }
        if (power.current && t - power.current.born > POWERUP_LIFETIME) {
          power.current = null;
          timers.current.nextPowerAt = t + POWERUP_INTERVAL;
        }

        // fixed-timestep stepping, slowed 40% while slow-power is active
        const base = LEVELS_SPEED_MS[Math.min(levelRef.current - 1, LEVELS_SPEED_MS.length - 1)];
        const interval = t < timers.current.slowUntil ? base * 1.65 : base;
        stepAcc.current += dt;
        while (stepAcc.current >= interval && phaseRef.current === "playing") {
          stepAcc.current -= interval;
          step();
        }

        // expire timed powers (HUD countdown)
        const gLeft = Math.max(0, Math.ceil((timers.current.ghostUntil - t) / 1000));
        const sLeft = Math.max(0, Math.ceil((timers.current.slowUntil - t) / 1000));
        setGhostSecs(timers.current.ghostUntil > t ? gLeft : 0);
        setSlowSecs(timers.current.slowUntil > t ? sLeft : 0);
      }

      render();
      raf.current = requestAnimationFrame(loop);
    };

    raf.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf.current);
    };
  }, [render, spawnPower, step]);

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
      else if (k === "Escape" && phaseRef.current === "playing") setPhase("paused");
      else if (k === "Enter" || k === "r" || k === "R") {
        if (phaseRef.current !== "dying") beginGame();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beginGame, queueDir, setPhase, toggleMuted, togglePause]);

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
  const speedLabel = ["Unhurried", "Brisk", "Steady+", "Quick", "Fast", "Blistering"][level - 1] ?? "";

  /* ---------- render ---------- */

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── header ─────────────────────────────────────────────── */}
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <BoardMark className="h-6 w-6 text-foreground" />
            <div>
              <p className="text-sm font-semibold leading-none tracking-tight">Neon Snake</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Minimalism arcade
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconButton label="How to play" onClick={() => setShowHelp(true)}>
              <Info className="h-4 w-4" />
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
            <Pill label="Score" value={score} />
            <Pill label="High" value={high} />
            <Pill label="Level" value={`${level}/${MAX_LEVEL}`} />
            <Pill label="Lives" value={"●".repeat(lives) || "—"} />
          </div>
          <div className="flex items-center gap-2">
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
          <div className="relative aspect-square w-full">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full touch-none select-none"
              aria-label="Snake game board"
              role="img"
            />

            <AnimatePresence>
              {/* start */}
              {phase === "start" && !showHelp && (
                <Overlay label="Start screen">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Ready</p>
                  <h1 className="mt-3 text-3xl font-semibold tracking-tight">Neon Snake</h1>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    Eat. Grow. Clear six levels. Grab power-ups — but don&apos;t touch the walls,
                    or yourself.
                  </p>
                  <div className="mt-6 space-y-2">
                    <OverlayButton onClick={beginGame}>Start game</OverlayButton>
                    <OverlayButton variant="ghost" onClick={() => setShowHelp(true)}>
                      How to play
                    </OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* paused */}
              {phase === "paused" && !showHelp && (
                <Overlay label="Paused">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Paused</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">Take a breath</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Score {score} · Level {level}
                  </p>
                  <div className="mt-6 space-y-2">
                    <OverlayButton onClick={togglePause}>Resume</OverlayButton>
                    <OverlayButton variant="ghost" onClick={beginGame}>
                      Restart
                    </OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* game over */}
              {phase === "over" && !showHelp && (
                <Overlay label="Game over">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Game over
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">Out of lives</h2>
                  <dl className="mx-auto mt-5 grid w-44 grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-left text-muted-foreground">Score</dt>
                    <dd className="text-right font-mono tabular-nums">{score}</dd>
                    <dt className="text-left text-muted-foreground">Level</dt>
                    <dd className="text-right font-mono tabular-nums">{level}</dd>
                    <dt className="text-left text-muted-foreground">High</dt>
                    <dd className="text-right font-mono tabular-nums">{high}</dd>
                  </dl>
                  <div className="mt-6 space-y-2">
                    <OverlayButton onClick={beginGame}>Play again</OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* win */}
              {phase === "won" && !showHelp && (
                <Overlay label="You win">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Cleared
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">All six levels</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Flawless run of the grid.</p>
                  <dl className="mx-auto mt-5 grid w-44 grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-left text-muted-foreground">Score</dt>
                    <dd className="text-right font-mono tabular-nums">{score}</dd>
                    <dt className="text-left text-muted-foreground">High</dt>
                    <dd className="text-right font-mono tabular-nums">{high}</dd>
                  </dl>
                  <div className="mt-6 space-y-2">
                    <OverlayButton onClick={beginGame}>Play again</OverlayButton>
                  </div>
                </Overlay>
              )}

              {/* instructions / help */}
              {showHelp && (
                <Overlay label="How to play">
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
                      clear each of {MAX_LEVEL} levels. Speed rises every level.
                    </li>
                    <li>
                      <span className="text-foreground">Lose</span> — hit a wall or your own body;
                      three lives total. Ghost power wraps through walls and body.
                    </li>
                    <li>
                      <span className="text-foreground">Power-ups</span> —{" "}
                      <span className="font-mono text-foreground">+</span> bonus points,{" "}
                      <span className="font-mono text-foreground">S</span> slow motion,{" "}
                      <span className="font-mono text-foreground">G</span> ghost,{" "}
                      <span className="font-mono text-foreground">−</span> shrink your tail.
                    </li>
                  </ul>
                  <div className="mt-6">
                    <OverlayButton onClick={() => setShowHelp(false)}>Back</OverlayButton>
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

          {/* level / speed caption */}
          <p className="mt-3 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Level {level} · {speedLabel}
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
          <span>{MAX_LEVEL} levels · 3 lives · power-ups every ~9s</span>
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
