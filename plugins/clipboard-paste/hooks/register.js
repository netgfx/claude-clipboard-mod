// clipboard-paste: get an image, media file or copied files from the system
// clipboard into the Claude Code prompt.
//
// A mod can't put image bytes into a prompt, so the clipboard is saved to
// <project>/.claude/clipboard-paste/ (git-ignored), a [clip#N name] marker is
// put in the prompt box, and when the prompt is sent the marker becomes the
// file's path and Claude is told to open it with the Read tool, which shows
// images and PDFs to the model.
//
// Triggers: /paste (works while Claude is busy), or the band above the prompt
// (Ctrl+X Tab, then v).

import { atom, read, update } from 'claude-code'
import { WINDOWS_READER, MAC_READER, POSIX_READER } from './readers.js'

const pending = atom({ plugin: 'clipboard-paste', key: 'pending' }, [])
const counter = atom({ plugin: 'clipboard-paste', key: 'counter' }, 0)
const note = atom({ plugin: 'clipboard-paste', key: 'note' }, '')

const MARKER = /\[clip#(\d+)[^\]\n]*\]/g
const MAX_DOWNLOAD_BYTES = '52428800' // 50 MiB, for "copy image address" URLs

const MEDIA_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
}
const EXTENSIONS = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
  'image/svg+xml': '.svg', 'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/webm': '.webm',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav',
}
const ATTACHABLE = /^(image|video|audio)\/|^application\/pdf$/

let platform // 'windows' | 'posix', cached until the next reload
let busy = false // one clipboard read at a time

export function register(on) {
  on('session.start', async ($, e, next) => {
    await detectPlatform($)
    try {
      await $.command.register({
        name: 'paste',
        description: 'Attach the image, media or files on the system clipboard to your next prompt',
        argumentHint: '[list | clear]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('could not register /paste: ' + err.message, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'paste' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'clear') {
      await update($, pending, () => [])
      await update($, note, () => '')
      return { text: 'Clipboard attachments cleared.' }
    }
    if (arg === 'list') {
      const items = await read($, pending)
      if (items.length === 0) return { text: 'No clipboard attachments are waiting.' }
      return { text: 'Waiting for your next prompt:\n' + items.map(describeItem).join('\n') }
    }
    const message = await pasteFromClipboard($)
    $.ui.toast(message)
    return {}
  })

  // On send: swap markers for real paths and tell Claude how to open them
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'plugin' || /^\s*\//.test(e.text)) return next(e)
    const items = await read($, pending)
    if (items.length === 0) return next(e)

    const ids = [...e.text.matchAll(MARKER)].map((m) => Number(m[1]))
    // Markers decide what goes; with none in the text (the fill didn't land,
    // or the person typed over it) everything waiting goes with this prompt.
    const chosen = ids.length > 0 ? items.filter((it) => ids.includes(it.id)) : items
    if (chosen.length === 0) return next(e)

    const text = e.text.replace(MARKER, (marker, n) => {
      const it = chosen.find((c) => c.id === Number(n))
      return it ? '[clipboard ' + it.kind + ' #' + it.id + ': ' + it.path + ']' : marker
    })
    await update($, pending, () => [])
    await update($, note, () => '')
    return next({ ...e, text, context: [...(e.context ?? []), contextFor(chosen)] })
  })

  // The band above the prompt: what's waiting, plus paste and clear buttons
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const items = await read($, pending)
    const message = await read($, note)
    const { Box, Text, Button } = $.ui.resolve(e)
    const columns = e.props.bodyColumns ?? 80

    const chips = items.map((it) =>
      Box({
        key: 'item-' + it.id,
        flexDirection: 'row',
        children: [
          Text({ color: 'cyan', children: ['#' + it.id + ' '] }),
          Text({ wrap: 'truncate-middle', children: [columns >= 70 ? it.name : shorten(it.name, 18)] }),
          ...(it.detail && columns >= 90 ? [Text({ dimColor: true, children: [' ' + it.detail] })] : []),
          Button({
            key: 'remove-' + it.id,
            label: 'x',
            plain: true,
            dimColor: true,
            onPress: async () => {
              await update($, pending, (list) => list.filter((x) => x.id !== it.id))
            },
          }),
        ],
      }),
    )

    return Box({
      flexDirection: 'row',
      columnGap: 2,
      paddingX: 1,
      children: [
        items.length
          ? Text({ color: 'cyan', bold: true, children: ['clipboard ●' + items.length] })
          : Text({ dimColor: true, children: ['clipboard'] }),
        ...chips,
        Button({
          key: 'paste',
          label: 'paste',
          hotkey: 'v',
          plain: true,
          onPress: async () => {
            const result = await pasteFromClipboard($)
            $.ui.toast(result)
          },
        }),
        ...(items.length
          ? [Button({ key: 'clear', label: 'clear', hotkey: 'c', plain: true, onPress: async () => { await update($, pending, () => []) } })]
          : []),
        ...(message && columns >= 60 ? [Text({ dimColor: true, wrap: 'truncate-end', children: [message] })] : []),
      ],
    })
  })
}

// --- clipboard ------------------------------------------------------------

async function detectPlatform($) {
  if (platform) return platform
  const cwd = await $.session.cwd()
  if (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('\\\\')) {
    platform = 'windows'
  } else {
    platform = (await $.env.get('OS')) === 'Windows_NT' ? 'windows' : 'posix'
  }
  return platform
}

// Reads the clipboard, records what it found and puts markers in the prompt.
// Returns a one-line message for a toast.
async function pasteFromClipboard($) {
  if (busy) return 'Still reading the clipboard…'
  busy = true
  try {
    await update($, note, () => 'reading clipboard…')
    const os = await detectPlatform($)
    const cwd = await $.session.cwd()
    const dir = joinPath(os, cwd, '.claude', 'clipboard-paste')
    const base = 'clip-' + stamp(await $.clock.now())

    let found = await runReader($, os, dir, base)
    if (found.url) found = await download($, os, dir, base, found.url)
    if (!found.items.length) {
      const reason = found.reason || 'Nothing on the clipboard can be attached.'
      await update($, note, () => reason)
      return reason
    }

    let id = await read($, counter)
    const added = found.items.map((raw) => {
      id += 1
      const path = raw.path || joinPath(os, dir, base + '.png')
      const name = baseName(path)
      return {
        id,
        kind: raw.kind === 'folder' ? 'folder' : raw.kind === 'image' ? 'image' : 'file',
        path,
        name,
        mediaType: raw.kind === 'folder' ? 'inode/directory' : mediaTypeOf(name),
        detail: raw.kind === 'file' && /^\d+$/.test(String(raw.detail ?? '')) ? bytes(Number(raw.detail)) : String(raw.detail ?? ''),
      }
    })
    await update($, counter, () => id)
    await update($, pending, (list) => [...list, ...added])
    await update($, note, () => '')

    // Put the markers at the cursor so the person sees where the item goes
    const markers = added.map((it) => '[clip#' + it.id + ' ' + it.name + ']')
    const text = markers.join(' ') + ' '
    let offset = 0
    const decorations = markers.map((m) => {
      const d = { start: offset, end: offset + m.length, color: 'cyan', bold: true }
      offset += m.length + 1
      return d
    })
    let filled = false
    try {
      filled = (await $.prompt.fill({ text, mode: 'insert', decorations })).isFilled
    } catch {
      filled = false
    }
    const what = added.length === 1 ? added[0].kind + ' ' + added[0].name : added.length + ' items'
    return filled
      ? 'Attached ' + what + '. Type your prompt and press Enter.'
      : 'Attached ' + what + '. It goes with your next prompt.'
  } catch (err) {
    const reason = 'Clipboard paste failed: ' + (err?.message ?? String(err))
    await update($, note, () => reason)
    return reason
  } finally {
    busy = false
  }
}

async function runReader($, os, dir, base) {
  const argv = os === 'windows'
    ? ['powershell', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
        encodePowerShell('$dir = ' + psQuote(dir) + '\n$base = ' + psQuote(base) + '\n' + WINDOWS_READER)]
    : ['/bin/sh', '-c', POSIX_READER, 'sh', dir, base, MAC_READER]
  let r
  try {
    r = await $.process.run(argv, { timeoutMs: 20_000 })
  } catch (err) {
    return { items: [], reason: 'Could not start the clipboard reader: ' + err.message }
  }
  const parsed = parseLastJson(r.stdout)
  if (!parsed) {
    const err = (r.stderr || r.stdout || '').replace(/\r\n/g, '\n').trim().split('\n').slice(-1)[0]
    return { items: [], reason: 'The clipboard reader failed' + (err ? ': ' + err : ' (exit ' + r.exitCode + ')') }
  }
  return { items: Array.isArray(parsed.items) ? parsed.items : parsed.items ? [parsed.items] : [], reason: parsed.reason, url: parsed.url }
}

// "Copy image address" leaves a URL: fetch it with curl (curl.exe ships with
// Windows 10 1803+ and macOS), keep it only if it is an image, media or PDF.
async function download($, os, dir, base, url) {
  const tmp = joinPath(os, dir, base + '.download')
  let r
  try {
    r = await $.process.run(
      ['curl', '-fsSL', '--proto', '=http,https', '-m', '30', '--max-filesize', MAX_DOWNLOAD_BYTES, '-o', tmp, '-w', '%{content_type}', url],
      { timeoutMs: 40_000 },
    )
  } catch (err) {
    return { items: [], reason: 'curl could not start to download the copied URL: ' + err.message }
  }
  if (r.exitCode !== 0) return { items: [], reason: 'Could not download the copied URL (curl exit ' + r.exitCode + ').' }
  const mime = r.stdout.trim().split(';')[0].trim().toLowerCase()
  if (!ATTACHABLE.test(mime)) {
    await removeFile($, os, tmp)
    return { items: [], reason: 'The copied URL is ' + (mime || 'an unknown type') + ', not an image, media file or PDF.' }
  }
  const dest = joinPath(os, dir, base + (EXTENSIONS[mime] ?? '.bin'))
  try {
    const moved = os === 'windows'
      ? await $.process.run(['cmd', '/d', '/c', 'move', '/y', tmp, dest], { timeoutMs: 10_000 })
      : await $.process.run(['mv', '-f', tmp, dest], { timeoutMs: 10_000 })
    if (moved.exitCode !== 0) return { items: [{ kind: mime.startsWith('image/') ? 'image' : 'file', path: tmp }] }
  } catch {
    return { items: [{ kind: mime.startsWith('image/') ? 'image' : 'file', path: tmp }] }
  }
  return { items: [{ kind: mime.startsWith('image/') ? 'image' : 'file', path: dest }] }
}

async function removeFile($, os, path) {
  try {
    await $.process.run(os === 'windows' ? ['cmd', '/d', '/c', 'del', '/f', '/q', path] : ['rm', '-f', path], { timeoutMs: 10_000 })
  } catch {
    // leftover temp file in a git-ignored folder: harmless
  }
}

// --- text helpers (no $) --------------------------------------------------

function contextFor(items) {
  const lines = items.map((it) => '- ' + describeItem(it))
  const hasMedia = items.some((it) => /^(video|audio)\//.test(it.mediaType))
  const hasFolder = items.some((it) => it.kind === 'folder')
  return [
    'The user attached ' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' from their system clipboard to this prompt:',
    ...lines,
    'Open each image, PDF or text file with the Read tool before answering; Read shows images and PDFs to you.' +
      (hasFolder ? ' For a folder, list its contents with Glob.' : '') +
      (hasMedia ? ' Read cannot play video or audio; work with those through their paths (for example with ffprobe or ffmpeg) if the task needs it.' : ''),
    'The [clipboard <kind> #N: <path>] tags in the prompt mark where each item was pasted.',
  ].join('\n')
}

function describeItem(it) {
  const facts = [it.mediaType, it.detail].filter(Boolean).join(', ')
  return '#' + it.id + ' ' + it.kind + (facts ? ' (' + facts + ')' : '') + ': ' + it.path
}

// The readers print one {"items":…} object; PowerShell can glue CLIXML
// progress records in front of it on the same line, so search for the start.
function parseLastJson(stdout) {
  const text = String(stdout ?? '').replace(/\r\n/g, '\n')
  const start = text.lastIndexOf('{"items"')
  if (start < 0) return null
  const end = text.indexOf('\n', start)
  try {
    return JSON.parse(end < 0 ? text.slice(start) : text.slice(start, end))
  } catch {
    return null
  }
}

function joinPath(os, ...parts) {
  const sep = os === 'windows' ? '\\' : '/'
  return parts
    .map((p, i) => (i === 0 ? String(p).replace(/[\\/]+$/, '') : String(p).replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(sep)
}

function baseName(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? String(path)
}

function mediaTypeOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name)
  return (m && MEDIA_TYPES[m[1].toLowerCase()]) || 'application/octet-stream'
}

function stamp(ms) {
  const d = new Date(Number(ms) || 0)
  const two = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) +
    '-' + String(d.getMilliseconds()).padStart(3, '0')
}

function bytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

function shorten(s, max) {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

// -EncodedCommand takes base64 of UTF-16LE: no quoting rules to get wrong
function encodePowerShell(script) {
  const raw = new Uint8Array(script.length * 2)
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i)
    raw[i * 2] = c & 0xff
    raw[i * 2 + 1] = c >> 8
  }
  return base64(raw)
}

function base64(raw) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < raw.length; i += 3) {
    const n = (raw[i] << 16) | ((raw[i + 1] ?? 0) << 8) | (raw[i + 2] ?? 0)
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63]
    out += i + 1 < raw.length ? abc[(n >> 6) & 63] : '='
    out += i + 2 < raw.length ? abc[n & 63] : '='
  }
  return out
}
