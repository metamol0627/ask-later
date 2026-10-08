# ask-later — 実データで動かした記録（field log）

生成: 2026-09-16 00:22（`npm run fieldlog`）。入力はこの道具の移植元である lab の `PENDING_USER.md`（503 行・項目 27 件）と `INBOX.md`（25 行）の固定したコピー。2026-09-10 から実運用しているファイルで、テスト用に作ったものではない。個人情報（メールアドレス・長い数字・利用者名）は伏せ字にしてある。項目の題名は著者の環境の実題名のまま（FX のデモ口座・別商品の公開・文書名など）で、この道具とは関係ない。一般化すると「実データ」でなくなるので残している。

## 1. 入力の集計（フックを走らせる前）

- PENDING: 依頼 27 件（見出し `## [P-nnn]` で状態行を持つもの）。未処理 **5 件**、完了・取り下げ 22 件、状態行が崩れている 0 件。状態行を持たない見出し（報告 `## [R-nnn]`）9 件は依頼ではないので数えない
  - P-024 商品ページ（LP）と有償版の受け取りページを置く場所を決める（Cloudflare Pages の URL）
  - P-025 特定商取引法に基づく表記に載せる「販売者名」と「連絡先」を決める
  - P-026 clip-layer-tidy の公開リポジトリを GitHub に作るか（無ければ無いまま出せる。急がない）
  - P-027 デモ口座で USDJPY 0.01 を成行 Buy して放置する（番人 EA の残り 2 試験。クリック 1 回）
  - P-015 `.claude/` 配下の2ファイルと `CHARTER.md` を対話セッションで直す（1行ずつ。急がない）
- INBOX: 未読 **0 件**（区切り線より後ろの記載 1 行のうち、✔ 付き 1 行は既読）

## 2. 独立した実装（移植元 tools/queue.ps1・PowerShell 5.1）との照合

- queue.ps1: 未処理 5 件・INBOX 未読 0 件・ID P-024, P-025, P-026, P-027, P-015
- ask-later: 未処理 5 件・INBOX 未読 0 件・ID P-024, P-025, P-026, P-027, P-015
- 照合: **一致**

## 3. フックの実行（本物のファイルに対して。stdin は Claude Code が渡す形の JSON）

### 3-1. SessionStart（そのまま）

`SessionStart` ← stdin `{"source":"startup"}`

出力（exit 0）: hookSpecificOutput.additionalContext（359 文字）

```
【未処理の利用者依頼: 5件】PENDING.md を参照。
  - P-024 商品ページ（LP）と有償版の受け取りページを置く場所を決める（Cloudflare Pages の URL）
  - P-025 特定商取引法に基づく表記に載せる「販売者名」と「連絡先」を決める
  - P-026 clip-layer-tidy の公開リポジトリを GitHub に作るか（無ければ無いまま出せる。急がない）
  - P-027 デモ口座で USDJPY 0.01 を成行 Buy して放置する（番人 EA の残り 2 試験。クリック 1 回）
  - P-015 `.claude/` 配下の2ファイルと `CHARTER.md` を対話セッションで直す（1行ずつ。急がない）
これらに依存しない作業は続行してよい。
```

番兵: !pending_5.txt

SessionStart 後の PENDING ヘッダ行: `未処理: 5件 / INBOX未読: 0件 / 最終集計: 2026-09-16 00:22`

### 3-2. PostToolUse（未読 0 なので何も出ない）

`PostToolUse` ← stdin `{"tool_name":"Read","tool_input":{"file_path":"STATUS.md"}}`

出力なし（exit 0）——期待どおり

番兵: !pending_5.txt

### 3-3. Stop（未読 0 なので通す）

`Stop` ← stdin `{"stop_hook_active":false}`

出力なし（exit 0）——期待どおり

番兵: !pending_5.txt

> ここで人が INBOX.md の末尾に 1 行書く: `P-024 A https://example.pages.dev`

### 3-4. PostToolUse（未読 1 → 注入）

`PostToolUse` ← stdin `{"tool_name":"Read","tool_input":{"file_path":"STATUS.md"}}`

出力（exit 0）: hookSpecificOutput.additionalContext（161 文字）

```
【INBOX.md に利用者の記載: 1件】チャットの発言と同じ扱いで読み、実行する。
  > P-024 A https://example.pages.dev
P-xxx の完了報告なら PENDING.md の該当項目を解消する。命令・質問・提案ならそのまま扱う。
処理した行の行頭に ✔ を付ける（行は消さない）。
```

番兵: !pending_5.txt

### 3-5. PostToolUse（同じ集合 → 繰り返さない）

`PostToolUse` ← stdin `{"tool_name":"Read"}`

出力なし（exit 0）——期待どおり

番兵: !pending_5.txt

### 3-6. UserPromptSubmit（未読があれば毎回）

`UserPromptSubmit` ← stdin `{"prompt":"続けて"}`

出力（exit 0）: hookSpecificOutput.additionalContext（161 文字）

```
【INBOX.md に利用者の記載: 1件】チャットの発言と同じ扱いで読み、実行する。
  > P-024 A https://example.pages.dev
P-xxx の完了報告なら PENDING.md の該当項目を解消する。命令・質問・提案ならそのまま扱う。
処理した行の行頭に ✔ を付ける（行は消さない）。
```

番兵: !pending_5.txt

### 3-7. Stop（未読 1 → 差し止め）

`Stop` ← stdin `{"stop_hook_active":false}`

出力（exit 0）: **decision: block**

```
停止前に INBOX.md の未読 1 件を処理すること。
【INBOX.md に利用者の記載: 1件】チャットの発言と同じ扱いで読み、実行する。
  > P-024 A https://example.pages.dev
P-xxx の完了報告なら PENDING.md の該当項目を解消する。命令・質問・提案ならそのまま扱う。
処理した行の行頭に ✔ を付ける（行は消さない）。
```

番兵: !pending_5.txt

### 3-8. Stop（stop_hook_active → 通す。無限ループ防止）

`Stop` ← stdin `{"stop_hook_active":true}`

出力なし（exit 0）——期待どおり

番兵: !pending_5.txt

> ここでエージェントが処理し、行頭に ✔ を付ける

### 3-9. Stop（✔ 後は未読 0 → 通す）

`Stop` ← stdin `{"stop_hook_active":false}`

出力なし（exit 0）——期待どおり

番兵: !pending_5.txt

### 3-10. SessionEnd（番兵の更新。出力は使われない）

`SessionEnd` ← stdin `{"reason":"other"}`

出力なし（exit 0）——期待どおり

番兵: !pending_5.txt

### 番兵ファイルの中身

```
利用者にお願いしたいことが 5 件あります。

内容      : PENDING.md を開いてください
完了報告  : INBOX.md に1行書いてください（例: P-003 done）

未処理の項目:
  - P-024 商品ページ（LP）と有償版の受け取りページを置く場所を決める（Cloudflare Pages の URL）
  - P-025 特定商取引法に基づく表記に載せる「販売者名」と「連絡先」を決める
  - P-026 clip-layer-tidy の公開リポジトリを GitHub に作るか（無ければ無いまま出せる。急がない）
  - P-027 デモ口座で USDJPY 0.01 を成行 Buy して放置する（番人 EA の残り 2 試験。クリック 1 回）
  - P-015 `.claude/` 配下の2ファイルと `CHARTER.md` を対話セッションで直す（1行ずつ。急がない）

このファイルは自動生成されます。消しても構いません（次回の集計で再生成されます）。
最終更新: 2026-09-16 00:22:28
```

### hook.log（.ask-later/hook.log）

```
2026-09-16 00:22:28  SessionStart     [fieldlog] 注入（未処理 5・未読 0）
2026-09-16 00:22:28  PostToolUse      [fieldlog] -（未処理 5・未読 0）
2026-09-16 00:22:28  Stop             [fieldlog] -（未処理 5・未読 0）
2026-09-16 00:22:28  PostToolUse      [fieldlog] 注入（未処理 5・未読 1）
2026-09-16 00:22:28  PostToolUse      [fieldlog] -（未処理 5・未読 1）
2026-09-16 00:22:28  UserPromptSubmit [fieldlog] 注入（未処理 5・未読 1）
2026-09-16 00:22:28  Stop             [fieldlog] 差し止め（未読 1）
2026-09-16 00:22:28  Stop             [fieldlog] -（未処理 5・未読 1）
2026-09-16 00:22:28  Stop             [fieldlog] -（未処理 5・未読 0）
2026-09-16 00:22:28  SessionEnd       [fieldlog] -（未処理 5・未読 0）
```

## 4. 読み方

- 3-1 で未処理の一覧が注入され、番兵 `!pending_N.txt` が置かれる。件数は 1 節の集計と一致する
- 3-4 → 3-5 で「同じ未読集合は繰り返さない」が、3-6 で「人の入力の直後は毎回」が効いている
- 3-7 → 3-8 → 3-9 が差し止めの往復。`stop_hook_active` で通し、✔ を付ければ通る
- 期限切れの自動取り下げ: この入力では 該当なし（期限行を持つ未処理が無い）

実行環境: Node 24.19.0 / win32。再現は `npm run fieldlog`（tests/fixtures/real/ に実データが要る）。
