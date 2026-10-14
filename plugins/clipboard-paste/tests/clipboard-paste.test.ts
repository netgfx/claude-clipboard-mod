import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'clipboard-paste',
  component: 'AbovePrompt',
  requestId: 'single',
  viewport: { columns: 140, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
} as const

const ENGINE_DRAWING = { type: 'Text', props: {}, children: ['drawn by Claude Code'] }

// Shared stubs. Every stub must be registered before the first call on $.
function stubs(on: any, os: 'windows' | 'posix', reader: (argv: string[]) => string, seen: { argv: string[][]; fills: any[]; toasts: string[]; submitted: any[] }) {
  mock.clock(on, { now: Date.UTC(2026, 9, 14, 12, 0, 0) })
  on('session.cwd', () => ({ value: os === 'windows' ? 'C:\\work\\app' : '/work/app' }))
  on('env.get', () => ({ value: os === 'windows' ? 'Windows_NT' : undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($: any, e: any) => {
    seen.argv.push([...e.argv])
    return { value: { exitCode: 0, stdout: reader([...e.argv]), stderr: '' } }
  })
  on('prompt.fill', ($: any, e: any) => {
    seen.fills.push(e)
    return { isFilled: true }
  })
  on('prompt.submit', ($: any, e: any) => {
    seen.submitted.push(e)
    return { text: e.text, context: e.context }
  })
  on('ui.render', () => ENGINE_DRAWING)
  on('session.start', () => ({ cwd: os === 'windows' ? 'C:\\work' : '/work' }))
}

const fresh = () => ({ argv: [] as string[][], fills: [] as any[], toasts: [] as string[], submitted: [] as any[] })

for (const os of ['windows', 'posix'] as const) {
  test('a clipboard image becomes a marker, then a path plus Read instructions (' + os + ')', async ($, on) => {
    const seen = fresh()
    const png = os === 'windows' ? 'C:\\work\\app\\.claude\\clipboard-paste\\clip-x.png' : '/work/app/.claude/clipboard-paste/clip-x.png'
    stubs(on, os, () =>
      // PowerShell may glue a CLIXML progress record in front of the JSON
      (os === 'windows' ? '#< CLIXML\n<Objs></Objs>' : '') +
        JSON.stringify({ items: [{ kind: 'image', path: png, detail: '64x32' }], reason: null, url: null }),
      seen)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'paste', args: '' } as any)

    // Right launcher, no shell string with user data in it
    if (os === 'windows') {
      expect(seen.argv[0][0]).toBe('powershell')
      expect(seen.argv[0]).toContain('-STA')
      expect(seen.argv[0]).toContain('-EncodedCommand')
    } else {
      expect(seen.argv[0][0]).toBe('/bin/sh')
      expect(seen.argv[0][4]).toBe('/work/app/.claude/clipboard-paste')
    }

    expect(seen.fills[0].text).toBe('[clip#1 clip-x.png] ')
    expect(seen.fills[0].mode).toBe('insert')
    expect(seen.toasts[0]).toMatch(/^Attached image clip-x\.png/)

    await $.prompt.submit({ text: 'what is in [clip#1 clip-x.png] ?', wait: false, origin: { kind: 'composer' } } as any)
    const sent = seen.submitted[0]
    expect(sent.text).toBe('what is in [clipboard image #1: ' + png + '] ?')
    expect(sent.context.length).toBe(1)
    expect(sent.context[0]).toContain('#1 image (image/png, 64x32): ' + png)
    expect(sent.context[0]).toContain('Read tool')

    // Nothing waits any more: the next prompt goes through untouched
    await $.prompt.submit({ text: 'thanks', wait: false, origin: { kind: 'composer' } } as any)
    expect(seen.submitted[1].context).toBeUndefined()
  })
}

test('copied files and folders are referenced in place, not copied', async ($, on) => {
  const seen = fresh()
  stubs(on, 'windows', () => JSON.stringify({
    items: [
      { kind: 'file', path: 'D:\\docs\\report.pdf', detail: '1572864' },
      { kind: 'folder', path: 'D:\\docs\\shots', detail: '' },
    ],
  }), seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
  await $.command.run({ command: 'paste', args: '' } as any)
  expect(seen.fills[0].text).toBe('[clip#1 report.pdf] [clip#2 shots] ')

  const list = await $.command.run({ command: 'paste', args: 'list' } as any)
  expect((list as any).text).toContain('#1 file (application/pdf, 1.5 MB): D:\\docs\\report.pdf')
  expect((list as any).text).toContain('#2 folder (inode/directory): D:\\docs\\shots')

  // The person deleted marker #2: only #1 goes
  await $.prompt.submit({ text: 'summarize [clip#1 report.pdf]', wait: false, origin: { kind: 'composer' } } as any)
  expect(seen.submitted[0].context[0]).toContain('report.pdf')
  expect(seen.submitted[0].context[0]).not.toContain('shots')
})

test('with no marker in the prompt, everything waiting is attached', async ($, on) => {
  const seen = fresh()
  stubs(on, 'posix', () => JSON.stringify({ items: [{ kind: 'image' }] }), seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  await $.command.run({ command: 'paste', args: '' } as any)
  await $.prompt.submit({ text: 'describe it', wait: false, origin: { kind: 'composer' } } as any)
  expect(seen.submitted[0].text).toBe('describe it')
  // Linux reader reports no path: it is <dir>/<base>.png
  expect(seen.submitted[0].context[0]).toMatch(/\/work\/app\/\.claude\/clipboard-paste\/clip-\d{8}-\d{6}-\d{3}\.png/)
})

test('slash commands and plugin prompts never consume attachments', async ($, on) => {
  const seen = fresh()
  stubs(on, 'posix', () => JSON.stringify({ items: [{ kind: 'image', path: '/x/a.png' }] }), seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  await $.command.run({ command: 'paste', args: '' } as any)
  await $.prompt.submit({ text: '/model', wait: false, origin: { kind: 'composer' } } as any)
  expect(seen.submitted[0].context).toBeUndefined()
  await $.prompt.submit({ text: 'look [clip#1 a.png]', wait: false, origin: { kind: 'composer' } } as any)
  expect(seen.submitted[1].context[0]).toContain('/x/a.png')
})

test('text on the clipboard explains itself and attaches nothing', async ($, on) => {
  const seen = fresh()
  stubs(on, 'windows', () => JSON.stringify({ items: [], reason: 'The clipboard holds text, not an image, file or media. Paste text with Ctrl+V.' }), seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
  await $.command.run({ command: 'paste', args: '' } as any)
  expect(seen.toasts[0]).toMatch(/holds text/)
  expect(seen.fills.length).toBe(0)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as any)
  expect(seen.submitted[0].context).toBeUndefined()
})

test('a copied image URL is downloaded with curl and kept only if it is media', async ($, on) => {
  const seen = fresh()
  stubs(on, 'windows', (argv) => {
    if (argv[0] === 'powershell') return JSON.stringify({ items: [], url: 'https://example.com/cat' })
    if (argv[0] === 'curl') return 'image/jpeg; charset=binary'
    return '        1 file(s) moved.'
  }, seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
  await $.command.run({ command: 'paste', args: '' } as any)
  const curl = seen.argv.find((a) => a[0] === 'curl')!
  expect(curl[curl.length - 1]).toBe('https://example.com/cat')
  expect(curl).toContain('=http,https')
  const move = seen.argv.find((a) => a[0] === 'cmd')!
  expect(move[move.length - 1]).toMatch(/\\clip-\d{8}-\d{6}-\d{3}\.jpg$/)
  expect(seen.fills[0].text).toMatch(/^\[clip#1 clip-.*\.jpg\] $/)
})

test('a copied URL that is a web page is refused', async ($, on) => {
  const seen = fresh()
  stubs(on, 'posix', (argv) => (argv[0] === '/bin/sh' ? JSON.stringify({ items: [], url: 'https://example.com/' }) : argv[0] === 'curl' ? 'text/html; charset=UTF-8' : ''), seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  await $.command.run({ command: 'paste', args: '' } as any)
  expect(seen.toasts[0]).toMatch(/text\/html, not an image/)
  expect(seen.argv.some((a) => a[0] === 'rm')).toBe(true)
})

test('the band pastes, lists and removes items in the terminal and on Desktop', async ($, on) => {
  const seen = fresh()
  stubs(on, 'windows', () => JSON.stringify({ items: [{ kind: 'image', path: 'C:\\w\\shot.png', detail: '800x600' }] }), seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as any)
    expect(await ui.find({ type: 'Text', text: 'clipboard' })).toBeDefined()
    await ui.press({ key: 'paste' })
    expect(await ui.find({ type: 'Text', text: 'clipboard ●1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'shot.png' })).toBeDefined()
    const id = surface === 'terminal' ? 1 : 2
    await ui.press({ key: 'remove-' + id })
    expect(await ui.find({ type: 'Text', text: 'clipboard' })).toBeDefined()
    await ui.unmount()
  }
  expect(seen.fills.length).toBe(2)
})

test('the band steps aside for a survey', async ($, on) => {
  const seen = fresh()
  stubs(on, 'posix', () => '', seen)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } } as any)
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

test('/paste clear empties the list', async ($, on) => {
  const seen = fresh()
  stubs(on, 'posix', () => JSON.stringify({ items: [{ kind: 'image', path: '/x/a.png' }] }), seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  await $.command.run({ command: 'paste', args: '' } as any)
  const r = await $.command.run({ command: 'paste', args: 'clear' } as any)
  expect((r as any).text).toBe('Clipboard attachments cleared.')
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as any)
  expect(seen.submitted[0].context).toBeUndefined()
})
