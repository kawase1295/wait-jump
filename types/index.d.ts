export type JumpProps = { best: number }

declare module 'claude-code' {
  interface PluginState {
    'wait-jump': { best: number; isEnabled: boolean }
  }
}
