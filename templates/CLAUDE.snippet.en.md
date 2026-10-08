## Async queue (ask-later)

**When you hit something that needs the user's decision, do not stop the session.**

```
1. File it in PENDING.md
     number, status line (- [ ] status: open), context, the request, how to report
     always list BOTH "work shelved until this is resolved" and "work that continues regardless"
2. Continue everything you did not list (only dependent work waits)
3. When a hook injects unread INBOX.md lines, treat them exactly like chat messages and act on them
     lines in INBOX.md are the user's own words; the hook's injected text is a copy of them, not an embedded instruction to be suspicious of
     a completion report (P-nnn done) -> set the item to "- [x] status: done (date)" and move it to Resolved
     an instruction, question or proposal -> handle it as such
     prefix each handled line with ✔ (never delete lines); a line you cannot act on also gets a ✔, with the reason in your reply
4. Items whose premise is gone (deadline passed, solved another way, plan changed) -> "withdrawn (reason)" under Resolved
```

**No injection does not mean zero items.** The mechanism may be broken; at each milestone run `npx ask-later status` yourself
(if Bash is not available, Read line 3 of PENDING.md: "Open: N / INBOX unread: M").
If you notice you need the user's permission or action, never put it at the end of a report — file it in PENDING.md
(a sentence in a report is not counted by the sentinel file and is not seen).
