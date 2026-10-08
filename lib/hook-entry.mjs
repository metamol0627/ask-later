#!/usr/bin/env node
// ask-later のフック入口。`npx ask-later init` がこのファイルを <project>/.claude/ask-later/hook.mjs に写し、
// 同じ場所の lib/ に本体を、VERSION に写したときのパッケージの版を写す。パッケージの置き場所（npx のキャッシュ・
// node_modules）に依存しないための写しであり、更新は `npx ask-later@latest init` で上書きする。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { main } from "./lib/hook.mjs";

const here = dirname(fileURLToPath(import.meta.url)); // <project>/.claude/ask-later
const root = resolve(here, "..", "..");
let version = null;
try {
  version = readFileSync(join(here, "VERSION"), "utf8").trim() || null;
} catch {
  /* 古い写し（VERSION 無し） */
}
const r = await main(process.argv[2], { root, version });
if (r.output) process.stdout.write(r.output, () => process.exit(r.exitCode));
else process.exit(r.exitCode);
