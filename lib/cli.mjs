// CLI。エラーは 1〜2 行の日本語（英語併記）で exit 1。スタックトレースは出さない。
// `hook` サブコマンドだけは何があっても exit 0（本体を止めない）。
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { init, uninit, snippet, hookCopyVersion, UserError } from "./install.mjs";
import { loadConfig } from "./config.mjs";
import { summarize, humanError } from "./queue.mjs";
import { notify } from "./notify.mjs";
import { main as hookMain, EVENTS } from "./hook.mjs";
import { msg, LANGS } from "./messages.mjs";
import { isDirectory } from "./text.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function version() {
  try {
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
  } catch {
    return "?";
  }
}

export const USAGE = `ask-later ${version()} — 聞いて、待たずに進む / ask now, get the answer later

使い方 / usage:
  npx ask-later init [--lang ja|en] [--dir <project>] [--force] [--local] [--no-hooks] [--no-files] [--no-claude-md] [--no-gitignore] [--shell]
      .claude/settings.json に hooks をマージし（--local なら settings.local.json）、PENDING.md / INBOX.md の雛形と
      .claude/ask-later/（フック本体の写し）を置き、CLAUDE.md に規律の断片・.gitignore に 2 行を足す（無いときだけ）。
      既存の雛形は --force が無ければ触らない。--shell はフックを shell 形式（node "\${CLAUDE_PROJECT_DIR}/…" Event）で書く
  npx ask-later uninit [--dir <project>] [--purge]
      hooks と .claude/ask-later/・番兵・.ask-later/ を外す。PENDING.md / INBOX.md は --purge のときだけ消す（CLAUDE.md / .gitignore は触らない）
  npx ask-later status [--dir <project>] [--json] [--dry-run]
      未処理の件数・INBOX の未読・番兵の状態（期限切れの自動取り下げも行う。--dry-run なら読むだけ）
  npx ask-later notify [--dir <project>] [message]
      OS 通知を 1 回出す（動作確認用）
  npx ask-later snippet [--lang ja|en]
      CLAUDE.md に貼る規律の断片を出す
  npx ask-later hook <${EVENTS.join("|")}>
      フック本体（Claude Code が呼ぶ。stdin に JSON）。常に exit 0
  npx ask-later --version / --help
`;

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      if (["lang", "dir"].includes(key)) {
        if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new UserError(`--${key} には値が要ります / --${key} needs a value`);
        flags[key] = argv[++i];
      } else flags[key] = true;
      continue;
    }
    rest.push(a);
  }
  return { flags, rest };
}

function resolveRoot(flags, cwd) {
  const root = resolve(cwd, flags.dir ?? ".");
  if (!isDirectory(root)) throw new UserError(`ディレクトリがありません / no such directory: ${root}`);
  return root;
}

export async function runCli(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, env = process.env } = {}) {
  const out = (s) => stdout.write(s.endsWith("\n") ? s : s + "\n");
  const err = (s) => stderr.write(s.endsWith("\n") ? s : s + "\n");
  let flags, rest;
  try {
    ({ flags, rest } = parseArgs(argv));
  } catch (e) {
    err(`エラー: ${e.message}`);
    return 1;
  }
  const command = rest[0];

  if (flags.version || command === "version") {
    out(version());
    return 0;
  }
  if (flags.help || !command || command === "help") {
    out(USAGE);
    return command || flags.help ? 0 : 1;
  }

  // フックは常に exit 0。ここでは例外も握る
  if (command === "hook") {
    try {
      const root = env.CLAUDE_PROJECT_DIR || resolve(cwd, flags.dir ?? ".");
      const r = await hookMain(rest[1], { root, stdin, version: version() });
      if (r.output) stdout.write(r.output);
    } catch {
      /* 止めない */
    }
    return 0;
  }

  try {
    switch (command) {
      case "init": {
        const root = resolveRoot(flags, cwd);
        const lang = flags.lang ?? "ja";
        if (!LANGS.includes(lang)) throw new UserError(`--lang は ${LANGS.join(" | ")} のどれかです / --lang must be one of ${LANGS.join(" | ")}: ${lang}`);
        const r = await init(root, {
          lang,
          force: !!flags.force,
          local: !!flags.local,
          hooks: !flags["no-hooks"],
          files: !flags["no-files"],
          form: flags.shell ? "shell" : "exec",
          claudeMd: !flags["no-claude-md"],
          gitignore: !flags["no-gitignore"],
        });
        if (r.created.length) out(`作成 / created:  ${r.created.join(", ")}`);
        if (r.updated.length) out(`更新 / updated:  ${r.updated.join(", ")}`);
        if (r.skipped.length) out(`そのまま / kept: ${r.skipped.join(", ")}（雛形は --force で上書き / templates: overwrite with --force）`);
        if (r.hookDir) out(`フック本体 / hook files: .claude/ask-later/ ${version()}（更新は npx ask-later@latest init / re-run to update）`);
        out("");
        out(lang === "en" ? "Next:" : "次にやること:");
        const touchedClaudeMd = r.claudeMd === "created" || r.claudeMd === "appended";
        const en = [
          flags["no-claude-md"] ? "Paste `npx ask-later snippet --lang en` into CLAUDE.md (the rule the agent follows)" : touchedClaudeMd ? "CLAUDE.md now has the rule the agent follows (`## Async queue (ask-later)`). Read it once" : null,
          flags["no-gitignore"] ? "Add `.ask-later/` and `\\!pending_*.txt` to .gitignore (the backslash matters: a leading ! negates)" : null,
          "Start claude. Then write one line below the `---` in INBOX.md (e.g. `test: reply \"read\" if you can see this`) and send any prompt — the line gets a leading ✔ (that is the check; the reply usually contains it too). `npx ask-later status` shows the counts",
        ].filter(Boolean);
        const ja = [
          flags["no-claude-md"] ? "`npx ask-later snippet` の出力を CLAUDE.md に貼る（エージェントが守る規律）" : touchedClaudeMd ? "CLAUDE.md にエージェントが守る規律（`## 非同期キュー（ask-later）`）を足した。一度読んでおく" : null,
          flags["no-gitignore"] ? ".gitignore に `.ask-later/` と `\\!pending_*.txt` を足す（! で始まる名前は \\ が要る）" : null,
          "claude を起動する。INBOX.md の `---` の下に 1 行（例: `テスト: これが読めたら「読めた」と返して`）書いて何か入力すると、その行の行頭に ✔ が付く（これが確認。返事にも大抵出る）。`npx ask-later status` で件数を見る",
        ].filter(Boolean);
        (lang === "en" ? en : ja).forEach((line, i) => out(`  ${i + 1}. ${line}`));
        return 0;
      }
      case "uninit": {
        const root = resolveRoot(flags, cwd);
        const r = await uninit(root, { purge: !!flags.purge, log: out });
        if (r.removed.length) out(`削除 / removed: ${r.removed.join(", ")}`);
        if (!r.settings.length && !r.removed.length) out("外すものがありませんでした / nothing to remove");
        return 0;
      }
      case "status": {
        const root = resolveRoot(flags, cwd);
        const config = loadConfig(root);
        const m = msg(config.lang);
        const r = await summarize(root, config, { expire: true, notify: false, write: !flags["dry-run"] });
        const copyVersion = hookCopyVersion(root);
        if (flags.json) {
          out(JSON.stringify({
            root, pendingExists: r.pendingExists, inboxExists: r.inboxExists, openCount: r.openCount, openItems: r.openItems.map((it) => ({ id: it.id, title: it.title })),
            withdrawn: r.withdrawn, malformed: r.malformed, inboxUnread: r.inboxUnread, inboxLines: r.inboxLines, inboxGarbled: r.inboxGarbled, sentinel: r.sentinel,
            hookVersion: copyVersion, packageVersion: version(),
            errors: [config.error, r.pendingError && `${config.pending}: ${r.pendingError}`, r.inboxError && `${config.inbox}: ${r.inboxError}`, ...r.writeErrors].filter(Boolean),
          }, null, 2));
          return 0;
        }
        if (config.error) out(m.warnWrite(config.error));
        if (!r.pendingExists) out(m.statusMissing(config.pending) + (r.pendingError ? `（${r.pendingError}）` : ""));
        else {
          out(m.statusPending(r.openCount));
          for (const it of r.openItems) out(`  - ${it.id} ${it.title}${it.deadline ? `（期限 / due ${it.deadline.toISOString().slice(0, 10)}）` : ""}`);
          for (const id of r.withdrawn) out(m.statusWithdrawn(id));
          if (r.malformed.length) out(m.statusMalformed(r.malformed));
        }
        if (!r.inboxExists) out(m.statusMissing(config.inbox) + (r.inboxError ? `（${r.inboxError}）` : ""));
        else {
          out(m.statusInbox(r.inboxUnread));
          for (const t of r.inboxLines) out(`  > ${t}`);
          if (r.inboxGarbled > 0) out(m.statusGarbled(r.inboxGarbled, config.inbox));
        }
        out(m.statusSentinel(r.sentinel ? r.sentinel.slice(root.length + 1) : null, r.openCount));
        if (copyVersion !== null || isDirectory(join(root, ".claude", "ask-later"))) out(m.statusHookVersion(copyVersion, version()));
        for (const e of r.writeErrors) out(m.warnWrite(e));
        return 0;
      }
      case "notify": {
        const root = resolveRoot(flags, cwd);
        const config = loadConfig(root);
        const body = rest.slice(1).join(" ") || (config.lang === "en" ? "Test notification from ask-later" : "ask-later の通知テストです");
        const r = await notify({ title: "ask-later", body });
        out(r.ok ? `通知を出しました / sent（${r.method}）` : `通知を出せませんでした / could not notify（${r.method ?? "-"}: ${r.error ?? "?"}）。番兵ファイルは動きます / the sentinel file still works`);
        return r.ok ? 0 : 1;
      }
      case "snippet": {
        const lang = flags.lang ?? "ja";
        if (!LANGS.includes(lang)) throw new UserError(`--lang は ${LANGS.join(" | ")} のどれかです / --lang must be one of ${LANGS.join(" | ")}: ${lang}`);
        stdout.write(snippet(lang));
        return 0;
      }
      default:
        err(`エラー: 知らないコマンドです / unknown command: ${command}\n`);
        err(USAGE);
        return 1;
    }
  } catch (e) {
    if (e instanceof UserError) err(`エラー: ${e.message}`);
    else if (e && (e.code === "EACCES" || e.code === "EPERM" || e.code === "EROFS" || e.code === "EBUSY")) err(`エラー: ${msg("ja").errWrite(e.path ?? "")} / ${msg("en").errWrite(e.path ?? "")}`);
    else err(`エラー: 予期しない失敗です / unexpected failure: ${e?.message ?? e}`);
    return 1;
  }
}
