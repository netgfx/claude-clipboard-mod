# clipboard-image-mod

A Claude Code plugin marketplace with one mod:

| Plugin | What it does |
|---|---|
| [`clipboard-paste`](plugins/clipboard-paste/README.md) | `/paste`, or `v` in the band above the prompt, attaches the image, media or files on your system clipboard to your next prompt. Works with "Copy image" in a browser, screenshots, Explorer/Finder file copies, PDFs, video/audio and image URLs. |

Requires Claude Code v2.1.287 or later (mods). Tested on v2.1.300, Windows 11.

## Install

From a local clone:

```powershell
# Windows (PowerShell)
claude plugin marketplace add D:\Projects\Projects\claude-plugins\clipboard-image-mod
claude plugin install clipboard-paste@clipboard-image-mod --scope user
```

```bash
# macOS / Linux
claude plugin marketplace add ~/path/to/clipboard-image-mod
claude plugin install clipboard-paste@clipboard-image-mod --scope user
```

From GitHub:

```bash
claude plugin marketplace add netgfx/claude-clipboard-mod
claude plugin install clipboard-paste@clipboard-image-mod --scope user
```

Inside a running session, run `/reload-plugins` after installing. `/plugin` should then show `clipboard-paste` as an active mod.

**Claude Desktop (Code tab):** install from the marketplace as above, or add the plugin folder to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`. Use absolute paths, with `;` between paths on Windows and `:` on macOS. Then start a new session.

## Layout

```text
.claude-plugin/marketplace.json     # marketplace manifest
plugins/
  clipboard-paste/
    .claude-plugin/plugin.json      # plugin manifest (bump version on each release)
    hooks/hooks.json                # { "modules": ["./register.js"] }
    hooks/register.js               # the mod
    hooks/readers.js                # Windows / macOS / Linux clipboard readers
    types/index.d.ts                # $.state declarations
    tests/clipboard-paste.test.ts   # claude plugin test
```

Add more mods under `plugins/` and list them in `.claude-plugin/marketplace.json`.
