import { describe, expect, test } from 'claude-code/testing'

import {
  FIELD_ROWS,
  PLAYER_X,
  RESUME_TICKS,
  frame,
  newGame,
  pause,
  press,
  speedOf,
  step,
} from './game'

const WIDTH = 60

const text = (g: ReturnType<typeof newGame>) =>
  frame(g, WIDTH)
    .map(row => row.map(seg => seg.text).join(''))
    .join('\n')

const run = (g: ReturnType<typeof newGame>, ticks: number) => {
  let cur = g
  for (let i = 0; i < ticks; i += 1) cur = step(cur, WIDTH)
  return cur
}

describe('game', () => {
  test('starts ready and does not move until pressed', async () => {
    const g = newGame(0, 1)
    expect(g.phase).toBe('ready')
    expect(run(g, 10)).toEqual(g)
  })

  test('first press starts the run, the next press jumps', async () => {
    const playing = press(newGame(0, 1))
    expect(playing.phase).toBe('playing')
    expect(playing.y).toBe(0)
    const jumping = step(press(playing), WIDTH)
    expect(jumping.y).toBeGreaterThan(0)
  })

  test('a jump peaks within the field and lands back on the ground', async () => {
    let g = press(press(newGame(0, 1)))
    let peak = 0
    for (let i = 0; i < 40; i += 1) {
      g = step({ ...g, obstacles: [] }, WIDTH)
      peak = Math.max(peak, g.y)
    }
    expect(peak).toBeGreaterThan(2)
    expect(peak).toBeLessThan(FIELD_ROWS)
    expect(g.y).toBe(0)
  })

  test('pressing in the air does not double jump', async () => {
    const air = step(press(press(newGame(0, 1))), WIDTH)
    expect(press(air).vy).toBe(air.vy)
  })

  test('hitting an obstacle ends the run and keeps the best score', async () => {
    const g = { ...press(newGame(3, 1)), score: 10, obstacles: [{ x: PLAYER_X, w: 1, h: 1 }] }
    const over = step(g, WIDTH)
    expect(over.phase).toBe('over')
    expect(over.best).toBe(10)
  })

  test('jumping over an obstacle survives', async () => {
    let g = { ...press(press(newGame(0, 1))), obstacles: [{ x: PLAYER_X + 3, w: 1, h: 1 }] }
    for (let i = 0; i < 12; i += 1) g = step({ ...g, nextGap: 999 }, WIDTH)
    expect(g.phase).toBe('playing')
  })

  test('a run ends exactly when the player is drawn on an obstacle cell', async () => {
    // Field row r of a frame is rows[FIELD_ROWS - r]; rows[0] is the status row.
    const cellAt = (rows: ReturnType<typeof frame>, row: number) =>
      rows[FIELD_ROWS - row].map(seg => seg.text).join('')[PLAYER_X]
    const drawnRow = (rows: ReturnType<typeof frame>) =>
      Array.from({ length: FIELD_ROWS }, (_, r) => r).find(r => cellAt(rows, r) === '✻')

    // Starts on the ground, so the first tick of the jump (y = 0.76) is checked too.
    let g = press(press(newGame(0, 1)))
    let checked = 0
    do {
      for (const h of [1, 2]) {
        // Placed one step ahead so it lands on PLAYER_X during the step.
        const obstacle = { x: PLAYER_X + speedOf(g.score), w: 1, h }
        const free = step({ ...g, obstacles: [], nextGap: 999 }, WIDTH)
        const row = drawnRow(frame({ ...free, obstacles: [{ ...obstacle, x: PLAYER_X }] }, WIDTH))
        expect(row).toBeDefined()
        const shared = (row as number) < h
        const hit = step({ ...g, obstacles: [obstacle], nextGap: 999 }, WIDTH)
        expect(hit.phase === 'over').toBe(shared)
        checked += 1
      }
      g = step({ ...g, obstacles: [], nextGap: 999 }, WIDTH)
    } while (g.y > 0)
    expect(checked).toBeGreaterThan(10)
  })

  test('score grows while running and obstacles spawn', async () => {
    const g = run(press(newGame(0, 7)), 200)
    expect(g.phase === 'playing' ? g.score : g.best).toBeGreaterThan(0)
    expect(g.obstacles.length + (g.phase === 'over' ? 1 : 0)).toBeGreaterThan(0)
  })

  test('restart after game over needs a short cooldown', async () => {
    const over = step({ ...press(newGame(0, 1)), obstacles: [{ x: PLAYER_X, w: 1, h: 1 }] }, WIDTH)
    expect(press(over).phase).toBe('over')
    const later = run(over, 20)
    const again = press(later)
    expect(again.phase).toBe('playing')
    expect(again.score).toBe(0)
    expect(again.obstacles).toEqual([])
  })

  test('frame draws a status row, the field and the ground at the given width', async () => {
    const rows = frame(newGame(42, 1), WIDTH)
    expect(rows).toHaveLength(FIELD_ROWS + 2)
    for (const row of rows) {
      expect(row.map(seg => seg.text).join('').length).toBe(WIDTH)
    }
    const text = rows.map(row => row.map(seg => seg.text).join('')).join('\n')
    expect(text).toContain('HI 00042')
    expect(text).toContain('✻')
  })

  test('a paused run keeps its score and obstacles still until the countdown ends', async () => {
    const playing = run(press(newGame(0, 7)), 40)
    expect(playing.phase).toBe('playing')
    const paused = pause(playing)
    expect(paused.phase).toBe('paused')
    const waiting = run(paused, RESUME_TICKS - 1)
    expect(waiting.phase).toBe('paused')
    expect(waiting.score).toBe(playing.score)
    expect(waiting.obstacles).toEqual(playing.obstacles)
    expect(text(waiting)).toContain('PAUSED')
    const resumed = run(paused, RESUME_TICKS)
    expect(resumed.phase).toBe('playing')
    expect(run(resumed, 10).score).toBeGreaterThan(playing.score)
  })

  test('the countdown shows the seconds left', async () => {
    const paused = pause(press(newGame(0, 1)))
    expect(text(paused)).toContain('RESUME IN 3')
    expect(text(run(paused, RESUME_TICKS - 1))).toContain('RESUME IN 1')
  })

  test('a press resumes a paused run at once, without a jump', async () => {
    const paused = pause(run(press(newGame(0, 7)), 40))
    const resumed = press(paused)
    expect(resumed.phase).toBe('playing')
    expect(resumed.vy).toBe(0)
  })

  test('pausing leaves a run that is not playing as it was', async () => {
    const ready = newGame(0, 1)
    expect(pause(ready)).toBe(ready)
    const over = step({ ...press(newGame(0, 1)), obstacles: [{ x: PLAYER_X, w: 1, h: 1 }] }, WIDTH)
    expect(pause(over)).toBe(over)
    const paused = pause(press(newGame(0, 1)))
    expect(pause(run(paused, 5)).resumeTicks).toBe(RESUME_TICKS)
  })
})
