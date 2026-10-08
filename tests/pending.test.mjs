// (1) PENDING の解析: 未処理・完了・取り下げ・期限切れの自動取り下げ・崩れた状態行・英語書式
import test from "node:test";
import assert from "node:assert/strict";
import { parsePending, openItems, expireDeadlines, updateHeader } from "../lib/pending.mjs";
import { PENDING_JA, PENDING_EN } from "./helpers.mjs";

test("合成 PENDING（現物の構造）: 未処理 3 件・ID とタイトル・期限", () => {
  const p = parsePending(PENDING_JA);
  const open = openItems(p);
  assert.deepEqual(open.map((it) => it.id), ["P-024", "P-025", "P-006"]);
  assert.equal(open[0].title, "商品ページを置く場所を決める（Cloudflare Pages の URL）");
  assert.equal(open[2].deadline.getFullYear(), 2026);
  assert.equal(open[2].deadline.getMonth(), 8);
  assert.equal(open[2].deadline.getDate(), 11);
  assert.equal(open[2].deadline.getHours(), 21);
  assert.equal(open[2].deadline.getMinutes(), 30);
  assert.equal(open[0].deadline, null);
});

test("完了・取り下げ（[x] / [X]）は数えない。コードブロック内の見出しは項目にならない", () => {
  const p = parsePending(PENDING_JA);
  const ids = p.items.map((it) => it.id);
  assert.ok(!ids.includes("P-999"), "コードブロック内の例");
  assert.ok(ids.includes("P-023") && ids.includes("P-022") && ids.includes("P-010"));
  for (const id of ["P-023", "P-022", "P-010"]) assert.equal(p.items.find((it) => it.id === id).open, false, id);
});

test("状態行が崩れている項目は malformed に入り、件数に入らない", () => {
  const p = parsePending(PENDING_JA);
  assert.deepEqual(p.malformed, ["P-099"]);
  assert.ok(!openItems(p).some((it) => it.id === "P-099"));
});

test("状態行らしき行を持たない見出し（報告 ## [R-nnn]）は依頼ではない: 数えず、崩れ扱いもしない", () => {
  const p = parsePending(PENDING_JA);
  assert.deepEqual(p.notes, ["R-010"]);
  assert.ok(!p.items.some((it) => it.id === "R-010"));
  assert.ok(!p.malformed.includes("R-010"));
  assert.ok(!openItems(p).some((it) => it.id === "R-010"));
  // 状態行が後ろにあっても（先に別のチェックボックスがあっても）状態行を見つける
  const q = parsePending("## [P-1] a\n- [ ] 先に確認すること\n- [ ] 状態: 未処理\n");
  assert.deepEqual(openItems(q).map((it) => it.id), ["P-1"]);
  assert.deepEqual(q.malformed, []);
});

test("英語書式（status: / due:・大文字小文字）も解析できる", () => {
  const p = parsePending(PENDING_EN);
  assert.deepEqual(openItems(p).map((it) => it.id), ["P-001", "P-002"]);
  assert.equal(p.malformed.length, 0);
  assert.ok(openItems(p)[0].deadline);
});

test("期限切れ: 未処理で期限を過ぎた項目だけ「取り下げ」に書き換わる（行の他の部分は保つ）", () => {
  const p = parsePending(PENDING_JA);
  const before = parsePending(PENDING_JA).lines.slice();
  const r = expireDeadlines(p, { now: new Date(2026, 8, 11, 21, 31) });
  assert.deepEqual(r.withdrawn, ["P-006"]);
  const idx = p.items.find((it) => it.id === "P-006").statusIndex;
  assert.match(r.lines[idx], /^- \[x\] 状態: 取り下げ（期限 2026-09-11 21:30 を過ぎたため自動。実施の有無は INBOX の報告で確定する）$/);
  // 他の行は不変
  for (let i = 0; i < before.length; i++) if (i !== idx) assert.equal(r.lines[i], before[i], `行 ${i}`);
  // items の open も更新される
  assert.deepEqual(openItems(p).map((it) => it.id), ["P-024", "P-025"]);
  // 元の lines は変えない（新しい配列）
  assert.notEqual(r.lines, p.lines);
});

test("期限前なら何も変えない。ちょうど期限時刻も変えない", () => {
  const p = parsePending(PENDING_JA);
  assert.deepEqual(expireDeadlines(p, { now: new Date(2026, 8, 11, 21, 29) }).withdrawn, []);
  assert.deepEqual(expireDeadlines(p, { now: new Date(2026, 8, 11, 21, 30) }).withdrawn, []);
});

test("英語の状態行は英語の取り下げ文になる（ファイルの言語に合わせる）", () => {
  const p = parsePending(PENDING_EN);
  const r = expireDeadlines(p, { now: new Date(2027, 0, 1) });
  assert.deepEqual(r.withdrawn, ["P-001"]);
  const idx = p.items[0].statusIndex;
  assert.equal(r.lines[idx], "- [x] status: withdrawn (deadline 2026-09-11 21:30 passed; automatic. Whether it was done is settled by the INBOX report)");
});

test("期限の時刻が無ければその日の 23:59。存在しない日付は期限なし", () => {
  const p = parsePending("## [P-1] a\n- [ ] 状態: 未処理\n- 期限: 2026-09-11\n\n## [P-2] b\n- [ ] 状態: 未処理\n- 期限: 2026-02-31\n");
  assert.equal(openItems(p)[0].deadline.getHours(), 23);
  assert.equal(openItems(p)[0].deadline.getMinutes(), 59);
  assert.equal(openItems(p)[1].deadline, null);
});

test("ヘッダ行の更新（日本語・英語・無い）", () => {
  const now = new Date(2026, 8, 15, 20, 14);
  assert.match(updateHeader(PENDING_JA, { open: 3, unread: 1, now }), /^未処理: 3件 \/ INBOX未読: 1件 \/ 最終集計: 2026-09-15 20:14$/m);
  assert.match(updateHeader(PENDING_EN, { open: 2, unread: 0, now }), /^Open: 2 \/ INBOX unread: 0 \/ Last count: 2026-09-15 20:14$/m);
  const plain = "# nothing\n\n## [P-1] a\n- [ ] 状態: 未処理\n";
  assert.equal(updateHeader(plain, { open: 1, unread: 0, now }), plain);
  assert.equal(updateHeader(null, { open: 0, unread: 0, now }), null);
});

test("空・null・見出しだけ: 項目 0・落ちない", () => {
  for (const t of ["", null, undefined, "# PENDING\n\n---\n", "- [ ] 状態: 未処理\n"]) {
    const p = parsePending(t);
    assert.equal(p.items.length, 0);
    assert.equal(openItems(p).length, 0);
    assert.deepEqual(expireDeadlines(p).withdrawn, []);
  }
});

test("箇条書きの記号は * と + も可（設計監査 1 巡目 #15）。### の見出しは項目にならない", () => {
  const p = parsePending("## [P-1] a\n* [ ] 状態: 未処理\n\n## [P-3] c\n* [ ] 状况: 未処理\n\n## [P-2] b\n+ [x] 状態: 完了\n\n### [P-4] h3 は項目でない\n- [ ] 状態: 未処理\n");
  assert.deepEqual(openItems(p).map((it) => it.id), ["P-1"]);
  assert.deepEqual(p.malformed, ["P-3"]);
  assert.ok(!p.items.some((it) => it.id === "P-4"), "### は見出しとして数えない");
});

test("CRLF でも解析できる（行番号がずれない）", () => {
  const p = parsePending(PENDING_JA.replace(/\n/g, "\r\n"));
  assert.deepEqual(openItems(p).map((it) => it.id), ["P-024", "P-025", "P-006"]);
  assert.deepEqual(p.malformed, ["P-099"]);
});
