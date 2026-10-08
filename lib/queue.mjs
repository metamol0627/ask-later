// 集計。PENDING の未処理と INBOX の未読を数え、番兵ファイルとヘッダ行を更新し、必要なら通知する。
// フック（hook.mjs）と CLI（status）の両方がここを通る。
import { join } from "node:path";
import { readText, readTextLenient, writeTextAtomic, detectEol, isDirectory } from "./text.mjs";
import { parsePending, openItems, expireDeadlines, updateHeader } from "./pending.mjs";
import { unreadLines, signatureOf } from "./inbox.mjs";
import { updateSentinel, findSentinel } from "./sentinel.mjs";
import { notify } from "./notify.mjs";
import { loadState, saveState, isQuietHour } from "./config.mjs";
import { msg } from "./messages.mjs";

// 権限・ロックの失敗は生の Node 文（EPERM: operation not permitted, rename '…' -> '…'）でなく人向けの 1 行にする
export function humanError(e, lang = "ja") {
  // rename の失敗は e.path が一時ファイル側（PENDING.md.1234.tmp）で e.dest が本当のファイル。dest を先に見る（設計監査 2 巡目 #7）
  if (e && ["EACCES", "EPERM", "EROFS", "EBUSY"].includes(e.code)) return msg(lang).errWrite(e.dest ?? e.path ?? "");
  return e?.message ?? String(e);
}

// lenient=true なら UTF-8 でない行を Shift_JIS として読み直す（INBOX。人がメモ帳の ANSI で追記することがある）
function readOrNull(path, { lenient = false } = {}) {
  try {
    if (isDirectory(path)) return { text: null, error: "ディレクトリです / is a directory", garbled: 0 };
    if (lenient) {
      const r = readTextLenient(path);
      return { text: r?.text ?? null, error: null, garbled: r?.garbled ?? 0 };
    }
    return { text: readText(path), error: null, garbled: 0 };
  } catch (e) {
    return { text: null, error: e.message, garbled: 0 };
  }
}

// 読むだけ（expire=true なら期限切れの取り下げを lines に反映するが、ファイルには書かない）
export function collect(root, config, { now = new Date(), expire = false } = {}) {
  const pendingPath = join(root, config.pending);
  const inboxPath = join(root, config.inbox);
  const p = readOrNull(pendingPath);
  const ib = readOrNull(inboxPath, { lenient: true });

  const parsed = parsePending(p.text ?? "");
  let withdrawn = [];
  let pendingText = p.text;
  let pendingChanged = false;
  if (expire && p.text != null) {
    const r = expireDeadlines(parsed, { now });
    if (r.withdrawn.length) {
      withdrawn = r.withdrawn;
      pendingText = r.lines.join(detectEol(p.text));
      pendingChanged = true;
    }
  }
  const open = openItems(parsed);
  const inboxLines = unreadLines(ib.text);

  return {
    root,
    pendingPath,
    inboxPath,
    pendingExists: p.text != null,
    inboxExists: ib.text != null,
    pendingError: p.error,
    inboxError: ib.error,
    pendingText,
    pendingChanged,
    openCount: open.length,
    openItems: open,
    withdrawn,
    malformed: parsed.malformed,
    inboxUnread: inboxLines.length,
    inboxLines,
    inboxGarbled: ib.garbled ?? 0,
    signature: signatureOf(inboxLines),
  };
}

// 集計して副作用を行う。write=false なら何も書かない（status --dry 等）。
//   expire   期限切れの自動取り下げを PENDING に書き戻す
//   notify   通知を出す（静音時間帯なら持ち越し。同じ集合には繰り返さない）
export async function summarize(root, config, { now = new Date(), expire = true, notify: doNotify = false, write = true } = {}) {
  const c = collect(root, config, { now, expire: expire && write });
  const result = { ...c, sentinel: null, sentinelError: null, notified: false, quiet: false, deferred: false, writeErrors: [] };

  if (write) {
    if (c.pendingChanged) {
      try {
        writeTextAtomic(c.pendingPath, c.pendingText);
      } catch (e) {
        result.writeErrors.push(`${config.pending}: ${humanError(e, config.lang)}`);
      }
    }
    if (c.pendingExists) {
      const cur = c.pendingChanged ? c.pendingText : readOrNull(c.pendingPath).text;
      const upd = updateHeader(cur, { open: c.openCount, unread: c.inboxUnread, now });
      if (upd != null && upd !== cur) {
        try {
          writeTextAtomic(c.pendingPath, upd);
        } catch (e) {
          result.writeErrors.push(`${config.pending}: ${humanError(e, config.lang)}`);
        }
      }
    }
    const s = updateSentinel(root, { items: c.openItems, config, now });
    result.sentinel = s.path;
    result.sentinelError = s.error;
  } else {
    // 読むだけ（status --dry-run）でも、今ある番兵は今あるものとして報告する
    result.sentinel = findSentinel(root, config.sentinelPrefix);
  }

  // 通知。前回通知した集合と同じなら鳴らさない。静音時間帯は持ち越す
  const state = loadState(root);
  const signature = c.openItems.map((it) => it.id).sort().join(",");
  const lastSig = typeof state.lastNotifiedSignature === "string" ? state.lastNotifiedSignature : "";
  let deferred = state.deferred === true;
  const quiet = isQuietHour(now, config.quietHours);
  const isNew = signature !== "" && signature !== lastSig;
  let notified = false;
  // ASK_LATER_NO_NOTIFY=1 で OS 通知を止められる（テスト・CI・鳴らしたくない端末）
  if (doNotify && config.notify && !process.env.ASK_LATER_NO_NOTIFY && (isNew || deferred) && c.openCount > 0) {
    if (quiet) deferred = true;
    else {
      const m = msg(config.lang);
      let body = c.openItems.map((it) => `${it.id} ${it.title}`).join(" / ");
      if (body.length > 120) body = body.slice(0, 117) + "...";
      const r = await notify({ title: m.notifyTitle(c.openCount), body });
      notified = r.ok;
      deferred = false;
      result.notifyError = r.error ?? null;
    }
  }
  if (write) {
    if (notified || signature === "") state.lastNotifiedSignature = signature;
    state.deferred = deferred;
    state.openCount = c.openCount;
    state.inboxUnread = c.inboxUnread;
    state.updatedAt = now.toISOString();
    try {
      saveState(root, state);
    } catch (e) {
      result.writeErrors.push(`state.json: ${humanError(e, config.lang)}`);
    }
  }
  result.notified = notified;
  result.quiet = quiet;
  result.deferred = deferred;
  return result;
}
