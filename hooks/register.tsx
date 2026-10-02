import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { FIELD_ROWS } from './game'

const best = atom({ plugin: 'wait-jump', key: 'best' } as const, 0)
const isEnabled = atom({ plugin: 'wait-jump', key: 'isEnabled' } as const, true)

const BEST_KEY = 'best'
const ENABLED_KEY = 'isEnabled'
const GAME_ROWS = FIELD_ROWS + 2
// The frame's border takes one row or column on each side.
const FRAME_ROWS = GAME_ROWS + 2
// A fullscreen band spans the whole terminal; past this the field is too long to play.
const MAX_COLUMNS = 80

const isBestMessage = (data: unknown): data is { best: number } =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as { best?: unknown }).best === 'number'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'wait-jump',
      description: 'Toggle the Claude Jump game shown while Claude is working',
    })
    const stored = Number((await $.store.get(BEST_KEY)) ?? 0)
    await update($, best, n => Math.max(n, Number.isFinite(stored) ? stored : 0))
    const enabled = await $.store.get(ENABLED_KEY)
    if (typeof enabled === 'boolean') await update($, isEnabled, () => enabled)

    return next(e)
  })

  on('command.run', { command: 'wait-jump' }, async $ => {
    const now = !(await read($, isEnabled))
    await update($, isEnabled, () => now)
    await $.store.set(ENABLED_KEY, now)

    return {
      text: now
        ? 'Claude Jump（/wait-jump）を有効にしました。応答待ちの間、プロンプトの上に表示されます'
        : 'Claude Jump（/wait-jump）を無効にしました',
    }
  })

  on('ui.message', async ($, e, next) => {
    if (!isBestMessage(e.data)) return next(e)
    const score = e.data.best
    if (score > (await read($, best))) {
      await update($, best, n => Math.max(n, score))
      await $.store.set(BEST_KEY, score)
    }

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { hasSurvey, isWorking, maxRows, bodyColumns } = e.props
    if (hasSurvey || !isWorking || maxRows < FRAME_ROWS || !(await read($, isEnabled))) {
      return next(e)
    }
    const table = $.ui.resolve(e)
    if (!('Client' in table)) return next(e)
    const { Box, Client } = table

    return (
      <Box
        key="frame"
        borderStyle="round"
        borderDimColor
        width={Math.min(bodyColumns, MAX_COLUMNS)}
        height={FRAME_ROWS}
      >
        <Client
          key="game"
          module="./jump.tsx"
          props={{ best: await read($, best) }}
          width="100%"
          height={GAME_ROWS}
        />
      </Box>
    )
  })
}
