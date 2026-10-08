// (2) INBOX の未読抽出: ✔・引用・見出し・区切り前後・先頭記載・署名
import test from "node:test";
import assert from "node:assert/strict";
import { unreadLines, signatureOf } from "../lib/inbox.mjs";
import { INBOX_TEMPLATE_JA } from "./helpers.mjs";

test("現物の構造（テンプレ + 区切り + ✔ 済み 1 行）: 未読 0", () => {
  assert.deepEqual(unreadLines(INBOX_TEMPLATE_JA), []);
});

test("区切りの後の行が未読。空行・見出し・引用・水平線・✔ ✓ ✅ は除く", () => {
  const t = [
    "# INBOX",
    "テンプレの説明（読まない）",
    "---",
    "",
    "P-024 https://example.pages.dev",
    "✔ P-021 開けた",
    "✓ already handled",
    "✅ handled too",
    "> メモ（読まない）",
    "## 見出し（読まない）",
    "---",
    "商品案 PDF のページを並べ替えたい",
    "   前後の空白は詰める   ",
    "",
  ].join("\n");
  assert.deepEqual(unreadLines(t), ["P-024 https://example.pages.dev", "商品案 PDF のページを並べ替えたい", "前後の空白は詰める"]);
});

test("最初の見出しより前に書いた行も未読（利用者がファイルの先頭に書いた実例）", () => {
  const t = ["P-001 done", "", "# INBOX", "テンプレ", "---", "2 行目"].join("\n");
  assert.deepEqual(unreadLines(t), ["P-001 done", "2 行目"]);
});

test("見出しと区切りの間はテンプレート。区切りが無ければ見出しの後は全部読まない", () => {
  assert.deepEqual(unreadLines("# INBOX\nこれはテンプレ\n書き方の例\n"), []);
  assert.deepEqual(unreadLines("# INBOX\n---\n---\nx\n"), ["x"], "区切りが 2 本あっても水平線は数えない");
});

test("見出しは「# の後に空白」があるときだけ。「#1 done」は記載として読む（設計監査 1 巡目 #14）", () => {
  assert.deepEqual(unreadLines("# INBOX\n---\n#1 done\n#2 却下\n## 見出し\n#\n"), ["#1 done", "#2 却下"]);
  // ファイル先頭の「#1 done」も見出しではないので記載
  assert.deepEqual(unreadLines("#1 done\n# INBOX\nテンプレ\n---\n"), ["#1 done"]);
});

test("空・無い・CRLF", () => {
  assert.deepEqual(unreadLines(""), []);
  assert.deepEqual(unreadLines(null), []);
  assert.deepEqual(unreadLines(undefined), []);
  assert.deepEqual(unreadLines("# I\r\n---\r\nP-1 done\r\n"), ["P-1 done"]);
});

test("署名: 同じ集合は同じ、違えば違う、順序も含む、空は空文字", () => {
  const a = signatureOf(["x", "y"]);
  assert.equal(a, signatureOf(["x", "y"]));
  assert.notEqual(a, signatureOf(["x"]));
  assert.notEqual(a, signatureOf(["y", "x"]));
  assert.equal(signatureOf([]), "");
  assert.match(a, /^[0-9a-f]{64}$/);
});
