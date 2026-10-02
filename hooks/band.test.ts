import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

// The world beneath the plugin: an in-memory store, an empty band and the
// engine's bare answers to the calls the plugin makes.
const world = (on: On) => {
  mock.store(on)
  on('ui.render', () => ({ type: 'Box' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { clock, toasts }
}

const band = (isWorking: boolean, bodyColumns = 60, maxRows = 20, hasSurvey = false) => ({
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey,
    isWorking,
    maxRows,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 19, totalRows: 0 },
    view: {},
  },
  viewport: { columns: 60, rows: 30 },
})

test('the game shows only while Claude is working, and plays on every surface', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const idle = await $.ui.mount({ plugin: 'wait-jump', surface, ...band(false) })
    expect(await idle.find({ key: 'game' })).toBeUndefined()
    await idle.unmount()

    const ui = await $.ui.mount({ plugin: 'wait-jump', surface, ...band(true) })
    await ui.resize({ columns: 60, rows: 6 })
    expect(await ui.find({ in: 'game', text: /CLICK TO START/ })).toBeDefined()

    await ui.key({ key: ' ' })
    await ui.advance(500)
    expect(await ui.find({ in: 'game', text: /CLICK TO START/ })).toBeUndefined()

    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    await ui.advance(100)
    await ui.unmount()
    // The turn ends, so the next surface starts afresh instead of resuming.
    await endTurn($)
  }
})

test('the full-width space of a Japanese IME starts the run like Space', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await ui.resize({ columns: 60, rows: 6 })
  expect(await ui.find({ in: 'game', text: /CLICK TO START/ })).toBeDefined()

  await ui.key({ key: '\u3000' })
  await ui.advance(500)
  expect(await ui.find({ in: 'game', text: /CLICK TO START/ })).toBeUndefined()
  await ui.unmount()
})

test('a run ending above the best score is stored across sessions', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await ui.post({ best: 123 })
  await ui.post({ best: 50 })
  await ui.unmount()
  // A new session reads the best score back from the store.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await again.resize({ columns: 60, rows: 6 })
  expect(await again.find({ in: 'game', text: /HI 00123/ })).toBeDefined()
  await again.unmount()
})

// Starts a run and lets it go on for `ms`, then takes the band away mid-run,
// as a permission prompt or the turn's end does. The first obstacle needs
// about 6 seconds to reach the player, so a shorter run never ends on its own.
const interruptedRun = async ($: Engine, ms: number) => {
  const ui = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await ui.resize({ columns: 60, rows: 6 })
  await ui.key({ key: ' ' })
  await ui.advance(ms)
  expect(await ui.find({ in: 'game', text: /GAME OVER/ })).toBeUndefined()
  await ui.unmount()
}

const storedBest = async ($: Engine) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await ui.resize({ columns: 60, rows: 6 })
  const hi = await ui.find({ in: 'game', text: /HI \d{5}/ })
  await ui.unmount()
  return Number(/HI (\d{5})/.exec(JSON.stringify(hi))?.[1])
}

test('a run cut off above the best score still raises it', async ($, on) => {
  world(on)
  const seed = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await seed.post({ best: 10 })
  await seed.unmount()
  await interruptedRun($, 3000)
  expect(await storedBest($)).toBeGreaterThan(10)
})

test('a run cut off long after taking the lead keeps more than its lead', async ($, on) => {
  world(on)
  const seed = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await seed.post({ best: 10 })
  await seed.unmount()
  // The lead is posted at 11; the score runs to about 27 by 6 seconds.
  await interruptedRun($, 6000)
  expect(await storedBest($)).toBeGreaterThan(20)
})

test('a run cut off below the best score leaves it as it was', async ($, on) => {
  world(on)
  const seed = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await seed.post({ best: 123 })
  await seed.unmount()
  await interruptedRun($, 3000)
  expect(await storedBest($)).toBe(123)
})

test('/wait-jump toggles the game off and on', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const offRun = await $.command.run({ command: 'wait-jump', args: '' } as never)
  expect(offRun.text).toContain('無効')
  const ui = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  expect(await ui.find({ key: 'game' })).toBeUndefined()
  await ui.unmount()
  const onRun = await $.command.run({ command: 'wait-jump', args: '' } as never)
  expect(onRun.text).toContain('有効')
})

test('a wide band draws the game framed and at most 80 columns wide', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const wide = await $.ui.mount({ plugin: 'wait-jump', surface, ...band(true, 200) })
    const frame = await wide.find({ key: 'frame' })
    expect(frame?.props.width).toBe(80)
    expect(frame?.props.borderStyle).toBe('round')
    await wide.unmount()

    const narrow = await $.ui.mount({ plugin: 'wait-jump', surface, ...band(true, 50) })
    expect((await narrow.find({ key: 'frame' }))?.props.width).toBe(50)
    await narrow.unmount()
  }
})

test('the band hides when it lacks the rows for the framed game', async ($, on) => {
  world(on)
  const short = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true, 60, 7) })
  expect(await short.find({ key: 'game' })).toBeUndefined()
  await short.unmount()
})

test('the game keeps what the mods beneath draw, with the game first', async ($, on) => {
  mock.store(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['beneath'] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'wait-jump', surface, ...band(true, 100) })
    expect(await ui.find({ key: 'game' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.indexOf('"frame"')).toBeLessThan(drawn.indexOf('beneath'))
    await ui.unmount()
  }
})

const mountBand = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await ui.resize({ columns: 60, rows: 6 })
  return ui
}

const drawnText = async (ui: Pick<Mounted, 'find'>) =>
  JSON.stringify(await ui.find({ in: 'game', text: /HI \d{5}/ }))

const scoreOf = async (ui: Pick<Mounted, 'find'>) =>
  Number(/HI \d{5} {2}(\d{5})/.exec(await drawnText(ui))?.[1])

const endTurn = ($: Engine, agentId?: string) =>
  $.turn.complete({
    answer: '',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn',
    reason: 'answer',
    ...(agentId === undefined ? {} : { agentId }),
  })

// The rows that hold an obstacle, as drawn.
const obstaclesOf = async (ui: Awaited<ReturnType<typeof mountBand>>) =>
  (await ui.findAll({ in: 'game', type: 'Text', text: /#/ })).map(row => row.text)

// Plays a run for `ms` and takes the band away mid-run, as a prompt does.
const playAndCut = async ($: Engine, ms: number) => {
  const ui = await mountBand($)
  await ui.key({ key: ' ' })
  await ui.advance(ms)
  const score = await scoreOf(ui)
  const obstacles = await obstaclesOf(ui)
  await ui.unmount()
  return { score, obstacles }
}

test('a run cut off mid-turn comes back paused with its score, then plays on', async ($, on) => {
  world(on)
  const { score, obstacles } = await playAndCut($, 3000)
  expect(score).toBeGreaterThan(0)
  expect(obstacles.length).toBeGreaterThan(0)

  const again = await mountBand($)
  expect(await again.find({ in: 'game', text: /PAUSED/ })).toBeDefined()
  expect(await scoreOf(again)).toBe(score)
  expect(await obstaclesOf(again)).toEqual(obstacles)
  await again.advance(2900)
  expect(await scoreOf(again)).toBe(score)
  await again.advance(1000)
  expect(await again.find({ in: 'game', text: /PAUSED/ })).toBeUndefined()
  expect(await scoreOf(again)).toBeGreaterThan(score)
  await again.unmount()
})

test('a key press resumes a paused run before the countdown ends', async ($, on) => {
  world(on)
  const { score } = await playAndCut($, 3000)
  const again = await mountBand($)
  await again.key({ key: ' ' })
  await again.advance(500)
  expect(await again.find({ in: 'game', text: /PAUSED/ })).toBeUndefined()
  expect(await scoreOf(again)).toBeGreaterThan(score)
  await again.unmount()
})

const pad = (n: number) => String(n).padStart(5, '0')

// The band after the turn: what the engine draws once `isWorking` is false.
const mountIdle = ($: Engine, bodyColumns = 60, maxRows = 20, hasSurvey = false) =>
  $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(false, bodyColumns, maxRows, hasSurvey) })

const resultOf = async (ui: Pick<Mounted, 'find'>) =>
  (await ui.find({ type: 'Text', text: /CLAUDE IS DONE/ }))?.text?.trim()

test('the turn end shows the result in the framed band, with no toast', async ($, on) => {
  const { toasts } = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'wait-jump', surface, ...band(true) })
    await ui.resize({ columns: 60, rows: 6 })
    await ui.key({ key: ' ' })
    await ui.advance(3000)
    const score = await scoreOf(ui)
    await endTurn($)
    // The turn's end takes `isWorking` away; the band stays up with the result.
    await ui.redraw({ ...band(false).props })
    expect(await ui.find({ key: 'game' })).toBeUndefined()
    expect((await ui.find({ key: 'frame' }))?.props.borderStyle).toBe('round')
    // The first run sets the high score; the second only ties it.
    const mark = surface === 'terminal' ? '  NEW HI' : ''
    expect(await resultOf(ui)).toBe(`CLAUDE IS DONE  SCORE ${pad(score)}${mark}`)
    expect(await ui.find({ text: new RegExp(`HI ${pad(score)} {2}${pad(score)}`) })).toBeDefined()
    await ui.unmount()
    await $.turn.start({ text: '', turnId: 'next' })
  }
  expect(toasts).toEqual([])
})

test('the result names the high score when the run fell short of it', async ($, on) => {
  world(on)
  const seed = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await seed.post({ best: 213 })
  await seed.unmount()
  const { score } = await playAndCut($, 3000)
  await endTurn($)
  const ui = await mountIdle($)
  expect(await resultOf(ui)).toBe(`CLAUDE IS DONE  SCORE ${pad(score)}`)
  expect(await ui.find({ text: new RegExp(`HI 00213 {2}${pad(score)}`) })).toBeDefined()
  await ui.unmount()
})

test('the result goes away by itself after 10 seconds', async ($, on) => {
  const { clock } = world(on)
  await playAndCut($, 3000)
  await endTurn($)
  const ui = await mountIdle($)
  await clock.advance(9900)
  expect(await resultOf(ui)).toBeDefined()
  await clock.advance(100)
  expect(await resultOf(ui)).toBeUndefined()
  expect(await ui.find({ key: 'frame' })).toBeUndefined()
  await ui.unmount()
})

test('the next turn clears the result at once and plays a fresh game', async ($, on) => {
  const { clock } = world(on)
  await playAndCut($, 3000)
  await endTurn($)
  await $.turn.start({ text: 'again', turnId: 'next' })
  const idle = await mountIdle($)
  expect(await resultOf(idle)).toBeUndefined()
  await idle.unmount()
  const next = await mountBand($)
  expect(await next.find({ in: 'game', text: /CLICK TO START/ })).toBeDefined()
  await next.unmount()
  // A short turn with no run ends before the first timer: nothing comes back.
  await clock.advance(5000)
  await endTurn($)
  await clock.advance(5000)
  const after = await mountIdle($)
  expect(await resultOf(after)).toBeUndefined()
  await after.unmount()
})

test('a later result is not cut short by the timer of an earlier one', async ($, on) => {
  const { clock } = world(on)
  await playAndCut($, 3000)
  await endTurn($)
  await clock.advance(6000)
  await $.turn.start({ text: '', turnId: 'next' })
  await playAndCut($, 3000)
  await endTurn($)
  await clock.advance(6000)
  const ui = await mountIdle($)
  expect(await resultOf(ui)).toBeDefined()
  await ui.unmount()
})

test('a turn with no run played ends with no result', async ($, on) => {
  const { toasts } = world(on)
  const ui = await mountBand($)
  await ui.advance(1000)
  await ui.unmount()
  await endTurn($)
  const idle = await mountIdle($)
  expect(await idle.find({ key: 'frame' })).toBeUndefined()
  await idle.unmount()
  expect(toasts).toEqual([])
})

test('the result yields to a survey, a short band and /wait-jump off', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await playAndCut($, 3000)
  await endTurn($)
  for (const ui of [await mountIdle($, 60, 20, true), await mountIdle($, 60, 7)]) {
    expect(await ui.find({ key: 'frame' })).toBeUndefined()
    await ui.unmount()
  }
  await $.command.run({ command: 'wait-jump', args: '' } as never)
  const off = await mountIdle($)
  expect(await off.find({ key: 'frame' })).toBeUndefined()
  await off.unmount()
})

test('the turn end settles the run: the next turn starts afresh and keeps the high score', async ($, on) => {
  world(on)
  const { score } = await playAndCut($, 3000)
  await endTurn($)
  await $.turn.start({ text: '', turnId: 'next' })
  const next = await mountBand($)
  expect(await next.find({ in: 'game', text: /CLICK TO START/ })).toBeDefined()
  expect(await drawnText(next)).toContain(`HI ${pad(score)}`)
  await next.unmount()
  expect(await storedBest($)).toBe(score)
})

test('a subagent turn end leaves the run to resume', async ($, on) => {
  const { toasts } = world(on)
  const { score } = await playAndCut($, 3000)
  await endTurn($, 'agent-1')
  expect(toasts).toEqual([])
  const idle = await mountIdle($)
  expect(await resultOf(idle)).toBeUndefined()
  await idle.unmount()
  const again = await mountBand($)
  expect(await again.find({ in: 'game', text: /PAUSED/ })).toBeDefined()
  expect(await scoreOf(again)).toBe(score)
  await again.unmount()
})

test('a band still drawn after the turn end does not carry its run into the next turn', async ($, on) => {
  world(on)
  const ui = await mountBand($)
  await ui.key({ key: ' ' })
  await ui.advance(2000)
  await endTurn($)
  await ui.advance(1000)
  await ui.unmount()
  const next = await mountBand($)
  expect(await next.find({ in: 'game', text: /CLICK TO START/ })).toBeDefined()
  await next.unmount()
})

test('a post whose game is not a game is not kept', async ($, on) => {
  const { toasts } = world(on)
  const ui = await mountBand($)
  await ui.post({ epoch: 0, game: { foo: 1 }, best: 0 })
  const game = { phase: 'playing', y: 0, vy: 0, obstacles: [], distance: 0, best: 0 }
  const rest = { nextGap: 30, overTicks: 0, resumeTicks: 0, seed: 1 }
  // JSON carries NaN and Infinity as null.
  await ui.post({ epoch: 0, game: { ...game, ...rest, score: null }, best: 0 })
  await ui.unmount()
  await endTurn($)
  const idle = await mountIdle($)
  expect(await resultOf(idle)).toBeUndefined()
  await idle.unmount()
  expect(toasts).toEqual([])
  expect(await storedBest($)).toBe(0)
})

test('a band drawn on into the next turn plays that turn afresh and settles it', async ($, on) => {
  const { toasts } = world(on)
  const ui = await mountBand($)
  await ui.key({ key: ' ' })
  await ui.advance(2000)
  await endTurn($)
  // Queued prompt: the next turn runs with the band never taken away.
  await ui.redraw()
  expect(await ui.find({ in: 'game', text: /CLICK TO START/ })).toBeDefined()
  await ui.key({ key: ' ' })
  await ui.advance(2000)
  const score = await scoreOf(ui)
  await ui.unmount()
  const again = await mountBand($)
  expect(await again.find({ in: 'game', text: /PAUSED/ })).toBeDefined()
  expect(await scoreOf(again)).toBe(score)
  await again.unmount()
  await endTurn($)
  const idle = await mountIdle($)
  expect(await resultOf(idle)).toMatch(new RegExp(`^CLAUDE IS DONE  SCORE ${pad(score)}`))
  await idle.unmount()
  expect(toasts).toEqual([])
})
