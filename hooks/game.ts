// Pure game logic: every function takes a Game and returns a new one.
// The surface module (jump.tsx) owns the clock and input; nothing here does.

export type Obstacle = { x: number; w: number; h: number }

export type Phase = 'ready' | 'playing' | 'over'

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
  seed: number
}

export type Segment = { text: string; color?: string; dim?: boolean; bold?: boolean }

export const FIELD_ROWS = 4
export const PLAYER_X = 4
export const TICK_MS = 50

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
  seed: seed >>> 0,
})

const isOnGround = (g: Game) => g.y === 0 && g.vy === 0

export const press = (g: Game): Game => {
  if (g.phase === 'ready') return { ...g, phase: 'playing' }
  if (g.phase === 'over') {
    if (g.overTicks < RESTART_COOLDOWN) return g
    return { ...newGame(g.best, g.seed), phase: 'playing' }
  }
  if (!isOnGround(g)) return g

  return { ...g, vy: JUMP_V }
}

const collides = (g: Game, y: number, obstacles: Obstacle[]) =>
  obstacles.some(o => {
    const left = Math.round(o.x)
    return PLAYER_X >= left && PLAYER_X < left + o.w && y < o.h
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

  if (collides(g, y, moved)) {
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

  const right = `HI ${pad(g.best)}  ${pad(g.score)}`
  const title = '✻ Claude Jump'
  const gap = Math.max(1, cols - title.length - right.length)
  // fit trims the status row when the band is narrower than its text.
  rows.push(
    fit(
      [
        { text: title, color: CLAUDE, bold: true },
        { text: ' '.repeat(gap) },
        { text: right, dim: true },
      ],
      cols,
    ),
  )

  const playerRow = Math.min(FIELD_ROWS - 1, Math.round(g.y))
  // ASCII only: every character must take exactly one cell.
  const message =
    g.phase === 'ready'
      ? 'SPACE / UP / CLICK TO START'
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
    if (row === playerRow && PLAYER_X < cols) {
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

  rows.push([{ text: '─'.repeat(cols), dim: true }])

  return rows
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
