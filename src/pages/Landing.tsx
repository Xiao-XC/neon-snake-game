/**
 * Neon Snake — landing page.
 * Minimalism theme: near-monochrome, hairline dividers, generous whitespace,
 * tiny uppercase micro-labels. All artwork is generated inline SVG — no assets.
 */

import { Link } from "react-router";
import { ArrowRight } from "lucide-react";

/** Generated 21×21 pixel-grid board illustration. */
function BoardArt() {
  const snake: Array<[number, number]> = [
    [4, 10], [5, 10], [6, 10], [7, 10], [7, 9], [7, 8], [7, 7], [8, 7], [9, 7], [10, 7], [10, 8],
    [10, 9], [10, 10], [10, 11], [10, 12], [10, 13], [10, 14], [11, 14], [12, 14], [13, 14],
    [14, 14], [14, 13], [14, 12],
  ];
  const food: Array<[number, number]> = [[17, 6]];
  const power: Array<[number, number]> = [[4, 4]];
  const dots: Array<[number, number]> = [];
  for (let y = 1; y < 21; y += 2) {
    for (let x = 1; x < 21; x += 2) dots.push([x, y]);
  }
  return (
    <svg
      viewBox="0 0 21 21"
      className="w-full max-w-[340px]"
      role="img"
      aria-label="Illustration of the snake board"
    >
      {dots.map(([x, y], i) => (
        <rect key={`d${i}`} x={x - 0.06} y={y - 0.06} width={0.12} height={0.12} fill="currentColor" opacity={0.28} />
      ))}
      {snake.map(([x, y], i) => (
        <rect
          key={`s${i}`}
          x={x}
          y={y}
          width={0.92}
          height={0.92}
          fill="currentColor"
          opacity={0.35 + 0.65 * (1 - i / snake.length)}
        />
      ))}
      {food.map(([x, y], i) => (
        <circle key={`f${i}`} cx={x + 0.5} cy={y + 0.5} r={0.55} fill="currentColor" />
      ))}
      {power.map(([x, y], i) => (
        <circle key={`p${i}`} cx={x + 0.5} cy={y + 0.5} r={0.7} fill="none" stroke="currentColor" strokeWidth={0.14} strokeDasharray="0.3 0.2" />
      ))}
    </svg>
  );
}

const POWERS = [
  { mark: "+", name: "Bonus", desc: "+40 points, instantly banked." },
  { mark: "S", name: "Slow", desc: "Six seconds of calm on a fast board." },
  { mark: "G", name: "Ghost", desc: "Wrap through walls — and yourself." },
  { mark: "−", name: "Shrink", desc: "Cut the tail in half when it crowds you." },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── top bar ─────────────────────────────────────────────── */}
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden="true">
              <rect x="10" y="3" width="1" height="1" fill="currentColor" />
              <rect x="10" y="4" width="1" height="1" fill="currentColor" />
              <rect x="10" y="5" width="1" height="1" fill="currentColor" />
              <rect x="11" y="5" width="1" height="1" fill="currentColor" />
              <rect x="12" y="5" width="1" height="1" fill="currentColor" />
              <circle cx="16.5" cy="15.5" r="0.6" fill="currentColor" opacity="0.5" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">Neon Snake</span>
          </div>
          <Link
            to="/play"
            className="border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors hover:bg-accent"
          >
            Play
          </Link>
        </div>
      </header>

      {/* ── hero ────────────────────────────────────────────────── */}
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto grid w-full max-w-5xl gap-12 px-6 py-20 md:grid-cols-2 md:items-center md:py-28">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Arcade · Browser · Free
              </p>
              <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
                Neon Snake
              </h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
                A minimalist snake game across fifteen levels and five color
                zones. Eat the discs, dodge the obstacles, bank the power-ups,
                and keep three lives intact.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  to="/play"
                  className="inline-flex items-center gap-2 bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition-opacity hover:opacity-80"
                >
                  Start playing
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  No sign-in · nothing to install
                </span>
              </div>
            </div>
            <div className="flex justify-center md:justify-end">
              <div className="border border-border p-8 md:p-10">
                <BoardArt />
              </div>
            </div>
          </div>
        </section>

        {/* ── rules strip ───────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-px bg-border px-0 md:grid-cols-4">
            {[
              ["Levels", "15"],
              ["Zones", "5"],
              ["Speed", "Rising"],
              ["Controls", "Keys + touch"],
            ].map(([k, v]) => (
              <div key={k} className="bg-background px-6 py-7">
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{k}</p>
                <p className="mt-2 font-mono text-lg tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── power-ups ─────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-5xl px-6 py-20">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Power-ups
            </p>
            <h2 className="mt-4 max-w-md text-2xl font-semibold tracking-tight">
              Four marks. One spawns every nine seconds.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              The board recolors every three levels — Graphite, Signal Green, Cyan
              Circuit, Magenta Drive, Amber Core — and unlocks your next snake color
              as you go. Chain eats for a combo multiplier, and chase the glowing
              risk discs near the walls for five-fold points.
            </p>
            <div className="mt-12 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
              {POWERS.map((p) => (
                <div key={p.name} className="bg-background px-6 py-8">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border font-mono text-lg">
                    {p.mark}
                  </div>
                  <p className="mt-5 text-sm font-semibold">{p.name}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── closing CTA ───────────────────────────────────────── */}
        <section>
          <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-24 text-center">
            <h2 className="max-w-lg text-3xl font-semibold tracking-tight">
              Clear all fifteen levels. Keep the tail out of the walls.
            </h2>
            <Link
              to="/play"
              className="mt-8 inline-flex items-center gap-2 bg-foreground px-8 py-3.5 text-xs font-semibold uppercase tracking-[0.2em] text-background transition-opacity hover:opacity-80"
            >
              Play Neon Snake
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      </main>

      {/* ── footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Neon Snake</span>
          <span>Built for the browser · scores live on your device</span>
        </div>
      </footer>
    </div>
  );
}
