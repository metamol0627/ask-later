// CLI: 壊れた入力で読める文・exit 1。hook は常に exit 0。実行ファイルを子プロセスでも叩く
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../lib/cli.mjs";
import { makeTmp, cleanup, write, read, sink, PKG_DIR, PENDING_JA } from "./helpers.mjs";

const BIN = join(PKG_DIR, "bin", "ask-later.mjs");

async function cli(argv, opts = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await runCli(argv, { cwd: opts.cwd ?? PKG_DIR, stdout, stderr, stdin: opts.stdin ?? { isTTY: true }, env: opts.env ?? {} });
  return { code, out: stdout.text, err: stderr.text };
}

test("--help は 0、引数なしは usage を出して 1、--version は版", async () => {
  assert.equal((await cli(["--help"])).code, 0);
  const none = await cli([]);
  assert.equal(none.code, 1);
  assert.match(none.out, /使い方 \/ usage:/);
  const v = await cli(["--version"]);
  assert.equal(v.code, 0);
  assert.match(v.out, /^\d+\.\d+\.\d+\n$/);
});

test("知らないコマンド・無いディレクトリ・不正な --lang・値の無い --dir は、エラー 1〜2 行で exit 1（スタックトレース無し）", async () => {
  for (const argv of [["bogus"], ["status", "--dir", join("nope", "nope")], ["init", "--lang", "xx", "--dir", PKG_DIR], ["init", "--dir"], ["snippet", "--lang", "zz"]]) {
    const r = await cli(argv);
    assert.equal(r.code, 1, argv.join(" "));
    assert.match(r.err, /^エラー: /, argv.join(" "));
    assert.ok(!/at .*\.mjs:\d+/.test(r.err), `スタックトレース: ${r.err}`);
  }
});

test("status: init 前は「ありません」で exit 0。init 後は件数。--json は機械可読", async () => {
  const dir = makeTmp("clistatus");
  try {
    const before = await cli(["status", "--dir", dir]);
    assert.equal(before.code, 0);
    assert.match(before.out, /PENDING\.md がありません/);
    assert.match(before.out, /INBOX\.md がありません/);
    write(dir, "PENDING.md", PENDING_JA);
    write(dir, "INBOX.md", "# INBOX\n---\nP-024 done\n");
    const after = await cli(["status", "--dir", dir]);
    assert.equal(after.code, 0);
    assert.match(after.out, /PENDING 未処理: 2件/, "期限切れ P-006 は取り下げ");
    assert.match(after.out, /  - P-024 /);
    assert.match(after.out, /取り下げ（期限切れ・自動）: P-006/);
    assert.match(after.out, /状態行が無い項目（件数に入っていない）: P-099/);
    assert.match(after.out, /INBOX 未読: 1件\n  > P-024 done/);
    assert.match(after.out, /番兵: !pending_2\.txt/);
    const js = await cli(["status", "--dir", dir, "--json"]);
    const o = JSON.parse(js.out);
    assert.equal(o.openCount, 2);
    assert.deepEqual(o.inboxLines, ["P-024 done"]);
    assert.deepEqual(o.withdrawn, [], "2 回目は既に取り下げ済み");
    assert.deepEqual(o.errors, []);
    // --dry-run でも実在する番兵は実在として出す（設計監査 1 巡目 #11）
    const dry = await cli(["status", "--dir", dir, "--dry-run"]);
    assert.match(dry.out, /番兵: !pending_2\.txt/);
    assert.equal(JSON.parse((await cli(["status", "--dir", dir, "--json", "--dry-run"])).out).sentinel.replace(/\\/g, "/"), `${dir.replace(/\\/g, "/")}/!pending_2.txt`);
    // 番兵が無く未処理があるときの dry-run は「なし（未処理 N 件…）」（「0 件」と言わない）
    rmSync(join(dir, "!pending_2.txt"));
    assert.match((await cli(["status", "--dir", dir, "--dry-run"])).out, /番兵: なし（未処理 2 件。次の集計で作られる）/);
    assert.match((await cli(["status", "--dir", dir])).out, /番兵: !pending_2\.txt/, "書く status は作り直す");
  } finally {
    cleanup(dir);
  }
});

test("status: フック本体の写しの版を出す（古い写しは「更新」を案内。設計監査 1 巡目 #6）", async () => {
  const dir = makeTmp("clistatusver");
  try {
    await cli(["init", "--dir", dir, "--no-claude-md", "--no-gitignore"]);
    const cur = await cli(["status", "--dir", dir]);
    assert.match(cur.out, new RegExp(`^フック本体: ${JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")).version.replace(/\\./g, "\\\\.")}$`, "m"));
    write(dir, ".claude/ask-later/VERSION", "0.0.1\n");
    assert.match((await cli(["status", "--dir", dir])).out, /^フック本体: 0\.0\.1（このパッケージは \d+\.\d+\.\d+。npx ask-later@latest init で更新）$/m);
    rmSync(join(dir, ".claude/ask-later/VERSION"));
    assert.match((await cli(["status", "--dir", dir])).out, /^フック本体: 版が不明（古い写し）（このパッケージは/m);
    // フックを入れていないプロジェクトでは出さない
    await cli(["uninit", "--dir", dir]);
    assert.doesNotMatch((await cli(["status", "--dir", dir])).out, /フック本体/);
  } finally {
    cleanup(dir);
  }
});

test("init → snippet → uninit を CLI で通す。init は次にやることを案内する", async () => {
  const dir = makeTmp("cliinit");
  try {
    const r = await cli(["init", "--dir", dir]);
    assert.equal(r.code, 0);
    assert.match(r.out, /作成 \/ created:.*PENDING\.md/);
    assert.match(r.out, /作成 \/ created:.*CLAUDE\.md/);
    assert.match(r.out, /次にやること:\n  1\. CLAUDE\.md にエージェントが守る規律/);
    assert.match(r.out, /  2\. claude を起動する。INBOX\.md の `---` の下に 1 行/, "手でやる残りは起動と 30 秒の確認だけ");
    assert.match(read(dir, ".claude/settings.json"), /ask-later\/hook\.mjs/);
    assert.match(read(dir, ".claude/settings.json"), /"args": \[\n\s+"\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/ask-later\/hook\.mjs",\n\s+"Stop"/, "exec 形");
    // --no-claude-md / --no-gitignore なら、その分だけ手順を案内する
    const r0 = await cli(["init", "--dir", dir, "--no-claude-md", "--no-gitignore"]);
    assert.match(r0.out, /  1\. `npx ask-later snippet` の出力を CLAUDE\.md に貼る/);
    assert.match(r0.out, /  2\. \.gitignore に/);
    const s = await cli(["snippet"]);
    assert.equal(s.code, 0);
    assert.match(s.out, /^## 非同期キュー（ask-later）/);
    const en = await cli(["snippet", "--lang", "en"]);
    assert.match(en.out, /^## Async queue \(ask-later\)/);
    const u = await cli(["uninit", "--dir", dir]);
    assert.equal(u.code, 0);
    // init 前に settings.json は無かったので、{} を残さず消える（設計監査 2 巡目 #9）
    assert.match(u.out, /init が作ったもので他に中身が無いので消しました/);
    assert.equal(existsSync(join(dir, ".claude/settings.json")), false);
  } finally {
    cleanup(dir);
  }
});

test("hook サブコマンドは何があっても exit 0（壊れた stdin・無いイベント・無い root）", async () => {
  const dir = makeTmp("clihook");
  try {
    const fake = (text) => {
      const { Readable } = require_stream();
      return Readable.from([text]);
    };
    for (const [ev, text] of [["Bogus", "garbage"], ["Stop", "{"], ["SessionStart", ""]]) {
      const r = await cli(["hook", ev], { stdin: fake(text), env: { CLAUDE_PROJECT_DIR: dir } });
      assert.equal(r.code, 0, ev);
      assert.equal(r.err, "");
    }
    const r = await cli(["hook", "Stop"], { stdin: fake("{}"), env: { CLAUDE_PROJECT_DIR: join(dir, "nope") } });
    assert.equal(r.code, 0);
  } finally {
    cleanup(dir);
  }
});

function require_stream() {
  return { Readable: ReadableCtor };
}
import { Readable as ReadableCtor } from "node:stream";

test("実行ファイル: 引数なし exit 1・--version exit 0・hook は壊れた stdin でも exit 0 で stderr 無し", () => {
  const none = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /使い方/);
  const v = spawnSync(process.execPath, [BIN, "--version"], { encoding: "utf8" });
  assert.equal(v.status, 0);
  const dir = makeTmp("bin");
  try {
    const h = spawnSync(process.execPath, [BIN, "hook", "Stop"], { encoding: "utf8", input: "not json at all", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.equal(h.status, 0);
    assert.equal(h.stderr, "");
    assert.equal(h.stdout, "");
    // 未読があれば block の JSON が 1 行出る
    write(dir, "INBOX.md", "# I\n---\nP-1 done\n");
    const b = spawnSync(process.execPath, [BIN, "hook", "Stop"], { encoding: "utf8", input: "{}", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.equal(b.status, 0);
    assert.equal(JSON.parse(b.stdout).decision, "block");
  } finally {
    cleanup(dir);
  }
});
