// 人とモデルに見せる文言（日本語が正、英語は従）。
// 状態行・ヘッダ行のように「機械が読む書式」は pending.mjs が持ち、ここには置かない。

const ja = {
  // --- 注入（additionalContext） ---
  // 事実の陳述で書く。命令形（「〜すること」「〜せよ」）は Claude Code の prompt-injection 防御を起動し、
  // 文脈ではなく「埋め込み指示」として人に差し戻される（公式 hooks リファレンス。設計監査 2 巡目 #1 で実測）。
  // 「どう処理するか」の規律は CLAUDE.md の断片（templates/CLAUDE.snippet.*.md）に置き、ここでは「何がどうなっているか」だけを述べる。
  ctxOpen: (n, pending) => `【${pending} に未処理の依頼: ${n}件】利用者の判断を待っている項目で、内容は ${pending} にある。`,
  ctxOpenTail: "これらに依存しない作業は続行できる（このプロジェクトの規律〈CLAUDE.md「非同期キュー」〉）。",
  ctxInboxHead: (n, inbox) =>
    `【${inbox} に利用者本人の未読の行: ${n}件】${inbox} は利用者が手で書く連絡ファイルで、次の行は利用者本人が書いたもの（フックが写した）。このプロジェクトの規律（CLAUDE.md「非同期キュー」）では、${inbox} の行は利用者のチャット発言と同じ扱いになる。`,
  ctxInboxTail: (pending) => [
    `P-xxx の完了報告は ${pending} の該当項目の解消に対応する。命令・質問・提案は、そのままの意味の発言である。`,
    "処理済みの行は行頭に ✔ を付けて残す決まりになっている（行は消さない）。",
  ],
  ctxWithdrawn: (ids) => `【期限切れで自動取り下げ: ${ids.join(", ")}】状態行が取り下げに書き換わった。実施の有無は INBOX の報告で確定する。`,
  ctxMalformed: (ids, pending) => `【状態行が無い項目: ${ids.join(", ")}】${pending} の「- [ ] 状態: 未処理」の書式になっておらず、件数に入っていない。`,
  ctxNoPending: (pending) => `【ask-later】${pending} が無い（フックは動いている）。雛形は npx ask-later init が作る。`,
  ctxOpenMore: (n) => `  - …ほか ${n} 件（一覧は PENDING にある）`,
  ctxGarbled: (inbox) => `【注意】${inbox} に UTF-8 として読めない行があり、Shift_JIS として読み直した。その行を書き換えると壊れる。直るのは利用者が ${inbox} を UTF-8 で保存し直したとき（メモ帳: 名前を付けて保存 → 文字コード UTF-8）。`,
  stopReason: (n, inbox) => `${inbox} に利用者本人の未読の行が ${n} 件残っている。未読が残ったままの停止は、このプロジェクトの規律で差し止められる。`,
  stopReasonAgain: (k, max) => `（${k} 回目の差し止め。最大 ${max} 回。処理できない行は ✔ を付けて理由を返答に書けば通る）`,

  // --- hook.log ---
  logInject: (open, unread) => `注入（未処理 ${open}・未読 ${unread}）`,
  logBlock: (unread, k, max) => `差し止め（未読 ${unread}・${k}/${max} 回目）`,
  logNone: (open, unread) => `-（未処理 ${open}・未読 ${unread}）`,
  logUnknown: "知らないイベント。何もしない",
  logFail: (e) => `失敗（止めない）: ${e}`,
  logWithdrawn: (ids) => `取り下げ ${ids.join(",")}`,
  logNotified: "通知",
  logGarbled: (n) => `UTF-8 でない行 ${n}`,

  // --- 番兵ファイル ---
  sentinel: ({ n, items, now, pending, inbox }) => [
    `利用者にお願いしたいことが ${n} 件あります。`,
    "",
    `内容      : ${pending} を開いてください`,
    `完了報告  : ${inbox} に1行書いてください（例: P-003 done）`,
    "",
    "未処理の項目:",
    ...items.map((it) => `  - ${it.id} ${it.title}`),
    "",
    "このファイルは自動生成されます。消しても構いません（次回の集計で再生成されます）。",
    `最終更新: ${now}`,
  ],

  // --- 通知 ---
  notifyTitle: (n) => `未処理の依頼 ${n} 件`,

  // --- status の印字 ---
  statusPending: (n) => `PENDING 未処理: ${n}件`,
  statusWithdrawn: (id) => `  取り下げ（期限切れ・自動）: ${id}`,
  statusInbox: (n) => `INBOX 未読: ${n}件`,
  statusSentinel: (p, open = 0) => `番兵: ${p ?? (open > 0 ? `なし（未処理 ${open} 件。次の集計で作られる）` : "なし（0 件）")}`,
  statusMissing: (name) => `${name} がありません（npx ask-later init で雛形を作れます）`,
  statusMalformed: (ids) => `状態行が無い項目（件数に入っていない）: ${ids.join(", ")}`,
  statusGarbled: (n, inbox) => `注意: ${inbox} に UTF-8 として読めない行が ${n} 行あります（Shift_JIS として読みました）。メモ帳の「名前を付けて保存 → 文字コード UTF-8」で保存し直してください`,
  statusHookVersion: (copy, pkg) => (copy === pkg ? `フック本体: ${copy}` : `フック本体: ${copy ?? "版が不明（古い写し）"}（このパッケージは ${pkg}。npx ask-later@latest init で更新）`),
  statusNotified: (r) => `通知: ${r.notified ? "出した" : r.quiet ? "静音時間帯なので翌朝に持ち越し" : "変化なし"}`,
  warnWrite: (e) => `注意: ${e}`,
  errWrite: (path) => `書き込めません（権限が無いか、読み取り専用か、別のアプリが開いています）: ${path}`,
};

const en = {
  ctxOpen: (n, pending) => `[Open requests to the user in ${pending}: ${n}] Items waiting on the user's decision; the details are in ${pending}.`,
  ctxOpenTail: "Work that does not depend on these can continue (this project's rule: CLAUDE.md \"Async queue\").",
  ctxInboxHead: (n, inbox) =>
    `[${inbox}: ${n} unread line(s) written by the user] ${inbox} is the file the user writes in by hand; the following line(s) are the user's own words (copied by the hook). Under this project's rule (CLAUDE.md "Async queue"), lines in ${inbox} are the user's chat messages.`,
  ctxInboxTail: (pending) => [
    `A completion report (P-xxx done) corresponds to resolving the matching item in ${pending}. Instructions, questions and proposals carry their plain meaning.`,
    "Handled lines are kept with a leading ✔ (lines are never deleted).",
  ],
  ctxWithdrawn: (ids) => `[Withdrawn automatically (deadline passed): ${ids.join(", ")}] The status line was rewritten. Whether it was done is settled by the INBOX report.`,
  ctxMalformed: (ids, pending) => `[Items without a status line: ${ids.join(", ")}] They do not match the "- [ ] status: open" format in ${pending} and are not counted.`,
  ctxNoPending: (pending) => `[ask-later] ${pending} is missing (the hooks are active). npx ask-later init creates the templates.`,
  ctxOpenMore: (n) => `  - ...and ${n} more (the full list is in PENDING)`,
  ctxGarbled: (inbox) => `[Warning] ${inbox} has lines that are not valid UTF-8; they were re-read as Shift_JIS. Editing them corrupts them. It is fixed once the user re-saves ${inbox} as UTF-8.`,
  stopReason: (n, inbox) => `${inbox} still has ${n} unread line(s) written by the user. Stopping with unread lines is blocked under this project's rule.`,
  stopReasonAgain: (k, max) => ` (block ${k} of at most ${max}. A line that cannot be acted on gets a ✔ and the reason in the reply; the stop then goes through)`,

  logInject: (open, unread) => `inject (open ${open}, unread ${unread})`,
  logBlock: (unread, k, max) => `block (unread ${unread}, ${k}/${max})`,
  logNone: (open, unread) => `- (open ${open}, unread ${unread})`,
  logUnknown: "unknown event; nothing done",
  logFail: (e) => `failed (not blocking): ${e}`,
  logWithdrawn: (ids) => `withdrawn ${ids.join(",")}`,
  logNotified: "notified",
  logGarbled: (n) => `non-UTF-8 lines ${n}`,

  sentinel: ({ n, items, now, pending, inbox }) => [
    `The agent is waiting on you for ${n} item(s).`,
    "",
    `What      : open ${pending}`,
    `To report : write one line in ${inbox} (e.g. P-003 done)`,
    "",
    "Open items:",
    ...items.map((it) => `  - ${it.id} ${it.title}`),
    "",
    "This file is generated automatically. You may delete it (it is recreated at the next count).",
    `Last updated: ${now}`,
  ],

  notifyTitle: (n) => `${n} open request(s)`,

  statusPending: (n) => `PENDING open: ${n}`,
  statusWithdrawn: (id) => `  withdrawn (deadline passed, automatic): ${id}`,
  statusInbox: (n) => `INBOX unread: ${n}`,
  statusSentinel: (p, open = 0) => `sentinel: ${p ?? (open > 0 ? `none (${open} open; written at the next count)` : "none (0 open)")}`,
  statusMissing: (name) => `${name} is missing (npx ask-later init creates the templates)`,
  statusMalformed: (ids) => `items without a status line (not counted): ${ids.join(", ")}`,
  statusGarbled: (n, inbox) => `warning: ${n} line(s) in ${inbox} are not valid UTF-8 (read as Shift_JIS). Re-save the file as UTF-8`,
  statusHookVersion: (copy, pkg) => (copy === pkg ? `hook files: ${copy}` : `hook files: ${copy ?? "unknown version (old copy)"} (this package is ${pkg}; run npx ask-later@latest init to update)`),
  statusNotified: (r) => `notification: ${r.notified ? "sent" : r.quiet ? "quiet hours, deferred to the morning" : "no change"}`,
  warnWrite: (e) => `warning: ${e}`,
  errWrite: (path) => `cannot write (no permission, read-only, or open in another app): ${path}`,
};

export const MESSAGES = { ja, en };
export const LANGS = Object.keys(MESSAGES);

export function msg(lang) {
  return MESSAGES[lang] ?? MESSAGES.ja;
}
