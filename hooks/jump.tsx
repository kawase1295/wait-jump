import type { ClientModule } from 'claude-code'

import type { JumpMessage, JumpProps, JumpReady } from '../types'
import { TICK_MS, frame, newGame, pause, press, step } from './game'
import type { Game } from './game'

const FALLBACK_COLUMNS = 60
// While a run leads, its score is posted this often: the band can go away
// mid-run (a permission prompt, the turn's end) with no chance to post after.
// So an interrupted run keeps its score as of up to a second before the cut.
const POST_EVERY_TICKS = 1000 / TICK_MS

const isJumpKey = (key: string) =>
  key === ' ' || key === 'space' || key === 'up' || key === 'return' || key === 'w' || key === 'k'

const start = (props: JumpReady): Game =>
  props.resume === undefined
    ? newGame(props.best, Math.floor(Math.random() * 0x100000000))
    : pause({ ...props.resume, best: Math.max(props.best, props.resume.best) })

// Runs on the drawing thread: owns the frame clock and input, and posts each
// change of the game to the hooks module, which keeps it to resume the run
// after a prompt, with the best score while a run leads and when it ends above it.
const Jump: ClientModule<JumpProps, Game> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = () => (surface.columns > 0 ? surface.columns : FALLBACK_COLUMNS)

  let game = surface.state
  if (game === undefined && !('isReady' in props)) {
    // The hooks module answers with the run to resume, if any; until then the
    // band shows a fresh game that takes no input.
    surface.post({ hello: true } satisfies JumpMessage)
  } else if (game === undefined && 'isReady' in props) {
    const { epoch } = props
    let current = start(props)
    let posted = current.best
    let ticksSincePost = 0
    const set = (next: Game) => {
      if (next === current) return
      const hasEnded = current.phase === 'playing' && next.phase === 'over'
      current = next
      surface.setState(next)
      const score = Math.max(next.best, next.score)
      // A run raises `best` only when it ends, so while it plays posted <= best
      // means it has just taken the lead and nothing of it is posted yet.
      const hasJustLed = posted <= next.best
      if (score > posted && (hasEnded || hasJustLed || ticksSincePost >= POST_EVERY_TICKS)) {
        posted = score
        ticksSincePost = 0
      }
      surface.post({ epoch, game: next, best: posted } satisfies JumpMessage)
    }
    surface.every(TICK_MS, () => {
      ticksSincePost += 1
      set(step(current, width()))
    })
    surface.onKey(e => {
      if (isJumpKey(e.key)) set(press(current))
    })
    surface.onPointer(e => {
      if (e.type === 'down') set(press(current))
    })
    surface.setState(current)
    game = current
  }

  return (
    <Box flexDirection="column">
      {frame(game ?? newGame(props.best, 0), width()).map(row => (
        <Text wrap="truncate">
          {row.map(seg => (
            <Text color={seg.color} dimColor={seg.dim} bold={seg.bold}>
              {seg.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default Jump
