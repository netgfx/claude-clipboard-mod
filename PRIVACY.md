# Privacy

Clipboard Paste (`powermods-clipboard`) is a Claude Code mod that runs on your own machine. This statement covers what it collects, keeps and sends.

## What it collects

Nothing about you. The mod has no accounts, analytics or telemetry. It reads your system clipboard only when you run `/paste` or press paste in the band above the prompt.

## What it keeps on your machine

- **Captured clipboard images**, `data:` URIs and confirmed downloads, saved as files in `<project>/.claude/clipboard-paste/`. That folder gets a `.gitignore` of `*`, so captures don't reach git.
- **The list of items waiting for your next prompt**, held in memory for the session only.
- Files you copy in Explorer or Finder are not copied: the mod passes their paths along.

## What leaves your machine

- **Your prompt, as usual.** When you send a prompt with clipboard items, the mod adds their paths and a short note asking Claude to open them with the Read tool. That prompt goes to Anthropic like any other prompt in your session, on your own Claude plan or API key, under Anthropic's terms and privacy policy. Claude reads the files you attached.
- **Nothing else by default.** The mod makes no network requests of its own (`network.hosts` in `plugin.json` is empty).
- **Only if you turn on the `downloadUrls` option and confirm a download:** `curl` fetches the web address on your clipboard from its host. That host sees your IP address and the URL. The mod asks you first, naming the host, every time.

The mod has no server of its own.

## Retention

Captured files stay in `<project>/.claude/clipboard-paste/` until you delete them; the mod doesn't delete them. The waiting list ends with the session, or sooner with `/paste clear`.

## How to delete your data

Delete the `.claude/clipboard-paste` folder in your project, or single files in it.

## Sharing

No data is sold or shared with anyone.

## Children

The mod is a developer tool and is not directed at people under 18.

## Contact

Questions or requests: open an issue at <https://github.com/netgfx/claude-clipboard-mod/issues>.
