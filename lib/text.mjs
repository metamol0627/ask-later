// 小さな共通部品。ファイルは UTF-8（BOM を除いて読み、BOM 無しで書く）。
// PowerShell 5.1 が BOM 無しを CP932 として読む罠（この道具の移植元の記録）を、Node 側では作らない。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

// 無ければ null。読めない（ディレクトリ等）は例外（呼び出し側が「読めない」として扱う）
export function readText(path) {
  if (!existsSync(path)) return null;
  let s = readFileSync(path, "utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

// UTF-8 として読めない行（Notepad の ANSI＝CP932 で追記された行など）を行単位で Shift_JIS として読み直す。
// 返り値 { text, garbled }。garbled は「UTF-8 でなかった行」の数（0 なら全行 UTF-8）。Shift_JIS でも読めなければ U+FFFD のまま残す。
// ファイル全体を一括で再解釈しないのは、雛形（UTF-8）と追記（CP932）が混在したファイルで一括変換が失敗するため。
export function readTextLenient(path) {
  if (!existsSync(path)) return null;
  let buf = readFileSync(path);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  const strict = tryDecode(buf, "utf-8");
  if (strict != null) return { text: strict, garbled: 0 };
  const parts = [];
  let garbled = 0;
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      const line = buf.subarray(start, i);
      let s = tryDecode(line, "utf-8");
      if (s == null) {
        garbled++;
        s = tryDecode(line, "shift_jis") ?? line.toString("utf8");
      }
      parts.push(s);
      start = i + 1;
    }
  }
  return { text: parts.join("\n"), garbled };
}

function tryDecode(buf, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

// JSON を書き戻すときに元ファイルの体裁（字下げ幅・改行コード・末尾改行）を写す。元が無ければ 2 スペース・LF・末尾改行あり
export function detectJsonFormat(raw) {
  if (raw == null) return { indent: 2, eol: "\n", trailingNewline: true };
  const m = /^\r?\n?([ \t]+)"/m.exec(raw) ?? /\n([ \t]+)\S/.exec(raw);
  const indent = m ? (m[1].includes("\t") ? "\t" : m[1].length) : 2;
  return { indent, eol: detectEol(raw), trailingNewline: /\r?\n$/.test(raw) };
}

export function formatJson(value, { indent = 2, eol = "\n", trailingNewline = true } = {}) {
  let s = JSON.stringify(value, null, indent);
  if (eol !== "\n") s = s.replace(/\n/g, eol);
  return trailingNewline ? s + eol : s;
}

export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function detectEol(text) {
  return /\r\n/.test(text ?? "") ? "\r\n" : "\n";
}

export function splitLines(text) {
  return String(text ?? "").split(/\r?\n/);
}

// 一時ファイルに書いてから置き換える（途中で切れても元のファイルが半端にならない）
export function writeTextAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export const pad2 = (n) => String(n).padStart(2, "0");

// ローカル時刻 "YYYY-MM-DD HH:MM"（人が読む用。ファイルに書く）
export function formatLocal(d = new Date(), { seconds = false } = {}) {
  const s = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return seconds ? `${s}:${pad2(d.getSeconds())}` : s;
}

// "2026-09-11" + "21:30" → ローカル時刻の Date。読めなければ null
export function parseLocalDateTime(dateStr, timeStr = "23:59") {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeStr ?? "");
  if (!m || !t) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  // 2026-02-31 のような存在しない日付は Date が繰り上げるので、戻して比べる
  if (d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3] || d.getHours() !== +t[1]) return null;
  return d;
}

// 標準入力を最後まで読む。TTY（人が直接叩いた）なら読まない。timeoutMs で諦める（フックを固めない）
export function readStream(stream, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    if (!stream || stream.isTTY) return resolve("");
    let data = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        stream.pause();
      } catch {
        /* ignore */
      }
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    try {
      stream.setEncoding("utf8");
      stream.on("data", (c) => (data += c));
      stream.on("end", () => {
        clearTimeout(timer);
        finish();
      });
      stream.on("error", () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}
