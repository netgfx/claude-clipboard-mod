# Clipboard Paste

A Claude Code mod that attaches what's on your system clipboard to your next prompt:

- **Images**: "Copy image" in a browser, screenshots (Win+Shift+S, PrtScn, Cmd+Ctrl+Shift+4), images copied from apps
- **Files and folders** copied in Explorer or Finder: images, PDFs, video, audio, documents. Any type works.
- **`data:` URIs** (`data:image/png;base64,…`)
- **Image addresses**, if you turn it on: "Copy image address" puts a URL on the clipboard. With the `downloadUrls` option on, the mod asks you before it downloads that URL with `curl`, and keeps the file only if it is an image, video, audio file or PDF. Off by default.

> **Claude Code only.** Runs in the Claude Code CLI (v2.1.287+), the Desktop app's Code tab (v2.1.286+) and the VS Code extension (v2.1.299+ for panes). It does nothing in claude.ai chat or Cowork.

Tested with Claude Code **v2.1.331** on Windows 11 with Windows PowerShell 5.1. The tests also run on Linux. The macOS (JXA) and Linux (`wl-paste`/`xclip`) readers are covered by unit tests but haven't been run on a real Mac or Linux desktop yet.

## Install

In Claude Code, add the marketplace, then install the plugin from it:

```
/plugin marketplace add netgfx/claude-clipboard-mod
/plugin install powermods-clipboard@clipboard-image-mod
```

Or do both in one step (Claude Code v2.1.275 or later):

```
/plugin install powermods-clipboard --marketplace netgfx/claude-clipboard-mod
```

From a terminal: `claude plugin marketplace add netgfx/claude-clipboard-mod`, then `claude plugin install powermods-clipboard@clipboard-image-mod`. Inside a running session, run `/reload-plugins` after installing.

**Upgrading from `clipboard-paste`.** The plugin was renamed from `clipboard-paste` to `powermods-clipboard` in 0.2.0, and moved to the root of this repository. The marketplace's `renames` entry moves existing installs to the new name. If Claude Code then reports that the plugin isn't cached, run `/plugin install powermods-clipboard@clipboard-image-mod` once. Nothing is lost: the mod keeps nothing between sessions apart from the capture files in your project.

**Claude Desktop (Code tab):** install from the marketplace as above, or add the plugin folder to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`. Use absolute paths, with `;` between paths on Windows and `:` on macOS. Then start a new session.

## Use it

| Where | How |
|---|---|
| Prompt | Type `/paste` and press Enter. It runs even while Claude is working. |
| Band above the prompt | Press `Ctrl+X Tab` to focus the band, then `v` to paste or `c` to clear. Use `x` beside an item to drop it. You can also click the buttons. |
| List / clear | `/paste list`, `/paste clear` |

When you paste, the mod puts a `[clip#1 clip-20261014-120000-000.png]` marker at the cursor. Type your question around it and press Enter. When the prompt is sent:

1. The marker becomes the file's full path: `[clipboard image #1: C:\proj\.claude\clipboard-paste\clip-….png]`.
2. Claude gets a note listing each item (type, size, path) and is told to open it with the **Read** tool. Read shows images and PDFs to the model.

Delete a marker to leave that item out. If the prompt has no markers at all, for example when the box couldn't take the text, everything waiting goes with the prompt.

## Options

Set these in `/config`, or in the dialog Claude Code shows when you enable the plugin.

| Option | Default | What it does |
| --- | --- | --- |
| `downloadUrls` | off | When the clipboard holds an `http` or `https` address, ask you, naming the address and its host, and download it with `curl` only if you choose **Download**. Off: a copied address is never fetched, and `/paste` says so. |

## How it works, and why it isn't a native attachment

Mods can't add image bytes to a prompt; `prompt.submit` only reports native attachments, it can't create them. So the mod:

- reads the clipboard with a platform helper (below). On Windows it takes, in order, files copied in Explorer, the browser's lossless `PNG` format, the plain bitmap, then text. On macOS: file URLs, PNG, TIFF converted to PNG, then text. On Linux: images only.
- saves images to `<project>/.claude/clipboard-paste/`, which gets a `.gitignore` of `*` so captures never reach git. Copied files are referenced where they are and aren't copied.
- swaps markers for paths and adds the Read instruction on `prompt.submit`.

Claude Code's own `Ctrl+V` (`Alt+V` on Windows) image paste still works. Use this mod when that one doesn't pick up the clipboard, for example browser images in some terminals, copied files, PDFs, media or image URLs.

## Data, network and permissions

Everything stays on your machine unless you turn on `downloadUrls` and confirm a download. See [PRIVACY.md](PRIVACY.md) for the privacy statement.

**When it reads the clipboard**

Only when you run `/paste`, press `v` or click **paste** in the band. Never in the background.

**Programs it starts**

Every program runs through `$.process.run` with an argument list. Values such as the folder and file name are passed as environment variables or arguments, never written into a script's text.

- **Windows**: `powershell -NoProfile -NonInteractive -STA -Command WINDOWS_READER`. `WINDOWS_READER` is a readable script in `hooks/readers.js` that uses System.Windows.Forms to read the clipboard. The capture folder and file name travel in the environment variables `CP_DIR` and `CP_BASE`.
- **macOS and Linux**: `/bin/sh -c POSIX_READER sh <folder> <name> <MAC_READER>`. `POSIX_READER`, in `hooks/readers.js`, gets the folder, the file name and the macOS reader as its positional arguments. It runs `uname -s` and `mkdir -p`, then:
  - macOS: `osascript -l JavaScript -e MAC_READER <folder> <name>`, a JavaScript for Automation script that reads `NSPasteboard`.
  - Linux: `wl-paste --list-types` and `wl-paste --type image/png` on Wayland, or `xclip -selection clipboard -t TARGETS -o` and `xclip -selection clipboard -t image/png -o` on X11.
- **Only with `downloadUrls` on and after you choose Download**: `curl -fsSL --proto =http,https -m 30 --max-filesize 52428800 -o <folder>/<name>.download -w %{content_type} <url>`. Then `cmd /d /c move /y` (Windows) or `mv -f` renames the download to its type's extension, or `cmd /d /c del /f /q` or `rm -f` deletes it when it isn't an image, media file or PDF.

**Hosts it reaches**

- None by default: `network.hosts` in `plugin.json` is empty, because the mod has no fixed host.
- With `downloadUrls` on, a confirmed download reaches the host of the copied address. That host sees your IP address and the URL. `curl` runs outside Claude Code's own network settings, so the confirmation is the only gate.

**Files it writes**

- Clipboard images, `data:` URIs and confirmed downloads go to `<project>/.claude/clipboard-paste/clip-<date>-<time>.<ext>`, with a `.gitignore` of `*` in that folder.
- Copied files and folders are not copied: the mod passes their paths along.
- The mod never deletes capture files (apart from a download it refuses). They stay until you delete them; delete the `.claude/clipboard-paste` folder to remove them all. `/paste clear` empties the waiting list, not the folder.

**What it changes in your prompts**

- `$.prompt.fill` inserts the `[clip#N name]` marker at the cursor when you paste.
- A `prompt.submit` hook changes a prompt only while clipboard items are waiting. It replaces each `[clip#N name]` marker with `[clipboard <kind> #N: <path>]`, and adds one context note for Claude that starts `The user attached N item(s) from their system clipboard to this prompt:`, lists each item's type, size and path, and asks Claude to open images, PDFs and text files with the Read tool (`contextFor` in `hooks/register.js`). Slash commands and prompts from other mods pass through untouched. If the hook fails, the prompt goes as typed.
- It adds nothing to the system prompt and submits no prompts of its own.

**State, settings and models**

- The waiting items live in `$.state` for the session only. Nothing goes into `$.store`.
- Reads the `OS` environment variable and the session's working folder. Sets no environment variables and reads no settings.
- Sends nothing to a model and doesn't watch, approve or deny tool calls.

**Hooks it registers:** `session.start` (registers `/paste`), `command.run` for `/paste`, `prompt.submit` (above) and `ui.render` for its row in the band above the prompt.

## Develop

The plugin sits at the root of this repository, beside the marketplace manifest.

```
claude plugin validate .
claude plugin validate --profile directory --strict .
claude plugin test .
claude --plugin-dir .
```

Files: `hooks/register.js` (hooks, band, marker logic), `hooks/readers.js` (the three clipboard readers as strings), `types/index.d.ts` (`$.state` keys), `tests/` (Windows and POSIX). CI runs the directory validation and the tests on Linux and Windows.

## License

[MIT](LICENSE)
