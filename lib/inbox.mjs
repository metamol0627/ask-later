// INBOX.md の未読行。
//   区切り線 "---" より後ろの、空行・見出し・引用・既読マーク・水平線でない行を「記載」とみなす。
//   加えて、最初の見出しより前に書かれた行も「記載」とみなす（ファイルの先頭に書いてしまう実例があった。
//   テンプレートの位置に縛らない）。見出しと区切り線の間はテンプレート（書き方の例）で、読まない。
//   行頭が ✔（✓ ✅ も可）のものはエージェントが処理済みにしたもの。
//   見出しは Markdown と同じく「# の後に空白」があるときだけ（"#1 done" のような行は記載として読む）。
import { splitLines, sha256 } from "./text.mjs";

export const DONE_MARKS = ["✔", "✓", "✅"];
const HR = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^#+(\s|$)/;

export function isDone(trimmedLine) {
  return DONE_MARKS.some((m) => trimmedLine.startsWith(m));
}

export function unreadLines(text) {
  if (text == null) return [];
  const out = [];
  let afterSep = false;
  let seenHeading = false;
  for (const raw of splitLines(text)) {
    const t = raw.trim();
    if (!afterSep) {
      if (HR.test(t)) {
        afterSep = true;
        continue;
      }
      if (HEADING.test(t)) {
        seenHeading = true;
        continue;
      }
      if (seenHeading) continue;
    }
    if (t === "") continue;
    if (HEADING.test(t) || t.startsWith(">") || HR.test(t)) continue;
    if (isDone(t)) out.push({ done: true, text: t });
    else out.push({ done: false, text: t });
  }
  return out.filter((l) => !l.done).map((l) => l.text);
}

// 未読集合の署名（同じ集合には繰り返し注入しない）。空なら ""
export function signatureOf(lines) {
  return lines.length ? sha256(lines.join("\n")) : "";
}
