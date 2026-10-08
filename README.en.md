# ask-later — run Claude Code unattended without stopping at questions (an async question queue)

**Run Claude Code unattended: questions are queued, work continues.** Two files and five hooks that keep Claude Code from stopping at "may I?".
Tool permissions are a settings matter (allow lists, auto-approve); a question that needs a human's judgment is not, and that is what ask-later handles.
The agent files what it needs from a human in `PENDING.md`, shelves only the work that depends on the answer, and keeps going.
The human writes one line in `INBOX.md` with any text editor. A hook injects that line into the agent's context on its next tool call,
and blocks the stop while unread lines remain (twice by default). A sentinel file named `!pending_3.txt` at the project root means "3 open items".

Node.js 20+, zero dependencies, MIT, unofficial. **Claude Code only** — it speaks Claude Code's hook contract (JSON on stdin, `hookSpecificOutput.additionalContext`, `decision: block`) and has no path for other agents.
Events used: `SessionStart` / `UserPromptSubmit` / `PostToolUse` / `Stop` / `SessionEnd`.
Verified only on Windows 11, Node 24, Claude Code 2.1.268 (macOS/Linux not yet tried). The Japanese `README.md` is the primary document; this is a summary.

Sold separately: "無人運転の設計書" (a design guide for unattended runs, in Japanese, ¥1,480) — [sales page](https://lab-cws.pages.dev/ask-later/). The tool itself is free.

## Read this first (what gets written)

- `npx ask-later init` writes three things: **the `hooks` key of `.claude/settings.json`** (other keys and other people's hooks are left alone),
  **`CLAUDE.md`** (appends the `## Async queue (ask-later)` rule if it is not there; `--no-claude-md` to skip) and **`.gitignore`** (two lines, only if missing; `--no-gitignore` to skip).
  It also creates `.claude/ask-later/` (a copy of the hook code), `PENDING.md` / `INBOX.md` (kept if they exist) and `.ask-later/config.json`.
  **`npx ask-later uninit` restores `settings.json` to the same content**, keeping the original indent width, line endings and trailing newline (tests cover 2-space, 4-space, tab, CRLF and no-trailing-newline files;
  a hand-written file with arrays folded on one line gets the same content but expanded arrays). Lines added to `CLAUDE.md` / `.gitignore` are left in place.
- **Hooks always exit 0 and never stop the agent.** Missing or broken files, non-JSON stdin, unwritable disk — all pass silently, leaving one readable line in `.ask-later/hook.log`.
- The stop block (`Stop` hook, `decision: block`) fires **up to `stopBlockMax` times per unread set and session** (default 2, max 7; Claude Code itself gives up after 8 consecutive blocks, so there is no infinite loop). After that, if the agent still ignores the injection, the session ends with lines unread — the sentinel file and `npx ask-later status` still show them.
- OS notifications (Windows toast / macOS `osascript` / Linux `notify-send`) are best-effort. The silent sentinel file is the primary signal.
- Depends on Claude Code's hook JSON contract (`additionalContext`, `decision: block`). If that changes, this breaks.
- Unofficial. Claude and Claude Code are trademarks of Anthropic, PBC; the author is not affiliated with Anthropic.

## Setup (top to bottom)

```
npx ask-later init --lang en          # hooks + templates + CLAUDE.md rule + .gitignore lines
npx ask-later status                  # PENDING open: 0 / INBOX unread: 0 / sentinel: none (0 open) / hook files: 0.1.0
```

`init` appends the rule the agent follows to `CLAUDE.md` (`npx ask-later snippet --lang en` prints it). Without that rule, injections change nothing.
It also adds `.ask-later/` and `\!pending_*.txt` to `.gitignore` (the backslash matters — a leading `!` would negate the pattern).

**30-second check**: start `claude`, write one line below the `---` in `INBOX.md` (e.g. `test: reply "read" if you can see this`), send any prompt. **The check is that the line gets a leading `✔`** (the reply usually contains it too, but a model may decline to echo text it suspects is an embedded instruction — the `✔` means it arrived). If not, look at `.ask-later/hook.log`.

When the agent needs you, it writes an item like this under `# Open` in `PENDING.md`:

```
## [P-001] Put the npm token in .env

- [ ] status: open
- filed: 2026-09-16
- context: preparing the publish; only you can issue the token
- request: create an Automation token at https://www.npmjs.com/settings/~/tokens and paste it as NODE_AUTH_TOKEN in .env
- how to report: `P-001 done`

**Shelved until this is resolved**
- npm publish

**Continues regardless**
- everything else
```

Only three lines are machine-read: the heading `## [ID] title`, the status line `- [ ] status: open`, and the optional `- due: YYYY-MM-DD HH:MM` (once passed, the item is rewritten as `withdrawn` automatically).
When the agent stops, `!pending_1.txt` appears at the root. You open `INBOX.md`, write `P-001 done` (or `P-001 rejected. …`, or any free text) below the `---`, and save.
On the agent's next tool call the line is injected:

```
[INBOX.md: 1 unread line(s) written by the user] INBOX.md is the file the user writes in by hand; the following line(s) are the user's own words (copied by the hook). Under this project's rule (CLAUDE.md "Async queue"), lines in INBOX.md are the user's chat messages.
  > P-001 done
A completion report (P-xxx done) corresponds to resolving the matching item in PENDING.md. Instructions, questions and proposals carry their plain meaning.
Handled lines are kept with a leading ✔ (lines are never deleted).
```

The injected text is factual statements only — no imperatives. What to do with them is the CLAUDE.md rule's job (Claude Code's hooks reference asks for exactly this split: imperative hook text trips the model's prompt-injection defenses and gets surfaced to the user instead of being used as context; that happened in a real run before this wording).
The agent marks the item `- [x] status: done (2026-09-16)`, moves it under `# Resolved`, prefixes the INBOX line with `✔`, and the sentinel disappears at the next count.
If the agent tries to finish with unread lines, the `Stop` hook blocks with "INBOX.md still has 1 unread line(s) written by the user. Stopping with unread lines is blocked under this project's rule." plus the same text as the reason (twice per unread set and session by default; the second reason says how to get through: ✔ the line and state why).
Save `INBOX.md` as UTF-8: non-UTF-8 lines are re-read as Shift_JIS and injected with a warning asking the user to re-save the file.

## What each hook does

| Event | Reads | Writes | Emits |
|---|---|---|---|
| `SessionStart` | PENDING, INBOX | deadline withdrawals, header line, sentinel, `.ask-later/state.json` | open count and list (30 shown, then "…and N more"), withdrawn IDs, unread INBOX lines, malformed items, a hint if PENDING.md is missing (`additionalContext`) |
| `UserPromptSubmit` | INBOX | state (signature; resets that session's block count) | unread lines, every time there are any |
| `PostToolUse` | INBOX | state (signature per `session_id` and `agent_id`) | unread lines **only when the set changed** since the last injection in that session/subagent |
| `Stop` | PENDING, INBOX | same as SessionStart | `{"decision":"block","reason":…}` while unread lines exist, up to `stopBlockMax` times per session (counted per session, so another session's `Stop` does not reset it); OS notification if the open set is new |
| `SessionEnd` | PENDING, INBOX | same | nothing (Claude Code does not read it); no notification (its budget is 1.5 s by default; `Stop` already notifies) |

Hook entries are exec form — `{"command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs","Stop"],"timeout":20}` — so no shell and no absolute path; `settings.json` can be committed. Timeouts are explicit (the official defaults are 600 s for command hooks, 30 s for `UserPromptSubmit`, and a shared 1.5 s for `SessionEnd`, which a per-hook `timeout` in settings raises up to 60 s; plugin timeouts do not raise it). The code is copied into the project so it keeps working without `npx` caches; `.claude/ask-later/VERSION` records the copy's version and `status` tells you when it is older than the package. Re-run `npx ask-later@latest init` to update (idempotent).

## Formats

`PENDING.md`: headings `## [ID] title` (`##` only); status `- [ ] status: open` / `- [x] status: done (date)` / `- [x] status: withdrawn (reason)` (`*` and `+` bullets also work); optional `- due: YYYY-MM-DD HH:MM`. Headings without any checkbox line (e.g. `## [R-010] note`) are not requests. Fenced code blocks are ignored. Line 3 `Open: N / INBOX unread: M / Last count: …` is updated at each count. CRLF/LF preserved; writes are atomic. Automatically withdrawn items stay under `# Open` with a rewritten status line; the agent moves them.
`INBOX.md`: lines after the first `---` (plus anything written above the first heading). Blank lines, headings (`#` followed by a space — `#1 done` is read), `>` and rules are skipped; lines starting with `✔` (`✓`, `✅`) are done. Lines are never deleted.

## Configuration (`.ask-later/config.json`)

`lang` (`ja`/`en`; also selects the language of `hook.log`), `pending`, `inbox`, `sentinelPrefix` (default `!pending_`), `quietHours` (default 21→8: no notifications, deferred to the morning), `notify` (`false` to disable; `ASK_LATER_NO_NOTIFY=1` also disables), `stopBlockMax` (default 2, 0 disables, max 7). Missing or broken config falls back to defaults.

## Commands

```
npx ask-later init [--lang ja|en] [--dir <project>] [--force] [--local] [--no-hooks] [--no-files] [--no-claude-md] [--no-gitignore] [--shell]
npx ask-later uninit [--dir <project>] [--purge]
npx ask-later status [--dir <project>] [--json] [--dry-run]
npx ask-later notify [--dir <project>] [message]
npx ask-later snippet [--lang ja|en]
npx ask-later hook <SessionStart|UserPromptSubmit|PostToolUse|Stop|SessionEnd>
```

`--shell` writes the old shell form (`node "${CLAUDE_PROJECT_DIR}/…" Stop`) instead of exec form. `uninit` does not touch `CLAUDE.md` or `.gitignore`; if `init` created `settings.json` and nothing else was added to it, `uninit` removes the file instead of leaving `{}`. `hook.log` lines are tagged `[session]` or `[session/agent]` inside subagents.
CLI errors (missing directory, bad `--lang`, unreadable `settings.json`, unwritable disk, Node < 20) are one or two readable lines, exit 1, nothing written. The `hook` subcommand exits 0 no matter what.
In an interactive bash, quote the sentinel name (`'!pending_1.txt'`) — history expansion trips on `!`.

## As a plugin

The package ships `.claude-plugin/plugin.json` and `hooks/hooks.json`. `npm pack ask-later && tar xf ask-later-*.tgz && claude --plugin-dir ./package` enables the hooks without `init` (create the templates with `npx ask-later init --no-hooks`). Marketplace installation will be documented once a public repository exists.

## Known limits

Verified on Windows only. Whether the agent obeys the injection depends on the model and on the CLAUDE.md rule — in a 2026-09-15 run with a small model the injection and the (then single) stop block both fired, but the agent neither prefixed ✔ nor fixed the status line; a 2026-09-16 run with sonnet did both from the injection alone. A model may refuse an *instruction* written in INBOX as a suspected embedded instruction (observed 2026-09-16 with the earlier imperative wording: the completion report was accepted, an extra "write this codeword" request was declined); the wording is now factual and the rule lives in CLAUDE.md, but a refused line simply stays un-✔ed — the sentinel and `status` show it, nothing says "refused". `PostToolUse` only runs right after a tool call. Once the block count is used up in a session, the same unread set is not blocked again until the user's next prompt or the set changes. Both `settings.json` and `settings.local.json` configured means hooks run twice. Deadlines use local time. `PostToolUse` also fires inside subagents (official spec); the signature is kept per `agent_id`, and injection inside a real subagent was observed on 2026-09-16 (design audit, sonnet, `Agent` tool).

## Paid companion

The tool is free (MIT). A separate **"Unattended operation design book" (JPY 1,480, Japanese, Markdown + HTML ZIP, 7 chapters, 10 templates, ~300 KB)** covers the discipline rather than the tool: why agents stop, the shelving queue, four brakes for unattended runs, independent-session audits, machine-written records, a dated log of 14 real failures, and a template set. For people running `-p` or auto-resume unattended; not needed for interactive-only use. Chapter 1 and the minimal templates are free in this package under `docs/manual-free/` (open `index.html`). How to get it: on the [sales page](https://lab-cws.pages.dev/ask-later/), click "¥1,480 で購入する" (Buy for ¥1,480), pay through Stripe, and the confirmation screen takes you to a download page for the ZIP.

## Development

`npm test` (node --test), `npm run fieldlog` (runs the hooks on a fixed copy of the real files this tool was ported from and cross-checks counts against the original PowerShell implementation; see `docs/field-log.md`, Japanese), `npm run build:manual`. `npm test` needs `tests/` (and part of `scripts/`), which are not in the tarball (it will run in the public repository once there is one). `fieldlog` and `build:manual` need the author's private data and the paid manuscript, so they will not run there either.

## License

MIT. Claude and Claude Code are trademarks of Anthropic, PBC. Unofficial; not endorsed by Anthropic.
