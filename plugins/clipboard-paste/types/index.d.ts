declare module 'claude-code' {
  interface PluginState {
    'clipboard-paste': {
      // Items read from the clipboard and waiting for the next prompt
      pending: Array<{
        id: number
        kind: 'image' | 'file' | 'folder'
        path: string
        name: string
        mediaType: string
        detail: string
      }>
      // Last id handed out, so markers stay unique within a session
      counter: number
      // One-line note shown in the band (last error or "reading…")
      note: string
    }
  }
}
