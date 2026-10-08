// (6) 有償版のビルド部品: Markdown → HTML の既知解、ZIP の往復（書いて読んで一致）、プラグイン定義の整合
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, inline, page } from "../scripts/markdown.mjs";
import { buildZip, readZip, crc32 } from "../scripts/zip.mjs";
import { PKG_DIR } from "./helpers.mjs";

test("markdown: 見出し・段落・コード・箇条書き・表・引用・インライン", () => {
  const md = [
    "# 題名",
    "",
    "段落の **強調** と `code <b>` と [link](https://example.com/x) と [章](01-why.md#top)。",
    "",
    "```js",
    "const a = 1 < 2 && \"x\";",
    "```",
    "",
    "- 一",
    "  - 入れ子",
    "- 二",
    "",
    "1. 甲",
    "2. 乙",
    "",
    "| 列 A | 列 B |",
    "|---|---|",
    "| a | `b` |",
    "",
    "> 引用の中の **強調**",
    "",
    "## 節",
    "",
    "---",
  ].join("\n");
  const { html, toc } = render(md);
  assert.match(html, /^<h1 id="[^"]+">題名<\/h1>/);
  assert.match(html, /<p>段落の <strong>強調<\/strong> と <code>code &lt;b&gt;<\/code> と <a href="https:\/\/example\.com\/x">link<\/a> と <a href="01-why\.html#top">章<\/a>。<\/p>/);
  assert.match(html, /<pre><code class="language-js">const a = 1 &lt; 2 &amp;&amp; &quot;x&quot;;<\/code><\/pre>/);
  assert.match(html, /<ul><li>一<ul><li>入れ子<\/li><\/ul><\/li><li>二<\/li><\/ul>/);
  assert.match(html, /<ol><li>甲<\/li><li>乙<\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>列 A<\/th><th>列 B<\/th><\/tr><\/thead><tbody><tr><td>a<\/td><td><code>b<\/code><\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<blockquote><p>引用の中の <strong>強調<\/strong><\/p><\/blockquote>/);
  assert.match(html, /<hr>$/);
  assert.deepEqual(toc.map((t) => [t.level, t.text]), [[1, "題名"], [2, "節"]]);
  assert.equal(inline("a < b & `c`"), "a &lt; b &amp; <code>c</code>");
  const p = page(md, { title: "T" });
  assert.match(p, /<title>T<\/title>/);
  assert.match(p, /<nav class="toc"><ol><li><a href="#[^"]+">節<\/a><\/li><\/ol><\/nav>/);
});

test("zip: 書いて読んで一致（DEFLATE と STORE の両方・UTF-8 の名前・決定的）", () => {
  const big = "あいうえお".repeat(2000);
  const entries = [
    { name: "manual/読み方.md", data: big },
    { name: "manual/x.bin", data: Buffer.from([0, 1, 2, 3, 255]) }, // 圧縮しても縮まない → STORE
    { name: "empty.txt", data: "" },
  ];
  const zip = buildZip(entries);
  const again = buildZip(entries);
  assert.equal(zip.equals(again), true, "同じ入力なら同じバイト列");
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const back = readZip(zip);
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  assert.equal(back[0].data.toString("utf8"), big);
  assert.deepEqual([...back[1].data], [0, 1, 2, 3, 255]);
  assert.equal(back[2].data.length, 0);
  assert.ok(zip.length < Buffer.byteLength(big) / 4, "日本語の繰り返しは圧縮される");
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926, "CRC-32 の既知解");
  // 壊れた ZIP は例外（圧縮データの途中を 1 バイト反転 → inflate の失敗か CRC 不一致。中央ディレクトリの署名を壊す → 「壊れています」）
  const broken = Buffer.from(zip);
  broken[30 + Buffer.byteLength(entries[0].name) + 5] ^= 0xff;
  assert.throws(() => readZip(broken));
  const badCd = Buffer.from(zip);
  badCd.writeUInt32LE(0, badCd.readUInt32LE(badCd.length - 22 + 16));
  assert.throws(() => readZip(badCd), /壊れています/);
  assert.throws(() => readZip(Buffer.from("not a zip")), /終端/);
});

test("プラグイン定義: plugin.json と hooks.json が package.json と整合し、5 イベントが exec 形で bin を指す", () => {
  const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(PKG_DIR, ".claude-plugin", "plugin.json"), "utf8"));
  const hooks = JSON.parse(readFileSync(join(PKG_DIR, "hooks", "hooks.json"), "utf8"));
  assert.equal(plugin.name, pkg.name);
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.hooks, "./hooks/hooks.json");
  const events = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"];
  assert.deepEqual(Object.keys(hooks.hooks), events);
  for (const ev of events) {
    const h = hooks.hooks[ev][0].hooks[0];
    assert.equal(h.type, "command");
    assert.equal(h.command, "node");
    assert.deepEqual(h.args, ["${CLAUDE_PLUGIN_ROOT}/bin/ask-later.mjs", "hook", ev]);
    assert.ok(h.timeout >= 15);
  }
  // 約束の文言: 「終了させない」「Claude Code 等」を書かない（設計監査 1 巡目 #1）
  for (const d of [pkg.description, plugin.description]) {
    assert.doesNotMatch(d, /終了させない|refuses to stop|cannot finish|Claude Code 等|Claude Code など/);
  }
  for (const f of ["bin/", "lib/", "templates/", "hooks/", ".claude-plugin/", "README.md", "README.en.md", "docs/field-log.md", "docs/manual-free/", "LICENSE"]) {
    assert.ok(pkg.files.includes(f), `package.json files に ${f}`);
  }
});

test("docs/manual-free/（npm に同梱する生成物）が原稿と同期している（build:manual を忘れていない）", () => {
  const same = (a, b) => assert.equal(readFileSync(join(PKG_DIR, a), "utf8"), readFileSync(join(PKG_DIR, b), "utf8"), `${a} と ${b} が違う。npm run build:manual を実行する`);
  same("docs/manual-free/01-why-it-stops.md", "manual/01-why-it-stops.md");
  same("docs/manual-free/README.md", "manual/free-README.md");
  same("docs/manual-free/templates/PENDING.md", "templates/PENDING.ja.md");
  same("docs/manual-free/templates/INBOX.md", "templates/INBOX.ja.md");
  same("docs/manual-free/templates/CLAUDE.snippet.md", "templates/CLAUDE.snippet.ja.md");
  same("docs/manual-free/templates/settings.hooks.json", "manual/templates/settings.hooks.json");
});
