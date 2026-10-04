// The contract must be self-contained, so the game's shapes live here and
// hooks/game.ts takes them from this file.

export type Obstacle = { x: number; w: number; h: number }

export type Phase = 'ready' | 'playing' | 'paused' | 'over'

export type Game = {
  phase: Phase
  /** Height above the ground, in rows. */
  y: number
  vy: number
  obstacles: Obstacle[]
  /** Distance run, in columns. */
  distance: number
  score: number
  best: number
  /** Columns to leave after the last obstacle before the next one. */
  nextGap: number
  /** Ticks spent since the run ended. */
  overTicks: number
  /** Ticks left before a paused run plays on. */
  resumeTicks: number
  seed: number
}

/** A settled run: its score, the high score after it, and whether it set that. */
export type Result = { score: number; best: number; isNewBest: boolean }

/**
 * What the band draws the game with (`turns`: the settled turns, so a band
 * drawn on into the next turn starts afresh), and the hooks module's answer
 * to `hello`: the turn it plays in (`epoch`, the same count) and the run to
 * resume, if any. Only the answer carries `isReady`.
 */
export type JumpProps = { best: number; turns: number } | JumpReady

export type JumpReady = { best: number; epoch: number; isReady: true; resume?: Game }

/** What the drawing posts: `hello` once it mounts, then each change of the game. */
export type JumpMessage =
  | { hello: true }
  | { epoch: number; game: Game; best: number }
  | { best: number }

declare module 'claude-code' {
  interface PluginState {
    'wait-jump': {
      best: number
      isEnabled: boolean
      /**
       * The turn the band plays in (`epoch`, a count of settled turns) and the
       * run it last showed in it, kept to resume after a prompt. One value, so
       * a post checks the epoch and writes the run in one update.
       */
      run: { epoch: number; game: Game | null }
      /** The run the last turn settled, shown in the band until the timer or the next turn clears it. */
      result: Result | null
      /** The settled turns, as the band reads them while drawing: a new turn draws a new game. */
      turns: number
    }
  }
}
