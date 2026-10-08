#!/usr/bin/env node
// 入口。Node の版を先に見てから本体を読む（古い Node でも読める文で止まるように）。
const major = Number(process.versions.node.split(".")[0]);
if (!(major >= 20)) {
  console.error(`エラー: Node.js 20 以上が必要です（今は ${process.versions.node}）/ Node.js >= 20 is required`);
  process.exit(1);
}
const { runCli } = await import("../lib/cli.mjs");
const code = await runCli(process.argv.slice(2));
// stdout を書き切ってから終える（フックの JSON が途中で切れないように）
if (process.stdout.writableLength > 0) process.stdout.write("", () => process.exit(code));
else process.exit(code);
