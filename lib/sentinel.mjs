// 番兵ファイル。名前そのものが件数（"!pending_3.txt"）。
// エクスプローラ／Finder でプロジェクトを開くだけで目に入る。音も光も出さないので夜間でも安全であり、
// これが第一の通知手段である。0 件なら消す（ルートを汚さない）。
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeTextAtomic, formatLocal } from "./text.mjs";
import { msg } from "./messages.mjs";

export function sentinelName(n, prefix = "!pending_") {
  return `${prefix}${n}.txt`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentinelNames(root, prefix) {
  const re = new RegExp(`^${escapeRe(prefix)}\\d+\\.txt$`);
  try {
    return readdirSync(root).filter((n) => re.test(n));
  } catch {
    return [];
  }
}

// 今ある番兵のパス（無ければ null）。読むだけ
export function findSentinel(root, prefix = "!pending_") {
  const names = sentinelNames(root, prefix);
  return names.length ? join(root, names[0]) : null;
}

// 自分が作った番兵だけを消す（<prefix><数字>.txt に一致するもの）
export function removeSentinels(root, prefix = "!pending_") {
  const removed = [];
  for (const name of sentinelNames(root, prefix)) {
    try {
      rmSync(join(root, name), { force: true });
      removed.push(name);
    } catch {
      /* 開かれている等。次回に持ち越す */
    }
  }
  return removed;
}

// 返り値: 作った番兵のパス（0 件なら null）。失敗しても例外にしない（{ path: null, error }）
export function updateSentinel(root, { items, config, now = new Date() }) {
  const prefix = config.sentinelPrefix;
  const removed = removeSentinels(root, prefix);
  if (!items.length) return { path: null, removed, error: null };
  const path = join(root, sentinelName(items.length, prefix));
  const body = msg(config.lang).sentinel({
    n: items.length,
    items,
    now: formatLocal(now, { seconds: true }),
    pending: config.pending,
    inbox: config.inbox,
  });
  try {
    writeTextAtomic(path, body.join("\n") + "\n");
    return { path, removed, error: null };
  } catch (e) {
    return { path: null, removed, error: e.message };
  }
}
