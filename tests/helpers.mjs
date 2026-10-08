// テストの共通部品。一時ディレクトリは tests/tmp/ の下（.gitignore 済み）
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = join(TESTS_DIR, "..");
export const TMP_BASE = join(TESTS_DIR, "tmp");

export function makeTmp(name) {
  mkdirSync(TMP_BASE, { recursive: true });
  return mkdtempSync(join(TMP_BASE, `${name}-`));
}

export function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows で開いたままのことがある。次回の削除に任せる */
  }
}

export function write(dir, name, text) {
  const p = join(dir, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text, "utf8");
  return p;
}

export function read(dir, name) {
  return readFileSync(join(dir, name), "utf8");
}

export function exists(dir, name) {
  return existsSync(join(dir, name));
}

// 出力を集める疑似ストリーム
export function sink() {
  const s = { text: "", write(chunk, cb) { s.text += String(chunk); if (typeof cb === "function") cb(); return true; }, writableLength: 0 };
  return s;
}

// 現物（この lab の PENDING_USER.md）の構造を模した合成データ。既知の答え: 未処理 3 件（P-024, P-025, P-006）・期限付き 1 件（P-006）
export const PENDING_JA = [
  "# PENDING — エージェントから人への依頼",
  "",
  "未処理: 0件 / INBOX未読: 0件 / 最終集計: -",
  "",
  "---",
  "",
  "## エージェントへ",
  "",
  "書き方の例（コードブロックの中は数えない）:",
  "",
  "```",
  "## [P-999] 例",
  "- [ ] 状態: 未処理",
  "```",
  "",
  "# 未処理",
  "",
  "## [P-024] 商品ページを置く場所を決める（Cloudflare Pages の URL）",
  "",
  "- [ ] 状態: 未処理",
  "- 分類: CHARTER §3-5",
  "- 依頼内容:",
  "  ```",
  "  A. GitHub 連携: …",
  "  ```",
  "",
  "**この項目が解けるまで棚上げする作業**",
  "- 有償版の販売開始",
  "",
  "**この項目と関係なく続行する作業**",
  "- その他すべて",
  "",
  "## [P-025] 特定商取引法に基づく表記の販売者名",
  "",
  "- [ ] 状態: 未処理",
  "",
  "## [P-006] 9/11 21:30 の CPI 測定を走らせる",
  "",
  "- [ ] 状態: 未処理",
  "- 期限: 2026-09-11 21:30 に間に合わなければ取り下げ",
  "",
  "## [P-099] 状態行が崩れている項目",
  "",
  "- [ ] 状况: 未処理",
  "",
  "---",
  "",
  "# 報告（対応不要）",
  "",
  "## [R-010] 商品 1 本目を公開しました（読むだけ・状態行を持たない）",
  "",
  "- https://www.npmjs.com/package/example",
  "- 反応の測定は 40 日後から",
  "",
  "",
  "# 解消済み",
  "",
  "## [P-023] 番人 EA を付け直す",
  "",
  "- [x] 状態: 完了（2026-09-15）",
  "",
  "## [P-022] Fable の上限",
  "",
  "- [x] 状態: 取り下げ（前提が消えた）",
  "",
  "## [P-010] チェックリスト",
  "",
  "- [X] 状態: 取り下げ（大文字 X）",
  "",
].join("\n");

export const PENDING_EN = [
  "# PENDING",
  "",
  "Open: 0 / INBOX unread: 0 / Last count: -",
  "",
  "# Open",
  "",
  "## [P-001] Buy the domain",
  "",
  "- [ ] status: open",
  "- due: 2026-09-11 21:30",
  "",
  "## [P-002] Answer a question",
  "",
  "- [ ] Status: Open",
  "",
  "# Resolved",
  "",
  "## [P-000] Done thing",
  "",
  "- [x] status: done (2026-09-10)",
  "",
].join("\n");

// 現物 INBOX.md の構造（テンプレ + 区切り + 処理済み 1 行）。既知の答え: 未読 0
export const INBOX_TEMPLATE_JA = [
  "# INBOX — 利用者からエージェントへ",
  "",
  "メモ帳で開いて、下の `---` より下に1行書くだけでよい。",
  "",
  "```",
  "書き方の例",
  "",
  "P-001 done                        依頼を完了した",
  "商品案 PDFのページを並べ替えたい    作ってほしい道具を提案する",
  "```",
  "",
  "- 何行書いてもよい。順序も問わない。行を消す必要はない",
  "",
  "---",
  "✔ PC再起動したんだけど、P-019の手順って何を起動すればいいんだっけ？",
  "",
].join("\n");
