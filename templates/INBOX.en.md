# INBOX — from the human to the agent

Open this in any text editor and write one line below the `---`. You do not need to start the agent.
**Whatever you write here is treated like a chat message** — it is injected into the agent's context right after
its next tool call (even mid-run), and a hook blocks the stop while unread lines remain (twice by default; whether the agent complies is up to the agent).
Save this file as UTF-8.

```
Examples

P-001 done                        the request is done (number from PENDING.md)
P-001 done https://example.com    done, with the result
P-001 rejected. Not for now       you decided not to do it
P-002 The Excel copy step is tedious   free-text answer
Change of plan: …                 a note without a number is fine too
```

- Write as many lines as you like, in any order. Never delete lines
- **Lines the agent has read get a leading `✔`.** If it is there, it was read
- Lines starting with `>` or a heading `# ` (hash + space) are ignored (use them for notes). A line like `#1 done` is read

---
