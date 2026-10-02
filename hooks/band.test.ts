import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The world beneath the plugin: an in-memory store, an empty band and the
// engine's bare answers to the calls the plugin makes.
const world = (on: On) => {
  mock.store(on)
  on('ui.render', () => ({ type: 'Box' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
}

const band = (isWorking: boolean, bodyColumns = 60, maxRows = 20) => ({
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
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
  }
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
// as a permission prompt or the turn's end does.
const interruptedRun = async ($: Parameters<Parameters<typeof test>[1]>[0], ms: number) => {
  const ui = await $.ui.mount({ plugin: 'wait-jump', surface: 'terminal', ...band(true) })
  await ui.resize({ columns: 60, rows: 6 })
  await ui.key({ key: ' ' })
  await ui.advance(ms)
  expect(await ui.find({ in: 'game', text: /GAME OVER/ })).toBeUndefined()
  await ui.unmount()
}

const storedBest = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
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
