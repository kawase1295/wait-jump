import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JumpMessage, JumpProps, JumpReady } from '../types'
import { FIELD_ROWS, isGame } from './game'
import type { Game } from './game'

const best = atom({ plugin: 'wait-jump', key: 'best' } as const, 0)
const isEnabled = atom({ plugin: 'wait-jump', key: 'isEnabled' } as const, true)
const run = atom({ plugin: 'wait-jump', key: 'run' } as const, {
  epoch: 0,
  game: null as Game | null,
})

const BEST_KEY = 'best'
const ENABLED_KEY = 'isEnabled'
const GAME_ROWS = FIELD_ROWS + 2
// The frame's border takes one row or column on each side.
const FRAME_ROWS = GAME_ROWS + 2
// A fullscreen band spans the whole terminal; past this the field is too long to play.
const MAX_COLUMNS = 80

const isObject = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null

const isMessage = (data: unknown): data is JumpMessage =>
  isObject(data) &&
  (data.hello === true ||
    (data.hello === undefined &&
      Number.isFinite(data.best) &&
      (data.game === undefined || (Number.isFinite(data.epoch) && isGame(data.game)))))

const pad = (n: number) => String(n).padStart(5, '0')

async function raiseBest($: EngineInterface, score: number) {
  if (!Number.isFinite(score) || score <= (await read($, best))) return
  await update($, best, n => Math.max(n, score))
  await $.store.set(BEST_KEY, score)
}

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
    const message = e.data
    if (!isMessage(message)) return next(e)
    // A band mounting asks for the run to resume: read here, not while
    // drawing, so the snapshot written every frame redraws nothing.
    if ('hello' in message) {
      const { epoch, game } = await read($, run)
      const props: JumpReady = {
        best: await read($, best),
        epoch,
        isReady: true,
        ...(game === null ? {} : { resume: game }),
      }
      return { props }
    }
    await raiseBest($, message.best)
    if ('game' in message) {
      // A post from a settled turn's band carries its old epoch: drop it.
      await update($, run, held =>
        held.epoch === message.epoch ? { ...held, game: message.game } : held,
      )
    }

    return {}
  })

  // A prompt mid-turn raises no turn.complete, so its run stays to resume.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // update retries its function on a missed version, so the run settled is
    // the one the winning write dropped.
    let settled: Game | null = null
    await update($, run, held => {
      settled = held.game
      return { epoch: held.epoch + 1, game: null }
    })
    const game = settled as Game | null
    if (game !== null) {
      await raiseBest($, Math.max(game.best, game.score))
      $.ui.toast(`SCORE ${pad(game.score)} / HI ${pad(await read($, best))}`)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { hasSurvey, isWorking, maxRows, bodyColumns } = e.props
    if (hasSurvey || !isWorking || maxRows < FRAME_ROWS || !(await read($, isEnabled))) {
      return next(e)
    }
    const table = $.ui.resolve(e)
    if (!('Client' in table)) return next(e)
    const { Box, Client } = table
    // Other mods beneath draw in the same band: keep theirs, below the game.
    const below = await next(e)

    return (
      <Box flexDirection="column">
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
            props={{ best: await read($, best) } satisfies JumpProps}
            width="100%"
            height={GAME_ROWS}
          />
        </Box>
        {below}
      </Box>
    )
  })
}
