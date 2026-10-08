// フック本体。Claude Code から stdin に JSON を受け取り、stdout に JSON を返す。
//
//   SessionStart      集計（期限切れの取り下げ・番兵）→ 未処理件数と INBOX 未読を additionalContext に注入
//   UserPromptSubmit  未読があれば毎回注入
//   PostToolUse       未読の集合が前回の注入から変わったときだけ注入（同じ内容は繰り返さない。署名で管理。
//                     署名はセッション（session_id）とサブエージェント（agent_id）ごとに持つ——サブエージェントの
//                     ツール呼び出しが先に消費して本体に届かない、を防ぐ）
//   Stop              未読があれば decision:block で停止を差し止め。同じ未読の集合・同じセッションにつき
//                     config.stopBlockMax 回（既定 2・上限 7）まで。回数はセッションごとに持つ（state.stopBlocksBySession。
//                     別のセッションの Stop が割り込んでも数え直さない）。人が次の入力をしたら（UserPromptSubmit）
//                     そのセッションの回数は 0 に戻る——本体の「連続 8 回」も人の入力で切れるので、人の 1 入力につき最大 N 回。
//                     Claude Code 本体は連続 8 回で打ち切るので、stop_hook_active を見なくても無限ループにはならない。集計・通知
//   SessionEnd        番兵を更新する（出力は Claude Code に読まれない。通知は出さない——SessionEnd の予算は既定 1.5 秒で、
//                     プラグイン形では timeout で延ばせない。通知は Stop が同じ条件で出している）
//
// 【原則】このモジュールは何があっても exit 0 で終わる。stdin が JSON でない・ファイルが無い・壊れている・
//         書き込めない——どれでも本体の作業を止めない。読める 1 行を hook.log に残すだけ。
import { appendFileSync, statSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { readStream, formatLocal } from "./text.mjs";
import { loadConfig, loadState, saveState, logPath, DEFAULTS } from "./config.mjs";
import { summarize } from "./queue.mjs";
import { msg } from "./messages.mjs";

export const EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"];
export const MAX_LISTED = 30; // additionalContext は 10,000 字で切られる（公式）。一覧は 30 件で「ほか N 件」
const SIGNATURE_KEYS = 20; // 署名を覚えておくセッション数（古い順に落とす）

// 署名の鍵。session_id と（サブエージェントの中なら）agent_id。無ければ "-"
export function signatureKey(input) {
  const sid = typeof input?.session_id === "string" && input.session_id ? input.session_id : "-";
  const aid = typeof input?.agent_id === "string" && input.agent_id ? input.agent_id : "main";
  return `${sid}/${aid}`;
}

function lastSignature(state, key) {
  const by = state?.inboxSignatureBySession;
  const v = by && typeof by === "object" ? by[key] : null;
  return v && typeof v.sig === "string" ? v.sig : "";
}

// そのセッション（鍵）の差し止め回数。署名（未読の集合）が違えば 0
function stopCount(state, key, sig) {
  const by = state?.stopBlocksBySession;
  const v = by && typeof by === "object" ? by[key] : null;
  return v && v.signature === sig && Number.isInteger(v.count) ? v.count : 0;
}

// 鍵ごとの記録を上限件数に保つ（古い順に落とす）。by を書き換えて返す
function keepRecent(by, key, value) {
  delete by[key];
  by[key] = value;
  for (const k of Object.keys(by).slice(0, Math.max(0, Object.keys(by).length - SIGNATURE_KEYS))) delete by[k];
  return by;
}

function formatInbox(lines, m, config, garbled = 0) {
  const shown = lines.slice(0, MAX_LISTED);
  const parts = [m.ctxInboxHead(lines.length, config.inbox), ...shown.map((t) => `  > ${t}`)];
  if (lines.length > shown.length) parts.push(m.ctxOpenMore(lines.length - shown.length));
  parts.push(...m.ctxInboxTail(config.pending));
  if (garbled > 0) parts.push(m.ctxGarbled(config.inbox));
  return parts.join("\n");
}

// 純関数: イベント・入力・集計結果・状態から、出力と「保存すべき署名」「差し止め回数」「回数の数え直し」を決める
export function decide(event, input, snap, state, config) {
  const m = msg(config.lang);
  const unread = snap.inboxLines ?? [];
  const sig = snap.signature ?? "";
  const key = signatureKey(input);
  const last = lastSignature(state, key);
  const garbled = snap.inboxGarbled ?? 0;
  let output = null;
  let saveSignature = null;
  let stopBlocks = null;
  let resetStopBlocks = false;

  switch (event) {
    case "SessionStart": {
      const ctx = [];
      if (snap.openCount > 0) {
        ctx.push(m.ctxOpen(snap.openCount, config.pending));
        const shown = snap.openItems.slice(0, MAX_LISTED);
        for (const it of shown) ctx.push(`  - ${it.id} ${it.title}`);
        if (snap.openItems.length > shown.length) ctx.push(m.ctxOpenMore(snap.openItems.length - shown.length));
        ctx.push(m.ctxOpenTail);
      }
      if (snap.withdrawn?.length) ctx.push(m.ctxWithdrawn(snap.withdrawn));
      if (unread.length) ctx.push(formatInbox(unread, m, config, garbled));
      if (snap.malformed?.length) ctx.push(m.ctxMalformed(snap.malformed, config.pending));
      if (!snap.pendingExists) ctx.push(m.ctxNoPending(config.pending));
      if (ctx.length) output = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx.join("\n") } };
      saveSignature = sig;
      break;
    }
    case "UserPromptSubmit": {
      // 人の入力で、このセッションの差し止め回数は数え直す（本体の「連続 8 回」も人の入力で切れる）
      resetStopBlocks = Boolean(state?.stopBlocksBySession?.[key]);
      if (unread.length) {
        output = { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: formatInbox(unread, m, config, garbled) } };
        saveSignature = sig;
      }
      break;
    }
    case "PostToolUse": {
      if (unread.length && sig !== last) {
        output = { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: formatInbox(unread, m, config, garbled) } };
        saveSignature = sig;
      }
      break;
    }
    case "Stop": {
      if (!unread.length) break;
      const max = Number.isInteger(config.stopBlockMax) ? config.stopBlockMax : DEFAULTS.stopBlockMax;
      const count = stopCount(state, key, sig);
      if (count < max) {
        const k = count + 1;
        const head = `${m.stopReason(unread.length, config.inbox)}${k > 1 ? m.stopReasonAgain(k, max) : ""}`;
        output = { decision: "block", reason: `${head}\n${formatInbox(unread, m, config, garbled)}` };
        stopBlocks = { key, signature: sig, count: k };
        saveSignature = sig;
      }
      break;
    }
    default:
      break;
  }
  return { output, saveSignature, stopBlocks, resetStopBlocks };
}

function appendLog(root, line) {
  try {
    const p = logPath(root);
    mkdirSync(dirname(p), { recursive: true });
    try {
      if (statSync(p).size > 1_000_000) renameSync(p, `${p}.1`); // 1 MB で世代を 1 つ回す
    } catch {
      /* 無い */
    }
    appendFileSync(p, line + "\n", "utf8");
  } catch {
    /* ログすら書けなくても止めない */
  }
}

// I/O を含む本体。返り値 { exitCode: 0, output: string|null }。呼び出し側が output を stdout に書く
//   version  hook.log に残す版（init の写しなら VERSION ファイル、プラグイン形なら package.json）。無ければ書かない
export async function main(event, { root, stdin = process.stdin, stdinText = null, now = new Date(), version = null } = {}) {
  const res = { exitCode: 0, output: null };
  const stamp = () => formatLocal(now, { seconds: true });
  const ver = version ? ` v${version}` : "";
  let m = msg(DEFAULTS.lang);
  try {
    if (!root) root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const raw = stdinText != null ? String(stdinText) : await readStream(stdin);
    let input = {};
    if (raw && raw.trim().startsWith("{")) {
      try {
        input = JSON.parse(raw);
      } catch {
        input = {};
      }
    }
    const config = loadConfig(root);
    m = msg(config.lang);
    if (!EVENTS.includes(event)) {
      appendLog(root, `${stamp()}  ${String(event).padEnd(16)} ${m.logUnknown}${ver}`);
      return res;
    }
    const heavy = event === "SessionStart" || event === "Stop" || event === "SessionEnd";
    const snap = await summarize(root, config, { now, expire: heavy, notify: event === "Stop", write: heavy });
    const state = loadState(root);
    const { output, saveSignature, stopBlocks, resetStopBlocks } = decide(event, input, snap, state, config);
    if (saveSignature != null || stopBlocks || resetStopBlocks) {
      const key = signatureKey(input);
      if (saveSignature != null) {
        const by = state.inboxSignatureBySession && typeof state.inboxSignatureBySession === "object" ? state.inboxSignatureBySession : {};
        state.inboxSignatureBySession = keepRecent(by, key, { sig: saveSignature, at: now.toISOString(), event });
        delete state.inboxSignature; // 旧形式（プロジェクト単位）は使わない
        delete state.inboxSignatureAt;
        delete state.inboxSignatureEvent;
      }
      const blocks = state.stopBlocksBySession && typeof state.stopBlocksBySession === "object" ? state.stopBlocksBySession : {};
      if (stopBlocks) state.stopBlocksBySession = keepRecent(blocks, key, { signature: stopBlocks.signature, count: stopBlocks.count, at: now.toISOString() });
      if (resetStopBlocks) {
        delete blocks[key];
        state.stopBlocksBySession = blocks;
      }
      delete state.stopBlocks; // 旧形式（プロジェクトで 1 組）は使わない（設計監査 2 巡目 #2）
      try {
        saveState(root, state);
      } catch {
        /* 次回は同じ内容をもう一度注入するだけ */
      }
    }
    if (output) res.output = JSON.stringify(output) + "\n";
    // ログの鍵は [session_id の先頭 8 字] か、サブエージェントの中なら [sid/agent_id の先頭 8 字]（本体と区別できるように）
    const sid = typeof input.session_id === "string" ? input.session_id.slice(0, 8) : "--------";
    const aid = typeof input.agent_id === "string" && input.agent_id ? `/${input.agent_id.slice(0, 8)}` : "";
    const what = output
      ? output.decision === "block"
        ? m.logBlock(snap.inboxUnread, stopBlocks?.count ?? 1, config.stopBlockMax)
        : m.logInject(snap.openCount, snap.inboxUnread)
      : m.logNone(snap.openCount, snap.inboxUnread);
    const errs = [
      snap.pendingError && `${config.pending}: ${snap.pendingError}`,
      snap.inboxError && `${config.inbox}: ${snap.inboxError}`,
      ...(snap.writeErrors ?? []),
      snap.sentinelError && `sentinel: ${snap.sentinelError}`,
      snap.inboxGarbled > 0 && m.logGarbled(snap.inboxGarbled),
      config.error,
    ].filter(Boolean);
    const tail = [snap.withdrawn?.length ? m.logWithdrawn(snap.withdrawn) : "", snap.notified ? m.logNotified : ""].filter(Boolean).map((s) => ` ${s}`).join("");
    appendLog(root, `${stamp()}  ${event.padEnd(16)} [${sid}${aid}] ${what}${tail}${errs.length ? `  ! ${errs.join(" / ")}` : ""}${ver}`);
  } catch (e) {
    appendLog(root ?? process.cwd(), `${stamp()}  ${String(event).padEnd(16)} ${m.logFail(e?.message ?? e)}${ver}`);
  }
  return res;
}
