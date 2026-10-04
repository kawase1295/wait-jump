# wait-jump

[![ci](https://github.com/kawase1295/wait-jump/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kawase1295/wait-jump/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code 2.1.287+](https://img.shields.io/badge/Claude%20Code-2.1.287%2B-D97757)](https://claude.com/claude-code)

**Claude Jump**: a tiny jump game for Claude Code, in the spirit of the browser's offline dino. While Claude is working, a band above the prompt lets you jump `✻` over bugs (`#`) until the answer lands.

![Claude Jump: jumping bugs in the band above the prompt while Claude works](docs/demo.gif)

```
✻ Claude Jump                                  HI 00213  00087


     ✻
                     #                    ##
──────────────────────────────────────────────────────────────
```

## Install

```
/plugin marketplace add kawase1295/wait-jump
/plugin install wait-jump@wait-jump
```

The plugin is installed over HTTPS from the released `main` branch. To move to a newer release later, refresh the catalog and then update the plugin, and restart Claude Code:

```
/plugin marketplace update wait-jump
claude plugin update wait-jump@wait-jump
```

## Play

- The band appears only while a turn is running. A permission prompt or a question from Claude hides it; after you answer, the run comes back paused and plays on after a 3-second countdown (or a key press). When Claude is done, the run is settled and the band stays up for about 10 seconds with `CLAUDE IS DONE  SCORE xxxxx` in the field (and `NEW HI` when the run set the high score); it takes no keys, and goes away at once when the next turn starts. A turn with no run played shows no result.
- Click the band to give it the keyboard, then press **Space**, **Up**, **Enter**, `w` or `k` (or click again) to jump. **Esc** hands the keys back to the prompt.
- The game speeds up as your score grows. The high score is kept across sessions.
- `/wait-jump` turns the game off and on (remembered across sessions).

The game is framed and drawn at most 80 columns wide, so a fullscreen band does not stretch it across the terminal. It needs 8 rows; on a shorter terminal it stays hidden.

## Requirements

- Claude Code with function-hook mods (2.1.287 or later). The mod API is in early access and may change between releases.
- A surface that draws `Client` regions: the terminal or the desktop app.

## How it works

- `hooks/game.ts` is the pure game: physics, collisions, obstacle spawning and the frame as colored rows. It owns no clock or input, so it is tested directly.
- `hooks/jump.tsx` is the `Client` surface module on the drawing thread: a 50 ms frame clock, key and pointer input, and a post of each change of the game (with the best score) to the hooks module.
- `hooks/register.tsx` draws the `AbovePrompt` band while `isWorking`, keeps the last run in `$.state` to resume it when the band mounts again, settles it on the main loop's `turn.complete` and keeps the result drawn in the band until a `$.clock` timer or the next `turn.start` clears it, stores the high score and the on/off switch in `$.store`, and registers `/wait-jump`.

The plugin is named `wait-jump` because plugin names starting with `claude-` are reserved; the game itself is still called Claude Jump.

## Development

```
scripts/check   # claude plugin validate . && claude plugin test .
```

## License

MIT
