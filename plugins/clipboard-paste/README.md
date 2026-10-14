# clipboard-paste

A Claude Code mod that attaches what's on your system clipboard to your next prompt:

- **Images**: "Copy image" in a browser, screenshots (Win+Shift+S, PrtScn, Cmd+Ctrl+Shift+4), images copied from apps
- **Files and folders** copied in Explorer or Finder: images, PDFs, video, audio, documents. Any type works.
- **Image addresses**: "Copy image address" puts a URL on the clipboard. The mod downloads it with `curl` and keeps it only if it is an image, video, audio file or PDF.
- **`data:` URIs** (`data:image/png;base64,…`)

Tested with Claude Code **v2.1.300** on Windows 11. The macOS (JXA) and Linux (`wl-paste`/`xclip`) readers are covered by unit tests but haven't been run on a real Mac or Linux machine yet.

## Use it

| Where | How |
|---|---|
| Prompt | Type `/paste` and press Enter. It runs even while Claude is working. |
| Band above the prompt | Press `Ctrl+X Tab` to focus the band, then `v` to paste or `c` to clear. Use `x` beside an item to drop it. You can also click the buttons. |
| List / clear | `/paste list`, `/paste clear` |

When you paste, the mod puts a `[clip#1 clip-20261014-120000-000.png]` marker at the cursor. Type your question around it and press Enter. When the prompt is sent:

1. The marker becomes the file's full path: `[clipboard image #1: C:\proj\.claude\clipboard-paste\clip-….png]`.
2. Claude gets a hidden note listing each item (type, size, path) and is told to open it with the **Read** tool. Read shows images and PDFs to the model.

Delete a marker to leave that item out. If the prompt has no markers at all, for example when the box couldn't take the text, everything waiting goes with the prompt.

## How it works, and why it isn't a native attachment

Mods can't add image bytes to a prompt; `prompt.submit` only reports native attachments, it can't create them. So the mod:

- reads the clipboard with a platform helper through `$.process.run`:
  - Windows: `powershell -STA -EncodedCommand …` (System.Windows.Forms). It prefers the browser's lossless `PNG` format, then the plain bitmap, then file lists, then text.
  - macOS: `osascript -l JavaScript` with the AppKit bridge (`NSPasteboard`: file URLs, PNG, TIFF→PNG, text)
  - Linux: `wl-paste` (Wayland) or `xclip` (X11), images only
- saves images to `<project>/.claude/clipboard-paste/`, which gets a `.gitignore` of `*` so captures never reach git. Copied files are referenced where they are and aren't copied.
- swaps markers for paths and adds the Read instruction on `prompt.submit`.

Claude Code's own `Ctrl+V` (`Alt+V` on Windows) image paste still works. Use this mod when that one doesn't pick up the clipboard, for example browser images in some terminals, copied files, PDFs, media or image URLs.

## What the mod calls

`claude plugin validate` reports these calls:

- `$.process.run`: `powershell` (Windows) or `/bin/sh` → `osascript`/`wl-paste`/`xclip` (macOS/Linux) to read the clipboard. `curl` to download a copied image URL (http/https only, max 50 MB, 30 s). `cmd /c move`/`del` or `mv`/`rm` to rename or discard that download.
- `$.prompt.fill` puts the marker in the prompt box.
- `$.state` holds the waiting items.
- `$.session.cwd`, `$.env.get('OS')` and `$.clock.now` detect the platform, find the capture folder and name files.

Nothing is uploaded anywhere. The only network access is the `curl` download, and it runs only when you paste a URL.

## Develop

```powershell
# Windows (PowerShell)
claude plugin validate .\plugins\clipboard-paste --strict
Set-Location .\plugins\clipboard-paste; claude plugin test
claude --plugin-dir .\plugins\clipboard-paste
```

```bash
# macOS / Linux
claude plugin validate ./plugins/clipboard-paste --strict
(cd plugins/clipboard-paste && claude plugin test)
claude --plugin-dir ./plugins/clipboard-paste
```

Files: `hooks/register.js` (hooks, band, marker logic), `hooks/readers.js` (the three clipboard readers as strings), `types/index.d.ts` (`$.state` keys), `tests/` (11 tests, Windows and POSIX).
