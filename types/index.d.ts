import type { Game } from '../hooks/game'

/**
 * What the band draws the game with, and then the hooks module's answer to
 * `hello`: the turn it plays in (`epoch`, a count of settled turns) and the
 * run to resume, if any. Only the answer carries `isReady`.
 */
export type JumpProps = { best: number } | JumpReady

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
    }
  }
}
