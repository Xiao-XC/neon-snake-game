/**
 * /play — hosts the game component.
 * The game is fully playable without an account; no auth wrapper here.
 */

import SnakeGame from "@/components/game/SnakeGame";

export default function Play() {
  return <SnakeGame />;
}
