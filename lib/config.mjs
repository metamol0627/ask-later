// 設定（.ask-later/config.json）と状態（.ask-later/state.json）。
// どちらも無くても動く。壊れていてもフックは止めない（既定値で進み、status が警告する）。
import { join } from "node:path";
import { readText, writeTextAtomic } from "./text.mjs";
import { LANGS } from "./messages.mjs";

export const STATE_DIR = ".ask-later";

export const DEFAULTS = Object.freeze({
  lang: "ja",
  pending: "PENDING.md",
  inbox: "INBOX.md",
  sentinelPrefix: "!pending_",
  quietHours: { start: 21, end: 8 }, // 21:00〜08:00 は通知を鳴らさず翌朝に持ち越す
  notify: true,
  // Stop の差し止め回数（同じ未読の集合・同じセッションにつき）。0 で差し止めなし。上限 7——Claude Code 本体が
  // 連続 8 回の差し止めで打ち切る（公式 hooks 仕様）ので、その手前で必ず止まる
  stopBlockMax: 2,
});
export const STOP_BLOCK_MAX_LIMIT = 7;

export const configPath = (root) => join(root, STATE_DIR, "config.json");
export const statePath = (root) => join(root, STATE_DIR, "state.json");
export const logPath = (root) => join(root, STATE_DIR, "hook.log");

function safeJson(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? { value: v, error: null } : { value: null, error: "オブジェクトではありません / not an object" };
  } catch (e) {
    return { value: null, error: e.message };
  }
}

// 既定値に config.json を重ねる。値の型が違えばその項目だけ既定値に戻す
export function loadConfig(root) {
  const out = { ...DEFAULTS, quietHours: { ...DEFAULTS.quietHours }, error: null };
  const text = readText(configPath(root));
  if (text == null) return out;
  const { value, error } = safeJson(text);
  if (!value) {
    out.error = `config.json が読めません（${error}）。既定値で動きます`;
    return out;
  }
  if (typeof value.lang === "string" && LANGS.includes(value.lang)) out.lang = value.lang;
  for (const k of ["pending", "inbox", "sentinelPrefix"]) {
    if (typeof value[k] === "string" && value[k].trim() && !/[\\/]/.test(value[k])) out[k] = value[k].trim();
  }
  if (typeof value.notify === "boolean") out.notify = value.notify;
  if (Number.isInteger(value.stopBlockMax) && value.stopBlockMax >= 0) out.stopBlockMax = Math.min(value.stopBlockMax, STOP_BLOCK_MAX_LIMIT);
  if (value.quietHours && typeof value.quietHours === "object") {
    const { start, end } = value.quietHours;
    if (Number.isInteger(start) && start >= 0 && start <= 24) out.quietHours.start = start;
    if (Number.isInteger(end) && end >= 0 && end <= 24) out.quietHours.end = end;
  }
  return out;
}

export function loadState(root) {
  const text = readText(statePath(root));
  if (text == null) return {};
  const { value } = safeJson(text);
  return value ?? {};
}

export function saveState(root, state) {
  writeTextAtomic(statePath(root), JSON.stringify(state, null, 2) + "\n");
}

// 静音時間帯か。start > end なら日をまたぐ（21→8）。start === end なら静音なし
export function isQuietHour(date, { start, end } = DEFAULTS.quietHours) {
  const h = date.getHours();
  if (start === end) return false;
  return start > end ? h >= start || h < end : h >= start && h < end;
}
