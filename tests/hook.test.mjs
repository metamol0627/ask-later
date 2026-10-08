// (3) 注入の重複抑止（署名）(4) Stop の差し止めと stop_hook_active の通過、番兵、期限切れの書き戻し、壊れた入力
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, decide, EVENTS, signatureKey } from "../lib/hook.mjs";
import { loadConfig, DEFAULTS } from "../lib/config.mjs";
import { makeTmp, cleanup, write, read, exists, PENDING_JA, INBOX_TEMPLATE_JA } from "./helpers.mjs";

const j = (s) => JSON.parse(s);
const input = (extra = {}) => JSON.stringify({ session_id: "abcdef12-0000", hook_event_name: "x", cwd: "/x", ...extra });
const sentinels = (dir) => readdirSync(dir).filter((n) => /^!pending_\d+\.txt$/.test(n));

// テスト中に OS 通知を鳴らさない（番兵・注入・差し止めの検証には要らない）
process.env.ASK_LATER_NO_NOTIFY = "1";

function setup(name, { pending = PENDING_JA, inbox = INBOX_TEMPLATE_JA } = {}) {
  const dir = makeTmp(name);
  if (pending != null) write(dir, "PENDING.md", pending);
  if (inbox != null) write(dir, "INBOX.md", inbox);
  return dir;
}

test("SessionStart: 未処理の件数と一覧、期限切れの取り下げ、INBOX 未読を注入し、署名を保存する", async () => {
  const dir = setup("ss", { inbox: INBOX_TEMPLATE_JA + "P-024 https://example.pages.dev\n" });
  try {
    const now = new Date(2026, 8, 15, 12, 0);
    const r = await main("SessionStart", { root: dir, stdinText: input({ source: "startup" }), now });
    assert.equal(r.exitCode, 0);
    const o = j(r.output);
    assert.equal(o.hookSpecificOutput.hookEventName, "SessionStart");
    const ctx = o.hookSpecificOutput.additionalContext;
    assert.match(ctx, /【PENDING\.md に未処理の依頼: 2件】利用者の判断を待っている項目で、内容は PENDING\.md にある。/, "期限切れの P-006 は取り下げ後なので 2 件");
    assert.match(ctx, /  - P-024 商品ページを置く場所を決める/);
    assert.match(ctx, /  - P-025 /);
    assert.match(ctx, /【期限切れで自動取り下げ: P-006】/);
    assert.match(ctx, /【INBOX\.md に利用者本人の未読の行: 1件】INBOX\.md は利用者が手で書く連絡ファイルで、次の行は利用者本人が書いたもの（フックが写した）。/);
    assert.match(ctx, /  > P-024 https:\/\/example\.pages\.dev/);
    assert.match(ctx, /【状態行が無い項目: P-099】/);
    // 書き戻し: 状態行・ヘッダ・番兵・state
    const pend = read(dir, "PENDING.md");
    assert.match(pend, /^- \[x\] 状態: 取り下げ（期限 2026-09-11 21:30 を過ぎたため自動/m);
    assert.match(pend, /^未処理: 2件 \/ INBOX未読: 1件 \/ 最終集計: 2026-09-15 12:00$/m);
    assert.deepEqual(sentinels(dir), ["!pending_2.txt"]);
    assert.match(read(dir, "!pending_2.txt"), /P-024/);
    const st = j(read(dir, ".ask-later/state.json"));
    assert.match(st.inboxSignatureBySession["abcdef12-0000/main"].sig, /^[0-9a-f]{64}$/, "署名はセッション単位");
    assert.equal(st.inboxSignature, undefined, "旧形式（プロジェクト単位）は書かない");
    assert.equal(st.openCount, 2);
    assert.match(read(dir, ".ask-later/hook.log"), /SessionStart\s+\[abcdef12\] 注入（未処理 2・未読 1） 取り下げ P-006/);
  } finally {
    cleanup(dir);
  }
});

test("PostToolUse: 未読の集合が変わったときだけ注入する（同じ集合は繰り返さない）", async () => {
  const dir = setup("ptu", { inbox: INBOX_TEMPLATE_JA + "P-024 A\n" });
  try {
    const r1 = await main("PostToolUse", { root: dir, stdinText: input({ tool_name: "Read" }) });
    assert.ok(r1.output, "初回は注入");
    assert.match(j(r1.output).hookSpecificOutput.additionalContext, /  > P-024 A/);
    const r2 = await main("PostToolUse", { root: dir, stdinText: input({ tool_name: "Read" }) });
    assert.equal(r2.output, null, "同じ集合は繰り返さない");
    write(dir, "INBOX.md", INBOX_TEMPLATE_JA + "P-024 A\nP-025 B\n");
    const r3 = await main("PostToolUse", { root: dir, stdinText: input({ tool_name: "Read" }) });
    assert.ok(r3.output, "行が増えたら注入");
    assert.match(j(r3.output).hookSpecificOutput.additionalContext, /2件/);
    // ✔ を付けたら未読が減り、残りの集合で 1 回だけ
    write(dir, "INBOX.md", INBOX_TEMPLATE_JA + "✔ P-024 A\nP-025 B\n");
    const r4 = await main("PostToolUse", { root: dir, stdinText: input({ tool_name: "Read" }) });
    assert.match(j(r4.output).hookSpecificOutput.additionalContext, /1件/);
    const r5 = await main("PostToolUse", { root: dir, stdinText: input({ tool_name: "Read" }) });
    assert.equal(r5.output, null);
    // 全部 ✔ なら何も出ない
    write(dir, "INBOX.md", INBOX_TEMPLATE_JA + "✔ P-024 A\n✔ P-025 B\n");
    assert.equal((await main("PostToolUse", { root: dir, stdinText: input() })).output, null);
    // PostToolUse は書き込まない（番兵・ヘッダはそのまま）
    assert.deepEqual(sentinels(dir), []);
    assert.match(read(dir, "PENDING.md"), /^未処理: 0件 \/ INBOX未読: 0件 \/ 最終集計: -$/m);
  } finally {
    cleanup(dir);
  }
});

test("UserPromptSubmit: 未読があれば毎回注入する", async () => {
  const dir = setup("ups", { inbox: INBOX_TEMPLATE_JA + "P-024 A\n" });
  try {
    for (let i = 0; i < 2; i++) {
      const r = await main("UserPromptSubmit", { root: dir, stdinText: input({ prompt: "hi" }) });
      assert.equal(j(r.output).hookSpecificOutput.hookEventName, "UserPromptSubmit");
    }
    write(dir, "INBOX.md", INBOX_TEMPLATE_JA);
    assert.equal((await main("UserPromptSubmit", { root: dir, stdinText: input({ prompt: "hi" }) })).output, null);
  } finally {
    cleanup(dir);
  }
});

test("Stop: 未読があれば decision:block。同じ集合・同じセッションにつき既定 2 回（stop_hook_active は見ない）。未読が無ければ通す", async () => {
  const dir = setup("stop", { inbox: INBOX_TEMPLATE_JA + "P-024 A\n" });
  try {
    const r = await main("Stop", { root: dir, stdinText: input({ stop_hook_active: false }) });
    const o = j(r.output);
    assert.equal(o.decision, "block");
    assert.match(o.reason, /^INBOX\.md に利用者本人の未読の行が 1 件残っている。未読が残ったままの停止は、このプロジェクトの規律で差し止められる。\n【INBOX\.md に利用者本人の未読の行: 1件】/);
    assert.match(o.reason, /  > P-024 A/);
    // 2 回目（Claude Code は stop_hook_active: true を付けて来る）も差し止める。reason に回数が入る
    const r2 = await main("Stop", { root: dir, stdinText: input({ stop_hook_active: true }) });
    assert.equal(j(r2.output).decision, "block");
    assert.match(j(r2.output).reason, /^INBOX\.md に利用者本人の未読の行が 1 件残っている。未読が残ったままの停止は、このプロジェクトの規律で差し止められる。（2 回目の差し止め。最大 2 回。処理できない行は ✔ を付けて理由を返答に書けば通る）/);
    // 3 回目は通す（既定 2 回）
    assert.equal((await main("Stop", { root: dir, stdinText: input({ stop_hook_active: true }) })).output, null);
    assert.match(read(dir, ".ask-later/hook.log"), /Stop\s+\[abcdef12\] 差し止め（未読 1・2\/2 回目）/);
    // 別のセッションなら改めて差し止める
    assert.equal(j((await main("Stop", { root: dir, stdinText: input({ session_id: "other-session" }) })).output).decision, "block");
    // 未読の集合が変われば回数はリセット
    write(dir, "INBOX.md", INBOX_TEMPLATE_JA + "P-024 A\nP-025 B\n");
    assert.equal(j((await main("Stop", { root: dir, stdinText: input({ stop_hook_active: true }) })).output).decision, "block");
    write(dir, "INBOX.md", INBOX_TEMPLATE_JA + "✔ P-024 A\n✔ P-025 B\n");
    assert.equal((await main("Stop", { root: dir, stdinText: input({ stop_hook_active: false }) })).output, null);
    // Stop は集計する（番兵が出る）
    assert.deepEqual(sentinels(dir), ["!pending_2.txt"]);
  } finally {
    cleanup(dir);
  }
});

test("Stop の回数はセッションごと: 別セッションの Stop が割り込んでも数え直さない（設計監査 2 巡目 #2）。人の入力（UserPromptSubmit）で数え直す（#3）", async () => {
  const dir = setup("stop-cross", { inbox: INBOX_TEMPLATE_JA + "P-024 A\n" });
  try {
    const A = input({ session_id: "session-A" });
    const B = input({ session_id: "session-B" });
    assert.equal(j((await main("Stop", { root: dir, stdinText: A })).output).decision, "block", "A 1/2");
    assert.equal(j((await main("Stop", { root: dir, stdinText: A })).output).decision, "block", "A 2/2");
    assert.equal((await main("Stop", { root: dir, stdinText: A })).output, null, "A 通過");
    assert.equal(j((await main("Stop", { root: dir, stdinText: B })).output).decision, "block", "B 1/2");
    assert.equal((await main("Stop", { root: dir, stdinText: A })).output, null, "B が割り込んでも A は使い切ったまま（数え直さない）");
    const st = j(read(dir, ".ask-later/state.json"));
    assert.equal(st.stopBlocksBySession["session-A/main"].count, 2);
    assert.equal(st.stopBlocksBySession["session-B/main"].count, 1);
    assert.equal(st.stopBlocks, undefined, "旧形式は書かない");
    // 人が次の入力をしたら（UserPromptSubmit）A の回数は 0 に戻り、再び差し止める
    assert.ok((await main("UserPromptSubmit", { root: dir, stdinText: input({ session_id: "session-A", prompt: "進めて" }) })).output);
    assert.equal(j(read(dir, ".ask-later/state.json")).stopBlocksBySession["session-A/main"], undefined);
    assert.equal(j((await main("Stop", { root: dir, stdinText: A })).output).decision, "block", "A 1/2（数え直し）");
    assert.equal(j(read(dir, ".ask-later/state.json")).stopBlocksBySession["session-B/main"].count, 1, "B は影響を受けない");
    // 記録は 20 セッション分まで
    for (let i = 0; i < 25; i++) await main("Stop", { root: dir, stdinText: input({ session_id: "s" + i }) });
    assert.equal(Object.keys(j(read(dir, ".ask-later/state.json")).stopBlocksBySession).length, 20);
  } finally {
    cleanup(dir);
  }
});

test("hook.log はサブエージェントの中では [sid/agent_id] で本体と区別できる（設計監査 2 巡目 #4）", async () => {
  const dir = setup("log-aid", { inbox: INBOX_TEMPLATE_JA + "P-024 A\n" });
  try {
    await main("PostToolUse", { root: dir, stdinText: input({ agent_id: "a22f82b795ed015ea", agent_type: "Explore" }) });
    await main("PostToolUse", { root: dir, stdinText: input() });
    const log = read(dir, ".ask-later/hook.log");
    assert.match(log, /PostToolUse\s+\[abcdef12\/a22f82b7\] 注入/);
    assert.match(log, /PostToolUse\s+\[abcdef12\] 注入/);
  } finally {
    cleanup(dir);
  }
});

test("Stop: stopBlockMax は config で変えられる（0 で差し止めなし・上限 7）", async () => {
  const dir = setup("stopmax", { inbox: INBOX_TEMPLATE_JA + "P-024 A\n" });
  try {
    write(dir, ".ask-later/config.json", JSON.stringify({ stopBlockMax: 0 }));
    assert.equal((await main("Stop", { root: dir, stdinText: input() })).output, null, "0 なら差し止めない");
    write(dir, ".ask-later/config.json", JSON.stringify({ stopBlockMax: 99 }));
    assert.equal(loadConfig(dir).stopBlockMax, 7, "上限 7（本体の 8 回打ち切りの手前）");
    let blocks = 0;
    for (let i = 0; i < 10; i++) if ((await main("Stop", { root: dir, stdinText: input() })).output) blocks++;
    assert.equal(blocks, 7);
    write(dir, ".ask-later/config.json", JSON.stringify({ stopBlockMax: -1 }));
    assert.equal(loadConfig(dir).stopBlockMax, DEFAULTS.stopBlockMax, "不正な値は既定");
  } finally {
    cleanup(dir);
  }
});

test("PostToolUse の署名はセッションとサブエージェントごと: 別の session_id / agent_id なら同じ集合でも注入する（設計監査 1 巡目 #4）", async () => {
  const dir = setup("ptu-session", { inbox: INBOX_TEMPLATE_JA + "P-024 A\n" });
  try {
    // サブエージェントが先に消費しても本体に届く
    assert.ok((await main("PostToolUse", { root: dir, stdinText: input({ agent_id: "sub-1", agent_type: "scout" }) })).output, "サブエージェントで注入");
    assert.equal((await main("PostToolUse", { root: dir, stdinText: input({ agent_id: "sub-1" }) })).output, null, "同じサブエージェントには繰り返さない");
    assert.ok((await main("PostToolUse", { root: dir, stdinText: input() })).output, "本体には別に注入される");
    assert.equal((await main("PostToolUse", { root: dir, stdinText: input() })).output, null);
    assert.ok((await main("PostToolUse", { root: dir, stdinText: input({ session_id: "second-session" }) })).output, "別セッションにも注入");
    const by = j(read(dir, ".ask-later/state.json")).inboxSignatureBySession;
    assert.deepEqual(Object.keys(by).sort(), ["abcdef12-0000/main", "abcdef12-0000/sub-1", "second-session/main"]);
    // 覚えるのは 20 件まで（古い順に落とす）
    for (let i = 0; i < 25; i++) await main("PostToolUse", { root: dir, stdinText: input({ session_id: `s${i}` }) });
    assert.equal(Object.keys(j(read(dir, ".ask-later/state.json")).inboxSignatureBySession).length, 20);
  } finally {
    cleanup(dir);
  }
});

test("UTF-8 でない INBOX 行（CP932）は Shift_JIS として読み直し、注入と hook.log に注意を付ける（設計監査 1 巡目 #12）", async () => {
  const dir = setup("cp932");
  try {
    const head = Buffer.from(INBOX_TEMPLATE_JA, "utf8");
    const sjis = Buffer.from([0x50, 0x2d, 0x30, 0x30, 0x31, 0x20, 0x8b, 0x70, 0x89, 0xba, 0x81, 0x42, 0x93, 0x96, 0x96, 0xca, 0x82, 0xe2, 0x82, 0xe7, 0x82, 0xc8, 0x82, 0xa2, 0x0a]); // "P-001 却下。当面やらない\n"
    writeFileSync(join(dir, "INBOX.md"), Buffer.concat([head, sjis]));
    const r = await main("UserPromptSubmit", { root: dir, stdinText: input({ prompt: "hi" }) });
    const ctx = j(r.output).hookSpecificOutput.additionalContext;
    assert.match(ctx, /  > P-001 却下。当面やらない/, "化けずに読める");
    assert.match(ctx, /UTF-8 として読めない行があり、Shift_JIS として読み直した/);
    assert.match(read(dir, ".ask-later/hook.log"), /UTF-8 でない行 1/);
    // 全行 UTF-8 なら注意は付かない
    write(dir, "INBOX.md", INBOX_TEMPLATE_JA + "P-001 却下。当面やらない\n");
    assert.doesNotMatch(j((await main("UserPromptSubmit", { root: dir, stdinText: input({ prompt: "hi" }) })).output).hookSpecificOutput.additionalContext, /Shift_JIS/);
  } finally {
    cleanup(dir);
  }
});

test("一覧は 30 件で「ほか N 件」に切る（additionalContext の 10,000 字上限・設計監査 1 巡目 #19）", async () => {
  const items = Array.from({ length: 35 }, (_, i) => `## [P-${100 + i}] 項目 ${i}\n- [ ] 状態: 未処理\n`).join("\n");
  const lines = Array.from({ length: 33 }, (_, i) => `行 ${i}`).join("\n") + "\n";
  const dir = setup("many", { pending: "# 未処理\n\n" + items, inbox: INBOX_TEMPLATE_JA + lines });
  try {
    const ctx = j((await main("SessionStart", { root: dir, stdinText: input() })).output).hookSpecificOutput.additionalContext;
    assert.match(ctx, /【PENDING\.md に未処理の依頼: 35件】/);
    assert.match(ctx, /  - P-129 項目 29\n  - …ほか 5 件/);
    assert.doesNotMatch(ctx, /P-130/);
    assert.match(ctx, /【INBOX\.md に利用者本人の未読の行: 33件】/);
    assert.match(ctx, /  > 行 29\n  - …ほか 3 件/);
  } finally {
    cleanup(dir);
  }
});

test("SessionEnd: 出力は無く、番兵を更新する。0 件なら番兵は消える", async () => {
  const dir = setup("se");
  try {
    assert.equal((await main("SessionEnd", { root: dir, stdinText: input({ reason: "other" }) })).output, null);
    assert.deepEqual(sentinels(dir), ["!pending_2.txt"]);
    write(dir, "PENDING.md", PENDING_JA.replace(/- \[ \] 状態: 未処理/g, "- [x] 状態: 完了"));
    await main("SessionEnd", { root: dir, stdinText: input({ reason: "other" }) });
    assert.deepEqual(sentinels(dir), [], "0 件で消える");
  } finally {
    cleanup(dir);
  }
});

test("壊れた入力で壊れない: stdin が JSON でない・空・ファイルが無い・ディレクトリ・config が壊れている・知らないイベント → 全部 exit 0", async () => {
  const dir = setup("broken", { pending: null, inbox: null });
  try {
    for (const ev of EVENTS) {
      for (const text of ["not json", "", "{", "[1,2]", "{\"stop_hook_active\":\"yes\"}"]) {
        const r = await main(ev, { root: dir, stdinText: text });
        assert.equal(r.exitCode, 0, `${ev} / ${JSON.stringify(text)}`);
      }
    }
    // PENDING.md が無い: SessionStart だけが 1 行案内する
    const r = await main("SessionStart", { root: dir, stdinText: "{}" });
    assert.match(j(r.output).hookSpecificOutput.additionalContext, /PENDING\.md が無い（フックは動いている）。雛形は npx ask-later init が作る/);
    assert.equal((await main("PostToolUse", { root: dir, stdinText: "{}" })).output, null);
    assert.equal((await main("Stop", { root: dir, stdinText: "{}" })).output, null);
    // ディレクトリを置いても落ちない
    mkdirSync(join(dir, "PENDING.md"));
    mkdirSync(join(dir, "INBOX.md"));
    assert.equal((await main("SessionStart", { root: dir, stdinText: "{}" })).exitCode, 0);
    assert.match(read(dir, ".ask-later/hook.log"), /ディレクトリです/);
    // config.json が壊れていても既定値で動く
    write(dir, ".ask-later/config.json", "{ broken");
    const c = loadConfig(dir);
    assert.equal(c.lang, DEFAULTS.lang);
    assert.match(c.error, /config\.json が読めません/);
    assert.equal((await main("Stop", { root: dir, stdinText: "{}" })).exitCode, 0);
    // 知らないイベント
    const u = await main("Bogus", { root: dir, stdinText: "{}" });
    assert.equal(u.exitCode, 0);
    assert.equal(u.output, null);
    // 存在しない root でも落ちない
    assert.equal((await main("SessionStart", { root: join(dir, "nope", "nope"), stdinText: "{}" })).exitCode, 0);
  } finally {
    cleanup(dir);
  }
});

test("期限切れの書き戻しは CRLF を保ち、他の行を変えない", async () => {
  const crlf = PENDING_JA.replace(/\n/g, "\r\n");
  const dir = setup("crlf", { pending: crlf });
  try {
    await main("SessionStart", { root: dir, stdinText: "{}", now: new Date(2026, 8, 15) });
    const after = read(dir, "PENDING.md");
    assert.ok(after.includes("\r\n") && !/[^\r]\n/.test(after), "CRLF のまま");
    const a = after.split("\r\n");
    const b = crlf.split("\r\n");
    assert.equal(a.length, b.length);
    const diff = a.map((l, i) => (l !== b[i] ? i : -1)).filter((i) => i >= 0);
    assert.equal(diff.length, 2, "変わるのはヘッダ行と P-006 の状態行だけ");
  } finally {
    cleanup(dir);
  }
});

test("英語設定: 注入文が英語になる", async () => {
  const dir = setup("en", { inbox: "# INBOX\n---\nP-024 done\n" });
  try {
    write(dir, ".ask-later/config.json", JSON.stringify({ lang: "en" }));
    const r = await main("Stop", { root: dir, stdinText: input({ stop_hook_active: false }) });
    assert.match(j(r.output).reason, /^INBOX\.md still has 1 unread line\(s\) written by the user\. Stopping with unread lines is blocked under this project's rule\./);
    assert.match(read(dir, "!pending_2.txt"), /The agent is waiting on you for 2 item\(s\)\./);
  } finally {
    cleanup(dir);
  }
});

test("decide は純関数: 同じ入力で同じ出力。state の署名（セッション別）と差し止め回数だけを見る", () => {
  const config = { ...DEFAULTS };
  const snap = { openCount: 0, openItems: [], withdrawn: [], malformed: [], pendingExists: true, inboxLines: ["a"], signature: "sig1" };
  const seen = (sig, key = "-/main") => ({ inboxSignatureBySession: { [key]: { sig } } });
  assert.equal(signatureKey({}), "-/main");
  assert.equal(signatureKey({ session_id: "s", agent_id: "a" }), "s/a");
  assert.ok(decide("PostToolUse", {}, snap, {}, config).output);
  assert.equal(decide("PostToolUse", {}, snap, seen("sig1"), config).output, null);
  assert.ok(decide("PostToolUse", {}, snap, seen("other"), config).output);
  assert.ok(decide("PostToolUse", { session_id: "s2" }, snap, seen("sig1"), config).output, "別セッションの署名は見ない");
  assert.equal(decide("PostToolUse", {}, snap, seen("sig1"), config).saveSignature, null);
  assert.equal(decide("SessionStart", {}, { ...snap, inboxLines: [], signature: "" }, {}, config).output, null, "何も無ければ出力なし");
  assert.equal(decide("SessionStart", {}, { ...snap, inboxLines: [], signature: "" }, {}, config).saveSignature, "", "空の署名を保存");
  // Stop: 回数は state.stopBlocksBySession[鍵]（署名が同じときだけ数える）
  const blocks = (v, key = "-/main") => ({ stopBlocksBySession: { [key]: v } });
  const b1 = decide("Stop", {}, snap, {}, config);
  assert.deepEqual(b1.stopBlocks, { key: "-/main", signature: "sig1", count: 1 });
  const b2 = decide("Stop", {}, snap, blocks(b1.stopBlocks), config);
  assert.equal(b2.stopBlocks.count, 2);
  assert.equal(decide("Stop", {}, snap, blocks(b2.stopBlocks), config).output, null, "既定 2 回で通す");
  assert.equal(decide("Stop", {}, snap, blocks({ ...b2.stopBlocks, signature: "old" }), config).stopBlocks.count, 1, "署名が変われば 1 から");
  assert.equal(decide("Stop", {}, snap, blocks(b2.stopBlocks), { ...config, stopBlockMax: 3 }).stopBlocks.count, 3);
  assert.equal(decide("Stop", {}, snap, blocks(b2.stopBlocks, "other/main"), config).stopBlocks.count, 1, "別セッションの記録は見ない");
  assert.equal(decide("Stop", {}, snap, { stopBlocks: { key: "-/main", signature: "sig1", count: 2 } }, config).stopBlocks.count, 1, "旧形式 state.stopBlocks は読まない");
  // UserPromptSubmit: そのセッションに差し止めの記録があれば数え直しを指示する
  assert.equal(decide("UserPromptSubmit", {}, snap, blocks(b2.stopBlocks), config).resetStopBlocks, true);
  assert.equal(decide("UserPromptSubmit", {}, snap, {}, config).resetStopBlocks, false);
  assert.equal(decide("Stop", {}, snap, {}, config).resetStopBlocks, false);
});
