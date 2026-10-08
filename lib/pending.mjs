// PENDING.md の解析。機械が読むのは 3 行だけ:
//   見出し   "## [P-003] タイトル"
//   状態行   "- [ ] 状態: 未処理" / "- [x] 状態: 完了 (2026-09-10)" / "- [x] 状態: 取り下げ（理由）"
//            英語版は "- [ ] status: open" / "- [x] status: done" / "- [x] status: withdrawn (...)"
//   期限行   "- 期限: 2026-09-11 21:30"（"- due:" / "- deadline:" も可）
//            過ぎていれば自動で「取り下げ」に書き換える。動けなくなった項目を数え続けると番兵の件数の意味が薄まるため。
// コードブロック（``` / ~~~）の中は見ない（雛形の書き方の例が項目として数えられないように）。
import { splitLines, parseLocalDateTime, formatLocal } from "./text.mjs";

const HEADING = /^\s*##\s*\[([^\]]+)\]\s*(.*)$/;
// 箇条書きの記号は - のほか * と + も可（Markdown と同じ）。### 以下の見出しは項目にならない（## だけ）
const STATUS = /^(\s*[-*+]\s*)\[([ xX])\](\s*)(状態|status)(\s*[:：]\s*)(.*)$/i;
// 状態行らしき行（チェックボックス付きの箇条書き）。これがあるのに STATUS に一致しなければ「崩れている」。
// 無ければ、その見出しは依頼ではない（例: 状態を持たない「報告」の見出し ## [R-010] …）
const CHECKBOX = /^\s*[-*+]\s*\[[^\]]*\]/;
const DEADLINE = /^\s*-\s*(期限|due|deadline)\s*[:：]\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/i;
const FENCE = /^\s*(```|~~~)/;
const HEADER_JA = /^未処理: .*$/m;
const HEADER_EN = /^Open: .*$/m;

export function parsePending(text) {
  const lines = splitLines(text ?? "");
  const items = [];
  let cur = null;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = HEADING.exec(line);
    if (h) {
      cur = {
        id: h[1].trim(),
        title: h[2].trim(),
        headingIndex: i,
        statusIndex: -1,
        hasCheckbox: false,
        open: false,
        statusKey: null,
        statusText: "",
        deadline: null,
        deadlineText: null,
      };
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    if (cur.statusIndex < 0) {
      const s = STATUS.exec(line);
      if (s) {
        cur.statusIndex = i;
        cur.open = s[2] === " ";
        cur.statusKey = s[4];
        cur.statusText = s[6].trim();
        continue;
      }
      if (CHECKBOX.test(line)) cur.hasCheckbox = true;
    }
    if (!cur.deadline) {
      const d = DEADLINE.exec(line);
      if (d) {
        const dt = parseLocalDateTime(d[2], d[3] ?? "23:59");
        if (dt) {
          cur.deadline = dt;
          cur.deadlineText = formatLocal(dt);
        }
      }
    }
  }
  return {
    lines,
    // 依頼（状態行がある、または状態行らしき行がある）
    items: items.filter((it) => it.statusIndex >= 0 || it.hasCheckbox),
    // 状態行らしき行はあるが書式が違う項目。件数に入らないので、人に知らせる
    malformed: items.filter((it) => it.statusIndex < 0 && it.hasCheckbox).map((it) => it.id),
    // 状態を持たない見出し（報告など）。数えず、警告もしない
    notes: items.filter((it) => it.statusIndex < 0 && !it.hasCheckbox).map((it) => it.id),
  };
}

export function openItems(parsed) {
  return parsed.items.filter((it) => it.statusIndex >= 0 && it.open).map(({ id, title, deadline }) => ({ id, title, deadline }));
}

// 期限切れの未処理を「取り下げ」に書き換える。返り値の lines は新しい配列（元は変えない）。items の open は更新する
export function expireDeadlines(parsed, { now = new Date() } = {}) {
  const lines = parsed.lines.slice();
  const withdrawn = [];
  for (const it of parsed.items) {
    if (it.statusIndex < 0 || !it.open || !it.deadline) continue;
    if (now.getTime() <= it.deadline.getTime()) continue;
    const m = STATUS.exec(lines[it.statusIndex]);
    const isEn = /^status$/i.test(it.statusKey);
    const body = isEn
      ? `withdrawn (deadline ${it.deadlineText} passed; automatic. Whether it was done is settled by the INBOX report)`
      : `取り下げ（期限 ${it.deadlineText} を過ぎたため自動。実施の有無は INBOX の報告で確定する）`;
    lines[it.statusIndex] = `${m[1]}[x]${m[3]}${m[4]}${m[5]}${body}`;
    it.open = false;
    it.statusText = body;
    withdrawn.push(it.id);
  }
  return { lines, withdrawn };
}

// ヘッダ行「未処理: N件 / INBOX未読: M件 / 最終集計: …」があれば更新する。無ければそのまま
export function updateHeader(text, { open, unread, now = new Date() }) {
  if (text == null) return text;
  const stamp = formatLocal(now);
  if (HEADER_JA.test(text)) return text.replace(HEADER_JA, `未処理: ${open}件 / INBOX未読: ${unread}件 / 最終集計: ${stamp}`);
  if (HEADER_EN.test(text)) return text.replace(HEADER_EN, `Open: ${open} / INBOX unread: ${unread} / Last count: ${stamp}`);
  return text;
}
