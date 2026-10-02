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
