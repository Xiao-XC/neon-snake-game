# Neon Snake
<img width="986" height="641" alt="Screenshot 2026-09-23 135809" src="https://github.com/user-attachments/assets/6cad84e9-3ccf-4f38-933d-2649cc7a627f" />


https://github.com/user-attachments/assets/cb7597b2-968e-4191-bd5a-07252e116eaa


A minimalist take on classic Snake — eat, grow, and survive across 6 levels of rising speed, with a handful of power-ups to bend the rules along the way.

**Play it here:** https://many-chairs-throw.freebuff.dev/

## Gameplay

- Classic snake on a 21×21 grid — eat the pulsing discs, grow your tail, clear 8 discs to advance a level
- 6 levels total, with speed increasing each level (170ms → 72ms per step)
- 3 lives — hitting a wall or your own body costs one, with a short respawn pause
- Power-ups spawn periodically and expire after a few seconds:
  - **+** bonus points
  - **S** slow motion
  - **G** ghost mode (wrap through walls and your own body)
  - **−** shrink your tail
- High score is saved locally in your browser

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | Arrow keys / WASD | Swipe or on-screen d-pad |
| Pause | Space | — |
| Restart | R / Enter | — |
| Mute | M | — |
| Quit / back | Esc | — |

## Tech stack

- React + TypeScript
- HTML5 Canvas for the game rendering
- Procedural WebAudio for sound effects (no audio files)
- No backend, no accounts — everything runs client-side, high scores persist via `localStorage`

## Running it locally

\`\`\`bash
git clone https://github.com/Xiao-XC/neon-snake-game.git
cd neon-snake-game
npm install
npm run dev
\`\`\`

Then open the local URL Vite prints (usually `http://localhost:5173`).

To build a production bundle:

\`\`\`bash
npm run build
npm run preview
\`\`\`

## Project structure

The game logic lives in `src/components/game/SnakeGame.tsx`; the landing page is in `src/pages/Landing.tsx` and the play page in `src/pages/Play.tsx`.

## About

Built as a fun side project using [Freebuff](https://freebuff.com), an AI app builder. The game itself needs no accounts or backend — it was scaffolded from a starter template that includes some unused auth/database plumbing (Convex), which is not wired up to the game.
