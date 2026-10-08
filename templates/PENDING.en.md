# PENDING — requests from the agent to a human

Open: 0 / INBOX unread: 0 / Last count: -

---

## For the human: there is only one thing to do

**When an item is done, open `INBOX.md` and write one line.** That is all.

```
P-001 done
```

- You do **not** need to edit this file. The agent maintains it
- `P-001` is the number attached to an item below
- Besides "done" you may decline, add conditions, or ask a question in free text
  (e.g. `P-001 rejected. Reason: …` / `P-002 I can answer part of this: …`)
- A file named like `!pending_2.txt` at the project root means there are open items. It disappears at 0

## For the agent

**The status line is machine-read.** Keep the format.

```
- [ ] status: open
- [x] status: done (YYYY-MM-DD)
- [x] status: withdrawn (reason)
- due: YYYY-MM-DD HH:MM          <- once passed, the item is withdrawn automatically (optional)
```

An automatically withdrawn item only gets its status line rewritten and stays under `# Open` (the machine never moves lines). Move it under `# Resolved` at your next checkpoint.

When you file an item, always list **both** "work shelved until this is resolved" and "work that continues regardless".
Shelve only what depends on the answer; keep going on the rest. Example:

```
## [P-001] Title of the request

- [ ] status: open
- filed: YYYY-MM-DD
- context: (1–3 lines so the human can recall what this is about)
- request: (what the human should do; paste commands or URLs verbatim)
- how to report: `P-001 done`

**Shelved until this is resolved**
- …

**Continues regardless**
- …
```

---

# Open

---

# Resolved
