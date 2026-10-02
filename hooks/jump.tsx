import type { ClientModule } from 'claude-code'

import type { JumpProps } from '../types'
import { TICK_MS, frame, newGame, press, step } from './game'
import type { Game } from './game'

const FALLBACK_COLUMNS = 60

const isJumpKey = (key: string) =>
  key === ' ' || key === 'space' || key === 'up' || key === 'return' || key === 'w' || key === 'k'

// Runs on the drawing thread: owns the frame clock and input, and posts the
// best score to the hooks module whenever a run ends above it.
const Jump: ClientModule<JumpProps, Game> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = () => (surface.columns > 0 ? surface.columns : FALLBACK_COLUMNS)

  let game = surface.state
  if (game === undefined) {
    let current = newGame(props.best, Math.floor(Math.random() * 0x100000000))
    const set = (next: Game) => {
      if (next === current) return
      const hasEnded = current.phase === 'playing' && next.phase === 'over'
      current = next
      surface.setState(next)
      if (hasEnded) surface.post({ best: next.best })
    }
    surface.every(TICK_MS, () => set(step(current, width())))
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
      {frame(game, width()).map(row => (
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
