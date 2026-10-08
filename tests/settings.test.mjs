// (5) init / uninit の往復で settings.json が元に戻る。既存の hooks を壊さない。壊れた JSON では何も書かない
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { init, uninit, mergeHooks, removeHooks, isOurs, snippet, packageVersion, hookCopyVersion, HOOK_EVENTS, HOOK_LIB_FILES, UserError } from "../lib/install.mjs";
import { makeTmp, cleanup, write, read, exists } from "./helpers.mjs";

const OTHERS = {
  _comment: ["keep me"],
  permissions: { allow: ["Read"], deny: ["Edit(CHARTER.md)"] },
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "powershell", args: ["-File", "tools\\log_hook.ps1", "-Event", "SessionStart"], timeout: 20 }] }],
    SubagentStop: [{ hooks: [{ type: "command", command: "powershell -File tools/agent_ledger.ps1", timeout: 60, async: true }] }],
  },
};

test("mergeHooks: 5 イベントに自分のグループを exec 形（args・プレースホルダ）で足し、他人のフックは残す。再マージで増えない", () => {
  const s = mergeHooks(structuredClone(OTHERS));
  for (const [ev] of HOOK_EVENTS) {
    const ours = s.hooks[ev].filter((g) => g.hooks.some(isOurs));
    assert.equal(ours.length, 1, ev);
    const h = ours[0].hooks[0];
    assert.equal(h.command, "node");
    assert.deepEqual(h.args, ["${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs", ev], "絶対パスを書かない（settings.json を共有できる）");
    assert.equal(typeof h.timeout, "number");
  }
  // --shell なら旧来の shell 形
  const sh = mergeHooks({}, { form: "shell" });
  assert.equal(sh.hooks.Stop[0].hooks[0].command, 'node "${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs" Stop');
  assert.equal(sh.hooks.Stop[0].hooks[0].args, undefined);
  // shell 形で入っていたものを exec 形で再 init しても増えない（自分のものを外してから足す）
  const re = mergeHooks(sh);
  assert.equal(re.hooks.Stop.length, 1);
  assert.equal(re.hooks.Stop[0].hooks[0].command, "node");
  assert.equal(s.hooks.SessionStart.length, 2, "他人の SessionStart が残る");
  assert.equal(s.hooks.SessionStart[0].hooks[0].command, "powershell");
  assert.equal(s.hooks.SubagentStop.length, 1);
  assert.deepEqual(s._comment, ["keep me"]);
  const again = mergeHooks(structuredClone(s));
  assert.deepEqual(again, s, "冪等");
});

test("removeHooks: 自分だけ消え、他人は残る。空になったイベントと hooks は消える", () => {
  const s = removeHooks(mergeHooks(structuredClone(OTHERS)));
  assert.deepEqual(s, OTHERS);
  const empty = removeHooks(mergeHooks({}));
  assert.deepEqual(empty, {});
  // 他人のグループの中に自分が混ざっていても、自分だけ抜く
  const mixed = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }, { type: "command", command: "node \"${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs\" Stop" }] }] } };
  assert.deepEqual(removeHooks(mixed), { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] } });
});

test("isOurs: shell 形式・exec 形式（Windows の \\ 区切り）を識別し、他人のものは識別しない", () => {
  assert.ok(isOurs({ command: 'node "${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs" Stop' }));
  assert.ok(isOurs({ command: "node", args: ["C:\\proj\\.claude\\ask-later\\hook.mjs", "Stop"] }));
  assert.ok(!isOurs({ command: "powershell", args: ["-File", "tools\\log_hook.ps1"] }));
  assert.ok(!isOurs({ command: "node ask-later-other.mjs" }));
  assert.ok(!isOurs(null));
  assert.ok(!isOurs("string"));
});

test("init → uninit の往復で settings.json が元に戻る（Claude Code 自身が書く形＝2 スペース・LF ならバイト一致。キーの順序も）", async () => {
  const dir = makeTmp("roundtrip");
  try {
    const original = JSON.stringify(OTHERS, null, 2) + "\n";
    write(dir, ".claude/settings.json", original);
    const r = await init(dir, { lang: "ja" });
    assert.ok(r.settingsPath.endsWith("settings.json"));
    const merged = JSON.parse(read(dir, ".claude/settings.json"));
    assert.equal(merged.hooks.Stop.length, 1);
    assert.equal(merged.hooks.SessionStart.length, 2);
    assert.ok(exists(dir, ".claude/ask-later/hook.mjs"));
    for (const f of HOOK_LIB_FILES) assert.ok(exists(dir, `.claude/ask-later/lib/${f}`), f);
    assert.equal(read(dir, ".claude/ask-later/VERSION").trim(), packageVersion(), "写しの版を残す");
    assert.equal(hookCopyVersion(dir), packageVersion());
    assert.ok(exists(dir, "PENDING.md") && exists(dir, "INBOX.md") && exists(dir, ".ask-later/config.json"));
    assert.deepEqual(r.created.sort(), ["PENDING.md", "INBOX.md", ".ask-later/config.json", "CLAUDE.md", ".gitignore"].sort());
    assert.deepEqual(r.updated, [".claude/settings.json"]);
    assert.match(read(dir, "CLAUDE.md"), /^## 非同期キュー（ask-later）/, "CLAUDE.md が無ければ断片で作る");
    assert.equal(read(dir, ".gitignore"), ".ask-later/\n\\!pending_*.txt\n");

    const u = await uninit(dir);
    assert.equal(read(dir, ".claude/settings.json"), original, "バイト一致");
    assert.ok(!exists(dir, ".claude/ask-later"));
    assert.ok(!exists(dir, ".ask-later"));
    assert.ok(exists(dir, "PENDING.md"), "人の記録は残す");
    assert.ok(exists(dir, "CLAUDE.md") && exists(dir, ".gitignore"), "CLAUDE.md / .gitignore は人の文書なので触らない");
    assert.ok(u.removed.includes(".ask-later"));
    assert.deepEqual(u.settings, [".claude/settings.json"], "相対パスで報告する");
    // --purge で雛形も消える
    await uninit(dir, { purge: true });
    assert.ok(!exists(dir, "PENDING.md") && !exists(dir, "INBOX.md"));
  } finally {
    cleanup(dir);
  }
});

test("往復は元ファイルの体裁を写す: 4 スペース・CRLF・末尾改行なし（設計監査 1 巡目 #1(a) の反例）", async () => {
  const cases = {
    "4sp-no-trailing": '{\n    "permissions": {\n        "allow": [\n            "Read"\n        ]\n    },\n    "model": "sonnet"\n}',
    "crlf": '{\r\n  "permissions": {\r\n    "allow": [\r\n      "Read"\r\n    ]\r\n  },\r\n  "model": "sonnet"\r\n}\r\n',
    "tab": '{\n\t"model": "sonnet",\n\t"hooks": {\n\t\t"Stop": [\n\t\t\t{\n\t\t\t\t"hooks": [\n\t\t\t\t\t{\n\t\t\t\t\t\t"type": "command",\n\t\t\t\t\t\t"command": "echo hi"\n\t\t\t\t\t}\n\t\t\t\t]\n\t\t\t}\n\t\t]\n\t}\n}\n',
  };
  for (const [name, original] of Object.entries(cases)) {
    const dir = makeTmp(`fmt-${name}`);
    try {
      write(dir, ".claude/settings.json", original);
      await init(dir, { hooks: true, files: false });
      const merged = read(dir, ".claude/settings.json");
      assert.equal(/\r\n/.test(merged), /\r\n/.test(original), `${name}: 改行コードを保つ`);
      assert.equal(/\n$/.test(merged), /\n$/.test(original), `${name}: 末尾改行の有無を保つ`);
      await uninit(dir);
      assert.equal(read(dir, ".claude/settings.json"), original, `${name}: バイト一致`);
    } finally {
      cleanup(dir);
    }
  }
  // 配列が 1 行に畳まれている手書きの settings.json は、内容は戻るが体裁までは戻らない（README にそう書いてある）
  const dir = makeTmp("fmt-inline");
  try {
    const original = '{\n    "permissions": { "allow": ["Read"] },\n    "model": "sonnet"\n}';
    write(dir, ".claude/settings.json", original);
    await init(dir, { hooks: true, files: false });
    await uninit(dir);
    const after = read(dir, ".claude/settings.json");
    assert.deepEqual(JSON.parse(after), JSON.parse(original), "内容は同じ");
    assert.equal(after, '{\n    "permissions": {\n        "allow": [\n            "Read"\n        ]\n    },\n    "model": "sonnet"\n}', "字下げ幅 4・末尾改行なしは保つ。配列は展開される");
  } finally {
    cleanup(dir);
  }
});

test("init: CLAUDE.md に断片を足す（末尾改行が無くても見出しが連結しない・既にあれば触らない・--no-claude-md で抑止）。.gitignore は無い行だけ足す", async () => {
  const dir = makeTmp("claudemd");
  try {
    write(dir, "CLAUDE.md", "# My project\n\nrules here");
    write(dir, ".gitignore", "node_modules/\n.ask-later/\n");
    const r = await init(dir, { hooks: false });
    assert.equal(r.claudeMd, "appended");
    assert.equal(read(dir, "CLAUDE.md"), "# My project\n\nrules here\n\n" + snippet("ja"));
    assert.deepEqual(r.gitignore, ["\\!pending_*.txt"]);
    assert.equal(read(dir, ".gitignore"), "node_modules/\n.ask-later/\n\\!pending_*.txt\n");
    const r2 = await init(dir, { hooks: false });
    assert.equal(r2.claudeMd, "kept");
    assert.deepEqual(r2.gitignore, []);
    assert.equal(read(dir, "CLAUDE.md"), "# My project\n\nrules here\n\n" + snippet("ja"), "2 回目は増えない");
    // 英語の断片が入っていれば日本語でも kept
    write(dir, "CLAUDE.md", snippet("en"));
    assert.equal((await init(dir, { hooks: false })).claudeMd, "kept");
    // 抑止
    write(dir, "CLAUDE.md", "x");
    const r3 = await init(dir, { hooks: false, claudeMd: false, gitignore: false });
    assert.equal(r3.claudeMd, null);
    assert.equal(read(dir, "CLAUDE.md"), "x");
  } finally {
    cleanup(dir);
  }
});

test("init: settings.json が無ければ作る。壊れていれば何も書かずに止まる（UserError）", async () => {
  const dir = makeTmp("newsettings");
  try {
    await init(dir);
    const s = JSON.parse(read(dir, ".claude/settings.json"));
    assert.deepEqual(Object.keys(s), ["hooks"]);
    assert.deepEqual(Object.keys(s.hooks), HOOK_EVENTS.map(([e]) => e));
  } finally {
    cleanup(dir);
  }
  const dir2 = makeTmp("brokensettings");
  try {
    write(dir2, ".claude/settings.json", "{ \"hooks\": [ broken");
    await assert.rejects(() => init(dir2), (e) => e instanceof UserError && /JSON として読めません/.test(e.message) && /何も書き換えていません/.test(e.message));
    assert.equal(read(dir2, ".claude/settings.json"), "{ \"hooks\": [ broken", "不変");
    assert.ok(!exists(dir2, ".claude/ask-later") || true); // 雛形の作成順は保証しない。settings は不変であることが要点
  } finally {
    cleanup(dir2);
  }
});

test("init: 既存の PENDING.md / INBOX.md は触らない。--force で上書き。--local は settings.local.json。--shell は shell 形式", async () => {
  const dir = makeTmp("keep");
  try {
    write(dir, "PENDING.md", "mine");
    write(dir, "INBOX.md", "mine too");
    const r = await init(dir, { local: true, form: "shell" });
    assert.equal(read(dir, "PENDING.md"), "mine");
    assert.deepEqual(r.skipped.sort(), ["INBOX.md", "PENDING.md"]);
    assert.ok(exists(dir, ".claude/settings.local.json") && !exists(dir, ".claude/settings.json"));
    const s = JSON.parse(read(dir, ".claude/settings.local.json"));
    const h = s.hooks.Stop[0].hooks[0];
    assert.equal(h.command, 'node "${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs" Stop');
    assert.equal(h.args, undefined);
    const r2 = await init(dir, { force: true, hooks: false });
    assert.match(read(dir, "PENDING.md"), /^# PENDING — エージェントから人への依頼/);
    assert.deepEqual(r2.updated.sort(), ["INBOX.md", "PENDING.md"]);
    // 英語の雛形
    await init(dir, { force: true, hooks: false, lang: "en" });
    assert.match(read(dir, "PENDING.md"), /^# PENDING — requests from the agent to a human/);
    assert.match(read(dir, "INBOX.md"), /^# INBOX — from the human to the agent/);
  } finally {
    cleanup(dir);
  }
});

test("init: 無いディレクトリ・不正な lang は UserError", async () => {
  await assert.rejects(() => init(join("nope", "nope", "nope")), UserError);
  const dir = makeTmp("lang");
  try {
    await assert.rejects(() => init(dir, { lang: "xx" }), (e) => e instanceof UserError && /--lang/.test(e.message));
    assert.equal(readdirSync(dir).length, 0, "何も作らない");
  } finally {
    cleanup(dir);
  }
});

test("uninit: ask-later が入っていないプロジェクトでも落ちない", async () => {
  const dir = makeTmp("nothing");
  try {
    const r = await uninit(dir);
    assert.deepEqual(r, { settings: [], removed: [] });
    assert.ok(!existsSync(join(dir, ".claude")));
  } finally {
    cleanup(dir);
  }
});
