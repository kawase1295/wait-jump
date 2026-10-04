// Pure game logic: every function takes a Game and returns a new one.
// The surface module (jump.tsx) owns the clock and input; nothing here does.

import type { Game, Obstacle, Phase, Result } from '../types'

export type { Game, Obstacle, Phase, Result }

export type Segment = { text: string; color?: string; dim?: boolean; bold?: boolean }

export const FIELD_ROWS = 4
export const PLAYER_X = 4
export const TICK_MS = 50
/** A resumed run waits this long (or for a press) before it plays on. */
export const RESUME_TICKS = 3000 / TICK_MS

const GRAVITY = 0.12
const JUMP_V = 0.88
const RESTART_COOLDOWN = 12
const MIN_SPEED = 0.45
const MAX_SPEED = 1.1

export const CLAUDE = '#D97757'
const BUG = '#E5484D'

const nextSeed = (seed: number) => (Math.imul(seed, 1664525) + 1013904223) >>> 0
const unit = (seed: number) => seed / 0x100000000

export const speedOf = (score: number) => Math.min(MAX_SPEED, MIN_SPEED + score / 1500)

export const newGame = (best: number, seed: number): Game => ({
  phase: 'ready',
  y: 0,
  vy: 0,
  obstacles: [],
  distance: 0,
  score: 0,
  best,
  nextGap: 30,
  overTicks: 0,
  resumeTicks: 0,
  seed: seed >>> 0,
})

const PHASES: readonly Phase[] = ['ready', 'playing', 'paused', 'over']
const isCount = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

/** Whether posted data is a game this module drew: input to check, not a fact. */
export const isGame = (data: unknown): data is Game => {
  if (typeof data !== 'object' || data === null) return false
  const g = data as Record<string, unknown>
  return (
    PHASES.includes(g.phase as Phase) &&
    ['y', 'vy', 'distance', 'score', 'best', 'nextGap', 'overTicks', 'resumeTicks', 'seed'].every(
      key => isCount(g[key]),
    ) &&
    Array.isArray(g.obstacles) &&
    g.obstacles.every(
      (o: unknown) =>
        typeof o === 'object' &&
        o !== null &&
        ['x', 'w', 'h'].every(key => isCount((o as Record<string, unknown>)[key])),
    )
  )
}

const isOnGround = (g: Game) => g.y === 0 && g.vy === 0

/** Holds a run still; it plays on after the countdown or at the next press. */
export const pause = (g: Game): Game =>
  g.phase === 'playing' || g.phase === 'paused'
    ? { ...g, phase: 'paused', resumeTicks: RESUME_TICKS }
    : g

export const press = (g: Game): Game => {
  if (g.phase === 'ready') return { ...g, phase: 'playing' }
  if (g.phase === 'paused') return { ...g, phase: 'playing', resumeTicks: 0 }
  if (g.phase === 'over') {
    if (g.overTicks < RESTART_COOLDOWN) return g
    return { ...newGame(g.best, g.seed), phase: 'playing' }
  }
  if (!isOnGround(g)) return g

  return { ...g, vy: JUMP_V }
}

/** The field row the player occupies: drawing and collision both use it. */
const playerRow = (y: number) => Math.min(FIELD_ROWS - 1, Math.round(y))

const collides = (y: number, obstacles: Obstacle[]) =>
  obstacles.some(o => {
    const left = Math.round(o.x)
    return PLAYER_X >= left && PLAYER_X < left + o.w && playerRow(y) < o.h
  })

const spawn = (g: Game, obstacles: Obstacle[], width: number) => {
  const last = obstacles[obstacles.length - 1]
  if (last !== undefined && last.x + last.w > width - g.nextGap) {
    return { obstacles, nextGap: g.nextGap, seed: g.seed }
  }
  const a = nextSeed(g.seed)
  const b = nextSeed(a)
  const c = nextSeed(b)
  const h = unit(a) < 0.65 ? 1 : 2
  const w = unit(b) < 0.7 ? 1 : 2
  const speed = speedOf(g.score)
  const minGap = Math.ceil(18 * speed + 10)
  const nextGap = minGap + Math.floor(unit(c) * 22)

  return { obstacles: [...obstacles, { x: width, w, h }], nextGap, seed: c }
}

export const step = (g: Game, width: number): Game => {
  if (g.phase === 'ready') return g
  if (g.phase === 'paused') {
    const resumeTicks = g.resumeTicks - 1
    return resumeTicks > 0 ? { ...g, resumeTicks } : { ...g, phase: 'playing', resumeTicks: 0 }
  }
  // Once restart is allowed nothing changes, so the drawing stops redrawing.
  if (g.phase === 'over') {
    return g.overTicks >= RESTART_COOLDOWN ? g : { ...g, overTicks: g.overTicks + 1 }
  }

  const speed = speedOf(g.score)
  let vy = g.vy - (g.y > 0 || g.vy > 0 ? GRAVITY : 0)
  let y = g.y + vy
  if (y <= 0) {
    y = 0
    vy = 0
  }
  const moved = g.obstacles
    .map(o => ({ ...o, x: o.x - speed }))
    .filter(o => o.x + o.w > 0)
  const distance = g.distance + speed
  const score = Math.floor(distance / 2)

  if (collides(y, moved)) {
    return {
      ...g,
      phase: 'over',
      y,
      vy: 0,
      obstacles: moved,
      overTicks: 0,
      best: Math.max(g.best, g.score),
    }
  }

  const spawned = spawn({ ...g, score }, moved, width)

  return { ...g, y, vy, distance, score, ...spawned }
}

const pad = (n: number) => String(n).padStart(5, '0')

/** Draws the game as rows of colored segments, each row exactly `width` cells. */
export const frame = (g: Game, width: number): Segment[][] => {
  const cols = Math.max(20, width)
  const rows: Segment[][] = []

  rows.push(statusRow(g.best, g.score, cols))

  const player = playerRow(g.y)
  // ASCII only: every character must take exactly one cell.
  const message =
    g.phase === 'ready'
      ? 'SPACE / UP / CLICK TO START'
      : g.phase === 'paused'
        ? `PAUSED  RESUME IN ${Math.ceil((g.resumeTicks * TICK_MS) / 1000)}`
        : g.phase === 'over'
          ? 'GAME OVER  SPACE TO RETRY'
          : ''

  for (let row = FIELD_ROWS - 1; row >= 0; row -= 1) {
    const cells: Segment[] = Array.from({ length: cols }, () => ({ text: ' ' }))
    for (const o of g.obstacles) {
      if (row >= o.h) continue
      const left = Math.round(o.x)
      for (let i = 0; i < o.w; i += 1) {
        const x = left + i
        if (x >= 0 && x < cols) cells[x] = { text: '#', color: BUG, bold: true }
      }
    }
    if (row === player && PLAYER_X < cols) {
      cells[PLAYER_X] = { text: g.phase === 'over' ? '✕' : '✻', color: CLAUDE, bold: true }
    }
    if (row === FIELD_ROWS - 1 && message !== '') {
      const start = Math.max(0, Math.floor((cols - message.length) / 2))
      Array.from(message)
        .slice(0, cols - start)
        .forEach((ch, i) => {
          cells[start + i] = { text: ch, dim: true }
        })
    }
    rows.push(merge(cells))
  }

  rows.push(groundRow(cols))

  return rows
}

const statusRow = (best: number, score: number, cols: number): Segment[] => {
  const right = `HI ${pad(best)}  ${pad(score)}`
  const title = '✻ Claude Jump'
  const gap = Math.max(1, cols - title.length - right.length)
  // fit trims the status row when the band is narrower than its text.
  return fit(
    [
      { text: title, color: CLAUDE, bold: true },
      { text: ' '.repeat(gap) },
      { text: right, dim: true },
    ],
    cols,
  )
}

const groundRow = (cols: number): Segment[] => [{ text: '─'.repeat(cols), dim: true }]

/**
 * Whether a run passed the high score it started under. A run raises `best`
 * only as it ends, so an ended run that set it holds `best === score`; one
 * that ended exactly on the old high score reads the same.
 */
export const hasSetBest = (g: Game): boolean =>
  g.phase === 'over' ? g.score > 0 && g.score === g.best : g.score > g.best

/** Draws a settled run in the game's place, the same size: status row, field, ground. */
export const resultFrame = (r: Result, width: number): Segment[][] => {
  const cols = Math.max(20, width)
  const message = `CLAUDE IS DONE  SCORE ${pad(r.score)}`
  const mark = r.isNewBest ? '  NEW HI' : ''
  const start = Math.max(0, Math.floor((cols - message.length - mark.length) / 2))
  const field = Array.from({ length: FIELD_ROWS }, (_, i): Segment[] =>
    i === 1
      ? fit(
          [
            { text: ' '.repeat(start) },
            { text: message, bold: true },
            { text: mark, color: CLAUDE, bold: true },
          ].filter(seg => seg.text !== ''),
          cols,
        )
      : [{ text: ' '.repeat(cols) }],
  )

  return [statusRow(r.best, r.score, cols), ...field, groundRow(cols)]
}

const sameStyle = (a: Segment, b: Segment) =>
  a.color === b.color && a.dim === b.dim && a.bold === b.bold

const merge = (cells: Segment[]): Segment[] =>
  cells.reduce<Segment[]>((out, cell) => {
    const last = out[out.length - 1]
    if (last !== undefined && sameStyle(last, cell)) {
      out[out.length - 1] = { ...last, text: last.text + cell.text }
    } else {
      out.push({ ...cell })
    }
    return out
  }, [])

const fit = (segments: Segment[], cols: number): Segment[] => {
  let left = cols
  const out: Segment[] = []
  for (const seg of segments) {
    if (left <= 0) break
    const text = seg.text.slice(0, left)
    out.push({ ...seg, text })
    left -= text.length
  }
  if (left > 0) out.push({ text: ' '.repeat(left) })
  return out
}
