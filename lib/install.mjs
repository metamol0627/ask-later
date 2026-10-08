// init / uninit。.claude/settings.json の hooks にマージし（既存を壊さない）、uninit で元に戻す。
//
// フックのエントリは既定で exec 形（args 形式）:
//   { "type": "command", "command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs", "<Event>"] }
// 公式仕様は「パスのプレースホルダを参照するフックは exec 形にせよ」で、${CLAUDE_PROJECT_DIR} は args の各要素の中でも
// 置換される。シェルを通さないので、Git Bash の無い Windows（PowerShell がシェルになる）や旧版でも引用に依存しない。
// --shell で旧来の shell 形 `node "${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs" <Event>` も書ける。
// 本体はプロジェクトの .claude/ask-later/ に写すので、npx のキャッシュや node_modules が消えても動き、
// settings.json をそのままリポジトリに入れて共有できる。
// 自分のエントリは command / args に "ask-later/hook.mjs" を含むことで識別する（settings に余計なキーを足さない）。
import { existsSync, mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readText, writeTextAtomic, isDirectory, detectJsonFormat, formatJson, detectEol } from "./text.mjs";
import { STATE_DIR, DEFAULTS, configPath } from "./config.mjs";
import { removeSentinels } from "./sentinel.mjs";
import { LANGS } from "./messages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = join(here, "..", "templates");
export const HOOK_DIR = join(".claude", "ask-later");
export const HOOK_MARK = "ask-later/hook.mjs";
export const HOOK_PATH_PLACEHOLDER = "${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs";
// タイムアウト（秒）。公式の既定は command フックが 600 秒・UserPromptSubmit が 30 秒で、集計には十分だが、
// SessionEnd だけは既定 1.5 秒の共有予算（settings.json の per-hook timeout で最大 60 秒まで延びる。プラグイン形では延びない）。
// 既定に依存しないよう全部に明示する。
export const HOOK_EVENTS = [
  ["SessionStart", 20],
  ["UserPromptSubmit", 15],
  ["PostToolUse", 15],
  ["Stop", 20],
  ["SessionEnd", 20],
];
// フックに要るファイルだけ写す（cli / install は要らない）
export const HOOK_LIB_FILES = ["text.mjs", "messages.mjs", "config.mjs", "pending.mjs", "inbox.mjs", "sentinel.mjs", "notify.mjs", "queue.mjs", "hook.mjs"];
export const GITIGNORE_LINES = [".ask-later/", "\\!pending_*.txt"];
export const CLAUDE_MD_MARK = { ja: "## 非同期キュー（ask-later）", en: "## Async queue (ask-later)" };

export class UserError extends Error {}

export function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

// 写しの版（.claude/ask-later/VERSION）。無ければ null（VERSION を書く前の写し）
export function hookCopyVersion(root) {
  try {
    return readFileSync(join(root, HOOK_DIR, "VERSION"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function hookEntry(event, timeout, { form = "exec" } = {}) {
  if (form === "shell") {
    return { type: "command", command: `node "${HOOK_PATH_PLACEHOLDER}" ${event}`, timeout };
  }
  return { type: "command", command: "node", args: [HOOK_PATH_PLACEHOLDER, event], timeout };
}

export function isOurs(def) {
  if (!def || typeof def !== "object") return false;
  const norm = (s) => String(s).replace(/\\/g, "/");
  if (typeof def.command === "string" && norm(def.command).includes(HOOK_MARK)) return true;
  if (Array.isArray(def.args) && def.args.some((a) => norm(a).includes(HOOK_MARK))) return true;
  return false;
}

// 純関数（引数のオブジェクトを書き換えて返す）。自分のエントリを取り除いてから足す（再 init は更新になる）
export function mergeHooks(settings, opts = {}) {
  const s = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  if (!s.hooks || typeof s.hooks !== "object" || Array.isArray(s.hooks)) s.hooks = {};
  for (const [event, timeout] of HOOK_EVENTS) {
    const groups = Array.isArray(s.hooks[event]) ? s.hooks[event] : [];
    const kept = stripOurs(groups);
    kept.push({ hooks: [hookEntry(event, timeout, opts)] });
    s.hooks[event] = kept;
  }
  return s;
}

function stripOurs(groups) {
  const out = [];
  for (const g of groups) {
    if (!g || typeof g !== "object" || !Array.isArray(g.hooks)) {
      out.push(g);
      continue;
    }
    const rest = g.hooks.filter((h) => !isOurs(h));
    if (rest.length === g.hooks.length) out.push(g);
    else if (rest.length) out.push({ ...g, hooks: rest });
    // 自分のものだけだったグループは落とす
  }
  return out;
}

export function removeHooks(settings) {
  const s = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  if (!s.hooks || typeof s.hooks !== "object") return s;
  for (const event of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[event])) continue;
    const kept = stripOurs(s.hooks[event]);
    if (kept.length) s.hooks[event] = kept;
    else delete s.hooks[event];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

function readSettings(path) {
  const raw = readText(path);
  if (raw == null) return { settings: null, raw: null };
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    throw new UserError(`${path} が JSON として読めません（${e.message}）。直してから再実行してください。何も書き換えていません`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new UserError(`${path} の中身がオブジェクトではありません。何も書き換えていません`);
  }
  return { settings, raw };
}

// 元ファイルの体裁（字下げ幅・改行コード・末尾改行）を写して書く。元が無ければ 2 スペース・LF・末尾改行あり
function writeSettings(path, settings, raw) {
  writeTextAtomic(path, formatJson(settings, detectJsonFormat(raw)));
}

export function templatePath(kind, lang) {
  return join(TEMPLATE_DIR, `${kind}.${lang}.md`);
}

export function snippet(lang = "ja") {
  return readFileSync(templatePath("CLAUDE.snippet", LANGS.includes(lang) ? lang : "ja"), "utf8");
}

// 本体をプロジェクトに写す。VERSION に写したときのパッケージの版を残す（status が古い写しを言えるように）
export function copyHookFiles(root) {
  const dst = join(root, HOOK_DIR);
  mkdirSync(join(dst, "lib"), { recursive: true });
  copyFileSync(join(here, "hook-entry.mjs"), join(dst, "hook.mjs"));
  for (const f of HOOK_LIB_FILES) copyFileSync(join(here, f), join(dst, "lib", f));
  writeFileSync(join(dst, "VERSION"), `${packageVersion() ?? "?"}\n`, "utf8");
  return dst;
}

// CLAUDE.md に規律の断片を足す（見出しが既にあれば触らない）。返り値: "created" | "appended" | "kept"
export function appendClaudeMd(root, lang) {
  const p = join(root, "CLAUDE.md");
  const body = snippet(lang);
  const cur = readText(p);
  if (cur == null) {
    writeTextAtomic(p, body);
    return "created";
  }
  if (Object.values(CLAUDE_MD_MARK).some((mark) => cur.includes(mark))) return "kept";
  const eol = detectEol(cur);
  const sep = cur === "" ? "" : cur.endsWith("\n") ? eol : eol + eol;
  writeTextAtomic(p, cur + sep + body.replace(/\r?\n/g, eol));
  return "appended";
}

// .gitignore に 2 行を足す（無い行だけ）。返り値: 足した行
export function appendGitignore(root) {
  const p = join(root, ".gitignore");
  const cur = readText(p) ?? "";
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const add = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (!add.length) return [];
  const eol = detectEol(cur);
  const sep = cur === "" ? "" : cur.endsWith("\n") ? "" : eol;
  writeTextAtomic(p, cur + sep + add.join(eol) + eol);
  return add;
}

export async function init(root, { lang = "ja", force = false, local = false, hooks = true, files = true, form = "exec", claudeMd = true, gitignore = true, log = () => {} } = {}) {
  if (!isDirectory(root)) throw new UserError(`ディレクトリがありません: ${root}`);
  if (!LANGS.includes(lang)) throw new UserError(`--lang は ${LANGS.join(" | ")} のどれかです: ${lang}`);
  const r = { created: [], updated: [], skipped: [], settingsPath: null, hookDir: null, claudeMd: null, gitignore: [] };

  if (files) {
    for (const [kind, name] of [
      ["PENDING", DEFAULTS.pending],
      ["INBOX", DEFAULTS.inbox],
    ]) {
      const dst = join(root, name);
      if (existsSync(dst) && !force) {
        r.skipped.push(name);
        continue;
      }
      const existed = existsSync(dst);
      writeTextAtomic(dst, readFileSync(templatePath(kind, lang), "utf8"));
      (existed ? r.updated : r.created).push(name);
      log(`${name} を書きました`);
    }
    const cp = configPath(root);
    if (!existsSync(cp)) {
      writeTextAtomic(cp, JSON.stringify({ ...DEFAULTS, lang }, null, 2) + "\n");
      r.created.push(`${STATE_DIR}/config.json`);
    } else r.skipped.push(`${STATE_DIR}/config.json`);
    if (claudeMd) {
      r.claudeMd = appendClaudeMd(root, lang);
      if (r.claudeMd === "created") r.created.push("CLAUDE.md");
      else if (r.claudeMd === "appended") r.updated.push("CLAUDE.md");
      else r.skipped.push("CLAUDE.md");
    }
    if (gitignore) {
      const existed = existsSync(join(root, ".gitignore"));
      r.gitignore = appendGitignore(root);
      if (r.gitignore.length) (existed ? r.updated : r.created).push(".gitignore");
    }
  }

  if (hooks) {
    r.hookDir = copyHookFiles(root);
    const settingsPath = join(root, ".claude", local ? "settings.local.json" : "settings.json");
    const { settings, raw } = readSettings(settingsPath);
    const merged = mergeHooks(settings ?? {}, { form });
    writeSettings(settingsPath, merged, raw);
    // init が作った settings ファイルは、uninit で「{} だけの空ファイル」を残さず消す（設計監査 2 巡目 #9）。
    // 印は写しの中（uninit が消す前に読む。再 init では残る）。init 前からあったファイルには印を付けない
    if (!settings) writeFileSync(join(r.hookDir, "CREATED_SETTINGS"), `${basename(settingsPath)}\n`, "utf8");
    r.settingsPath = settingsPath;
    (settings ? r.updated : r.created).push(settingsPath.slice(root.length + 1).replace(/\\/g, "/"));
    log(`${settingsPath} に hooks を${settings ? "マージ" : "作成"}しました`);
  }
  return r;
}

export async function uninit(root, { purge = false, log = () => {} } = {}) {
  if (!isDirectory(root)) throw new UserError(`ディレクトリがありません: ${root}`);
  const rel = (p) => p.slice(root.length + 1).replace(/\\/g, "/");
  const r = { settings: [], removed: [] };
  const createdByInit = (readText(join(root, HOOK_DIR, "CREATED_SETTINGS")) ?? "").trim();
  for (const name of ["settings.json", "settings.local.json"]) {
    const p = join(root, ".claude", name);
    const { settings, raw } = readSettings(p);
    if (!settings) continue;
    const before = JSON.stringify(settings);
    removeHooks(settings);
    if (JSON.stringify(settings) !== before) {
      if (createdByInit === name && Object.keys(settings).length === 0) {
        // init が作り、他に何も書かれていないファイル → 元どおり「無い」に戻す
        rmSync(p, { force: true });
        r.removed.push(rel(p));
        log(`${rel(p)} は init が作ったもので他に中身が無いので消しました / removed (created by init, nothing else in it)`);
      } else {
        writeSettings(p, settings, raw);
        r.settings.push(rel(p));
        log(`${rel(p)} から hooks を外しました / removed hooks from ${rel(p)}`);
      }
    } else if (raw != null) {
      log(`${rel(p)}: ask-later の hooks はありません / no ask-later hooks`);
    }
  }
  const hookDir = join(root, HOOK_DIR);
  if (existsSync(hookDir)) {
    rmSync(hookDir, { recursive: true, force: true });
    r.removed.push(HOOK_DIR.replace(/\\/g, "/"));
  }
  r.removed.push(...removeSentinels(root, DEFAULTS.sentinelPrefix));
  const stateDir = join(root, STATE_DIR);
  if (existsSync(stateDir)) {
    rmSync(stateDir, { recursive: true, force: true });
    r.removed.push(STATE_DIR);
  }
  if (purge) {
    for (const name of [DEFAULTS.pending, DEFAULTS.inbox]) {
      const p = join(root, name);
      if (existsSync(p)) {
        rmSync(p, { force: true });
        r.removed.push(name);
      }
    }
  }
  return r;
}
