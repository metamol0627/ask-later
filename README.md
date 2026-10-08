# ask-later — Claude Code が質問で止まらない（聞いて、待たずに進む・非同期の質問キュー）

**Claude Code を無人で回すと「確認していいですか」で止まります。その質問を後回しにして、作業を続けさせる——ファイル 2 つとフック 5 つ**です。
ツールの許可（許可リストや自動承認）は設定で決まりますが、人の判断が要る「質問」は設定では答えられません。ask-later が扱うのはこちらです。
エージェントは人に聞きたいことを `PENDING.md` に起票して、それに依存する作業だけを止め、残りを続けます。
人はメモ帳で `INBOX.md` に 1 行書くだけ。フックが次のツール呼び出しでその行をエージェントの文脈に注入し、
未読が残ったまま終わろうとすると差し止めます（既定 2 回）。プロジェクトのルートに置かれる `!pending_3.txt` という名前のファイルが「未処理 3 件」を示します。

Node.js 20 以上・依存パッケージなし・MIT・非公式。**Claude Code 専用**です——Claude Code のフック契約（stdin の JSON・`hookSpecificOutput.additionalContext`・`decision: block`）だけで動き、他のコーディングエージェントの経路は持っていません。
使うイベントは `SessionStart` / `UserPromptSubmit` / `PostToolUse` / `Stop` / `SessionEnd`。
動作確認は Windows 11・Node 24・Claude Code 2.1.268 のみ（macOS／Linux は未確認）。

別売りで「無人運転の設計書」（¥1,480）があります → [販売ページ](https://lab-cws.pages.dev/ask-later/)（詳しくは末尾「設計書」）。この道具そのものは無料です。

> **先に読んでください（何を書き換えるか）**
>
> - `npx ask-later init` が書き換えるのは **`.claude/settings.json` の `hooks`**（他のキーは触りません。既にあるフックも残します）、
>   **`CLAUDE.md`**（末尾に `## 非同期キュー（ask-later）` の断片を足します。既にあれば触りません。`--no-claude-md` で抑止）、
>   **`.gitignore`**（`.ask-later/` と `\!pending_*.txt` の 2 行。無い行だけ。`--no-gitignore` で抑止）の 3 つです。
>   加えて `.claude/ask-later/`（フック本体の写し）、`PENDING.md`・`INBOX.md`（既にあれば触りません）、`.ask-later/config.json` を作ります。
>   **`npx ask-later uninit` で `settings.json` は同じ内容に戻ります**（字下げ幅・改行コード・末尾改行の有無も元のまま。自動テストで 2 スペース／4 スペース／タブ／CRLF／末尾改行なしを確認。
>   ただし配列を 1 行に畳んで手書きした settings.json は、内容は同じでも配列が展開された体裁になります）。`CLAUDE.md` と `.gitignore` に足した行は人の文書なので残します
> - **フックは何があっても終了コード 0 で終わり、エージェントの作業を止めません。**`INBOX.md` が無い・壊れている・stdin が JSON でない・
>   書き込めない、どれでも黙って通し、読める 1 行を `.ask-later/hook.log` に残すだけです
> - 終了の差し止め（`Stop` フックの `decision: block`）は **同じ未読の集合・同じセッションにつき既定 2 回**です（`.ask-later/config.json` の `stopBlockMax`。0 で差し止めなし、上限 7）。
>   Claude Code 本体が連続 8 回の差し止めで打ち切る仕様なので、上限 7 で無限ループにはなりません。回数を使い切った後は、エージェントが注入を無視すれば未読が残ったまま終わります。番兵ファイルと `npx ask-later status` で人が気づけます
> - OS 通知（Windows のトースト／macOS の `osascript`／Linux の `notify-send`）は補助で、出せない環境では何も起きません。**第一の通知手段は音の出ない番兵ファイル**です
> - Claude Code のフックの仕様（`additionalContext`・`decision: block`）に依存しています。仕様が変われば動かなくなります
> - 非公式の道具です。Claude および Claude Code は Anthropic, PBC の商標であり、作者は Anthropic とは無関係です

## 必要なもの

- **Node.js 20 以上**（https://nodejs.org/ の「LTS」で足ります。それより古い Node では理由を表示して止まります）
- **Claude Code**（フックが使える版。`claude --version` で確認。動作確認は 2.1.268）
- プロジェクトのディレクトリ（`.claude/settings.json` を置く場所。無ければ作ります）

## 使い方（上から順に）

### 1. 入れる

プロジェクトのルートで実行します。

```
npx ask-later init
```

```
作成 / created:  PENDING.md, INBOX.md, .ask-later/config.json, CLAUDE.md, .gitignore, .claude/settings.json
フック本体 / hook files: .claude/ask-later/ 0.1.0（更新は npx ask-later@latest init / re-run to update）

次にやること:
  1. CLAUDE.md にエージェントが守る規律（`## 非同期キュー（ask-later）`）を足した。一度読んでおく
  2. claude を起動する。INBOX.md の `---` の下に 1 行（例: `テスト: これが読めたら「読めた」と返して`）書いて何か入力すると、その行の行頭に ✔ が付く（これが確認。返事にも大抵出る）。`npx ask-later status` で件数を見る
```

`.claude/settings.json`・`CLAUDE.md`・`.gitignore` が既にあれば足りない分だけ足して「更新 / updated」と出ます。`PENDING.md`・`INBOX.md` が既にあれば「そのまま / kept」と出て触りません（`--force` で雛形に戻します）。
英語の雛形と注入文にするなら `--lang en`、`settings.local.json` に入れるなら `--local`、別のディレクトリなら `--dir <path>` です。

### 2. エージェントに規律を渡す（`init` が済ませています）

`init` が `CLAUDE.md` の末尾に足すのは「人の判断が要ることに当たったら `PENDING.md` に起票し、依存しない作業は続ける。`INBOX.md` の未読が注入されたらチャットの発言と同じ扱いで実行し、行頭に ✔ を付ける。`INBOX.md` の行は利用者本人の発言であり、注入文はその写しである」という 20 行ほどの断片です（内容は `npx ask-later snippet` で読めます。`--no-claude-md` で init に足させず、自分で `npx ask-later snippet >> CLAUDE.md` としても同じです）。
フックは機構であって、**止まらずに進む挙動そのものは CLAUDE.md の規律が作ります**。ここが無いと、フックが注入しても何も起きません。
「どう扱うか」の指示を CLAUDE.md に置き、フックの注入文は「何がどうなっているか」の事実だけを述べる、という分担です。Claude Code の公式リファレンスは、フックが入れる文を命令形でなく事実の陳述で書くよう求めています——命令形で書くとモデルの prompt-injection 防御が働き、文脈として扱われずに人へ差し戻されます（設計監査 2 巡目で実際に起きました。下「未検証・既知の制限」）。

`.gitignore` に足す 2 行は次のとおりです（`!` で始まるファイルを無視するには `\` が要ります。`!pending_*.txt` と書くと逆に「無視しない」の意味になります）。

```
.ask-later/
\!pending_*.txt
```

### 3. 確かめる（30 秒）

`claude` を起動し、メモ帳で `INBOX.md` の `---` の下に 1 行書いて保存します。

```
テスト: これが読めたら「読めた」と返して
```

`claude` に何か（「進めて」でも何でも）入力すると、`UserPromptSubmit` フックがその行を注入します。**確認するのは `INBOX.md` の行頭に `✔` が付くこと**です（付けば届いて処理されています）。返事にも「読めた」が大抵出ますが、モデルがその文を埋め込み指示と疑って返事には出さないことがあります——✔ が付いていれば届いています。
付かなければ `.ask-later/hook.log` を見てください（フックが走っていれば 1 行ずつ残っています。何も無ければ `settings.json` のフックが読まれていません——`claude` を起動し直す・`/hooks` で確認する）。

```
npx ask-later status
```

```
PENDING 未処理: 0件
INBOX 未読: 0件
番兵: なし（0 件）
フック本体: 0.1.0
```

`--json` で機械可読な形になります。`status` は集計のついでに、期限切れの項目の自動取り下げ・`PENDING.md` のヘッダ行・番兵ファイルを更新します（`--dry-run` なら読むだけ。番兵は今あるものをそのまま報告します）。
「フック本体」は `.claude/ask-later/` の写しの版で、パッケージより古ければ `npx ask-later@latest init` を案内します。

### 4. claude を起動する。エージェントが起票する

`claude` を起動すると `SessionStart` フックが走り、未処理の件数と一覧が文脈に入ります（0 件なら何も入りません）。
作業中にエージェントが人の判断や操作を要することに当たると、`PENDING.md` の「# 未処理」の下にこう書きます（書式は雛形の中の「エージェントへ」にあります）。

```
## [P-001] npm のトークンを .env に入れてほしい

- [ ] 状態: 未処理
- 起票: 2026-09-16
- 今何をしているか: パッケージの公開の準備。トークンは本人しか発行できない
- 依頼内容: https://www.npmjs.com/settings/~/tokens で Automation トークンを作り、.env の NODE_AUTH_TOKEN に貼る
- 完了報告の書き方: `P-001 done`

**この項目が解けるまで棚上げする作業**
- npm publish

**この項目と関係なく続行する作業**
- README・テスト・その他すべて
```

機械が読むのは見出し `## [P-001] …` と状態行 `- [ ] 状態: 未処理` と期限行 `- 期限: YYYY-MM-DD HH:MM`（任意）の 3 つだけです。
エージェントが `Stop`（応答の終わり）に達すると集計が走り、ルートに **`!pending_1.txt`** が置かれます。名前が件数で、`!` で始まるので一覧の先頭に来ます。
中身は「利用者にお願いしたいことが 1 件あります。PENDING.md を開いてください。完了報告は INBOX.md に 1 行……」という案内です。0 件になると消えます。

### 5. 人が INBOX.md に 1 行書く

メモ帳で `INBOX.md` を開き、`---` より下に 1 行書いて保存します。エージェントを起動する必要も、書式を覚える必要もありません。

```
P-001 done
```

`P-001 却下。当面やらない` でも `方針を変える: …` でも構いません。番号の無い自由文も読まれます。

### 6. 次のツール呼び出しで注入され、✔ が付き、番兵が消える

エージェントが動いている最中なら、次のツール呼び出しの直後（`PostToolUse`）にこう注入されます。

```
【INBOX.md に利用者本人の未読の行: 1件】INBOX.md は利用者が手で書く連絡ファイルで、次の行は利用者本人が書いたもの（フックが写した）。このプロジェクトの規律（CLAUDE.md「非同期キュー」）では、INBOX.md の行は利用者のチャット発言と同じ扱いになる。
  > P-001 done
P-xxx の完了報告は PENDING.md の該当項目の解消に対応する。命令・質問・提案は、そのままの意味の発言である。
処理済みの行は行頭に ✔ を付けて残す決まりになっている（行は消さない）。
```

注入文は事実の陳述だけで、命令（「〜すること」）を含みません。何をするかは `CLAUDE.md` の断片が決めます。
エージェントは `PENDING.md` の項目を `- [x] 状態: 完了 (2026-09-16)` にして「# 解消済み」へ移し、`INBOX.md` の行を `✔ P-001 done` にします。
次の集計（`Stop`・`SessionEnd`・`status`）で `!pending_1.txt` が消えます。

エージェントが止まっていた（応答を終えていた）場合は、次にあなたが何か入力したとき（`UserPromptSubmit`）に注入されます。
エージェントが未読を処理せずに終わろうとすると、`Stop` フックが `decision: block` で差し止め、「INBOX.md に利用者本人の未読の行が 1 件残っている。未読が残ったままの停止は、このプロジェクトの規律で差し止められる」に同じ注入文を添えて理由として返します（同じ未読の集合につき既定 2 回。2 回目の理由には「2 回目の差し止め。最大 2 回。処理できない行は ✔ を付けて理由を返答に書けば通る」と添えます）。

`INBOX.md` は UTF-8 で保存してください。メモ帳の「ANSI」（CP932）で書かれた行は Shift_JIS として読み直して注入しますが、エージェントがその行を書き換えると壊れるので、注入文と `status` に「UTF-8 で保存し直してください」と出ます。

## フックが何をするか

| イベント | 読む | 書く | 出す |
|---|---|---|---|
| `SessionStart` | PENDING / INBOX | 期限切れの取り下げ・ヘッダ行・番兵・`.ask-later/state.json` | 未処理の件数と一覧（30 件を超えると「ほか N 件」）、期限切れで取り下げた ID、INBOX の未読、状態行が崩れた項目、PENDING.md が無いときの案内（`additionalContext`） |
| `UserPromptSubmit` | INBOX | state.json（署名。そのセッションの差し止め回数を 0 に戻す） | 未読があれば毎回、その全行 |
| `PostToolUse` | INBOX | state.json（署名） | 未読の**集合が前回の注入から変わったときだけ**、その全行（同じ内容を毎ツール呼び出しで繰り返さない）。署名は `session_id` と（サブエージェントの中なら）`agent_id` ごとに持つので、サブエージェントが先に受け取っても本体にも届く |
| `Stop` | PENDING / INBOX | 取り下げ・ヘッダ行・番兵・state.json | 未読があれば `{"decision":"block","reason":…}`（同じ集合・同じセッションにつき `stopBlockMax` 回。既定 2。回数はセッションごとに持つので、別のセッションの `Stop` が割り込んでも数え直さない）。未処理の集合が新しければ OS 通知 |
| `SessionEnd` | PENDING / INBOX | 取り下げ・ヘッダ行・番兵・state.json | 何も出さない（Claude Code は読まない）。OS 通知も出さない（SessionEnd の予算は既定 1.5 秒で、通知が間に合わない。Stop が同じ条件で出している） |

フックのエントリは exec 形（シェルを通さない）で、`${CLAUDE_PROJECT_DIR}` は Claude Code が `args` の中でも置き換えます。絶対パスを書かないので `settings.json` をそのままリポジトリで共有できます。

```json
{ "type": "command", "command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs", "Stop"], "timeout": 20 }
```

タイムアウトは 15〜20 秒を明示しています。公式の既定は command フックが 600 秒（`UserPromptSubmit` は 30 秒）で集計には十分ですが、`SessionEnd` だけは既定 1.5 秒の共有予算で、`settings.json` の各フックの `timeout` で最大 60 秒まで延びます（プラグイン形の `timeout` では延びません）。既定に依存しないよう全部に書いています。
本体はプロジェクトの `.claude/ask-later/` に写してあるので、`npx` のキャッシュや `node_modules` が消えても動きます。
更新は `npx ask-later@latest init` を再実行します（自分のフックを外してから足すので、増えません。写しの版は `.claude/ask-later/VERSION` にあり、`status` が古ければ知らせます）。

ツール呼び出しごとに `node` が 1 回起動します（この環境で数十 ms）。ログは `.ask-later/hook.log`（1 MB で 1 世代回します。`--lang en` なら英語）。各行の `[abcdef12]` は `session_id` の先頭 8 字で、サブエージェント（`Agent` ツール）の中で走ったときは `[abcdef12/a22f82b7]` と `agent_id` が付きます。

## ファイルの書式

### PENDING.md

```
# 未処理

## [P-001] タイトル
- [ ] 状態: 未処理
- 期限: 2026-09-20 18:00        ← 任意。過ぎると「- [x] 状態: 取り下げ（期限 … を過ぎたため自動。実施の有無は INBOX の報告で確定する）」に書き換わる

# 解消済み

## [P-000] 済んだもの
- [x] 状態: 完了 (2026-09-15)
```

- 見出しは `## [ID] タイトル`（`##` だけ。`###` 以下は項目になりません）。ID は `P-001` の形でなくても構いません（`[x]` の `x` は大文字でも可）。箇条書きの記号は `-` のほか `*` `+` でも読みます
- 状態行が無く、チェックボックス付きの箇条書きも無い見出し（例: `## [R-010] 報告`）は依頼ではないので数えません。チェックボックスはあるのに状態行の書式が違う項目は「状態行が崩れている」として数えず、注入で知らせます
- 期限切れで自動取り下げになった項目は状態行だけが書き換わり、`# 未処理` の見出しの下に残ります（機械は行を動かしません）。エージェントが区切りで `# 解消済み` へ移します（雛形の「エージェントへ」にそう書いてあります）
- コードブロック（` ``` ` / `~~~`）の中は読みません（雛形の書き方の例が項目に数えられないように）
- 3 行目の `未処理: N件 / INBOX未読: M件 / 最終集計: …` は集計のたびに書き換わります（無ければ何もしません）
- 改行コード（CRLF / LF）はそのまま保ちます。書き込みは一時ファイル経由（途中で切れても元のファイルが半端になりません）
- 英語版の書式は `- [ ] status: open` / `- [x] status: done` / `- [x] status: withdrawn (…)` / `- due: …`（`--lang en` の雛形）

### INBOX.md

- 最初の `---`（水平線）より後ろの行を読みます。加えて、最初の見出し（`# `）より前に書かれた行も読みます（ファイルの先頭に書いてしまう人がいたため）
- 空行、見出し（`#` の後に空白がある行。`#1 done` のような行は読みます）、`>` で始まる行、水平線は読みません。行頭に `✔`（`✓` `✅` も可）が付いた行は処理済みです
- 行は消さず、✔ を付けて残します（記録になります）
- UTF-8 で保存します。UTF-8 でない行（メモ帳の ANSI）は Shift_JIS として読み直しますが、注入文と `status` に保存し直すよう注意が出ます

## 設定（`.ask-later/config.json`）

`init` が既定値で作ります。無くても、壊れていても動きます（壊れていれば `status` が注意を出します）。

```json
{
  "lang": "ja",
  "pending": "PENDING.md",
  "inbox": "INBOX.md",
  "sentinelPrefix": "!pending_",
  "quietHours": { "start": 21, "end": 8 },
  "notify": true,
  "stopBlockMax": 2
}
```

| 項目 | 意味 |
|---|---|
| `lang` | 注入文・番兵・status・hook.log の言語（`ja` / `en`） |
| `pending` / `inbox` | ファイル名（ルート直下。パス区切りは使えません） |
| `sentinelPrefix` | 番兵ファイルの接頭辞。`<prefix><件数>.txt` |
| `quietHours` | この時間帯は OS 通知を鳴らさず、翌朝の最初の集計に持ち越します（`start === end` で静音なし） |
| `notify` | `false` で OS 通知を止めます。環境変数 `ASK_LATER_NO_NOTIFY=1` でも止まります（CI・テスト用） |
| `stopBlockMax` | `Stop` の差し止め回数（同じ未読の集合・同じセッションにつき）。`0` で差し止めなし、上限 `7`（Claude Code 本体が連続 8 回で打ち切るため）。未読の集合が変わったとき、または人が次の入力をしたとき（`UserPromptSubmit`）に数え直します——人の 1 入力につき最大この回数 |

OS 通知は「未処理の集合が前回通知したときと変わった」ときだけ鳴ります。同じ集合に二度は鳴りません。`npx ask-later notify` で 1 回鳴らして確かめられます。

## コマンド

```
npx ask-later init [--lang ja|en] [--dir <project>] [--force] [--local] [--no-hooks] [--no-files] [--no-claude-md] [--no-gitignore] [--shell]
npx ask-later uninit [--dir <project>] [--purge]
npx ask-later status [--dir <project>] [--json] [--dry-run]
npx ask-later notify [--dir <project>] [message]
npx ask-later snippet [--lang ja|en]
npx ask-later hook <SessionStart|UserPromptSubmit|PostToolUse|Stop|SessionEnd>
npx ask-later --version / --help
```

- `init` の既定は exec 形 `{"command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/ask-later/hook.mjs","Stop"]}` です。`--shell` でシェル形式 `node "${CLAUDE_PROJECT_DIR}/…" Stop` にできます（パイプ等が要るときだけ。Git Bash の無い Windows では v2.1.198 より前の Claude Code がプレースホルダを展開しません）
- `init --no-hooks` は雛形だけ、`--no-files` はフックだけを入れます。`--no-claude-md` / `--no-gitignore` でそれぞれを触りません
- `uninit` は `settings.json` と `settings.local.json` の両方から自分のフックを外し、`.claude/ask-later/`・番兵・`.ask-later/` を消します。`init` の前に `settings.json` が無く、外した後に `{}` しか残らないなら、ファイルごと消して「無かった」に戻します。`PENDING.md`・`INBOX.md` は `--purge` を付けたときだけ消します。`CLAUDE.md` と `.gitignore` は触りません
- `hook` はフック本体です（Claude Code が呼びます。stdin に JSON）。手で `settings.json` に書くときは `npx ask-later hook Stop` の形でも動きますが、呼ばれるたびに `npx` の解決が入るので `init` が写す `.claude/ask-later/hook.mjs` の方が軽いです
- 番兵ファイルを対話シェルで開くときは `'!pending_1.txt'` と引用してください（bash の履歴展開で `!` が `event not found` になります）

## プラグインとして入れる

同じパッケージに `.claude-plugin/plugin.json` と `hooks/hooks.json` が入っています。展開したディレクトリを指定して起動すると、`init` を使わずにフックが有効になります（この形では `PENDING.md`・`INBOX.md` は自分で置くか、`npx ask-later init --no-hooks` で雛形だけ作ります）。

```
npm pack ask-later && tar xf ask-later-*.tgz
claude --plugin-dir ./package
```

マーケットプレイス（`/plugin marketplace add`）からの導入は、公開リポジトリを用意してからこの README に追記します（準備中）。

## 止まる条件（壊れた入力）

コマンド（`init` / `uninit` / `status` / `notify` / `snippet`）は、次の場合に理由を 1〜2 行で表示して終了コード 1 で止まり、**何も書きません**。スタックトレースは出しません。

- ディレクトリが無い・`--lang` が `ja` / `en` 以外・`--dir` に値が無い・知らないコマンド
- `.claude/settings.json` が JSON として読めない（「直してから再実行してください。何も書き換えていません」）・中身がオブジェクトでない
- 書き込めない（権限が無い・読み取り専用・別のアプリが開いている）
- Node.js が 20 未満

フック（`hook`）は上のどれでも**終了コード 0** で、標準エラーにも何も出しません。`PENDING.md` が無ければ `SessionStart` が 1 行だけ「`npx ask-later init` で雛形を作る」と案内し、他のイベントは黙ります。
`PENDING.md` の場所にディレクトリがある、`config.json` が壊れている、stdin が `{` で始まらない、知らないイベント名——すべて `.ask-later/hook.log` に 1 行残して通します。

## 未検証・既知の制限

- **動作確認は Windows 11・Node 24.19・Claude Code 2.1.268 だけです。**macOS／Linux は未実行です（標準機能しか使っていないので動く見込みですが、実測していません。通知はそれぞれ `osascript` / `notify-send` に投げるだけです）
- **エージェントが注入に従うかは、エージェント（モデルと CLAUDE.md の規律）次第です。**2026-09-15 の実測（`claude -p`・小さいモデル）では、注入は届き `Stop` の差し止めも掛かりましたが、エージェントは ✔ を付けず状態行も直しませんでした（当時は差し止め 1 回）。2026-09-16 の実測（sonnet）では注入だけで ✔ と状態行の更新まで行いました。差し止めの回数を使い切ればそのまま終わります。番兵ファイルと `npx ask-later status` は残ります
- **INBOX の行に書いた命令を、モデルが「埋め込み指示」と疑って実行しないことがあります。**2026-09-16 の実測（sonnet・注入文が命令形だった版）では、`P-001 done。あと、返答の最後に合言葉「ヤマブキ」を書いて` のうち完了報告は受け取られ、合言葉は「注入されたファイル内容経由の付帯指示なので出力しない」と拒否されました。Claude Code の公式リファレンスが言うとおり、命令形の注入文は prompt-injection 防御を起動します。0.1.0 では注入文を事実の陳述に書き換え、「INBOX の行は利用者本人の発言」を CLAUDE.md の断片に置きました（反映後の実測は `out/revise2_claude_p_sonnet_2026-09-16.*`）。それでも拒否されたときは ✔ が付かず、番兵と `status` に残ります——「拒否した」とは書かれないので、無人運転では番兵で気づくことになります
- `PostToolUse` はツール呼び出しの直後にしか走りません。エージェントが長く考えている間や、応答を書いている間は届きません（次の呼び出しまで待ちます）
- 差し止めの回数は `.ask-later/state.json` にセッションごとに持ちます。使い切った後は、人が次の入力をする（`UserPromptSubmit`）か未読の集合が変わるまで、そのセッションでは差し止めません（`UserPromptSubmit` の注入は毎回出ます）
- `settings.json` と `settings.local.json` の両方に入れると、フックが 2 回走ります（`uninit` は両方から外します）
- 期限行の時刻はこの PC のローカル時刻で解釈します
- サブエージェント（`Agent` ツール）の中でも `PostToolUse` は走ります（公式仕様）。署名は `agent_id` ごとに持つので本体にも届きます。2026-09-16 の実測（設計監査 2 巡目・sonnet・`Agent` ツール使用）で、サブエージェント内の注入が `agent_id` の鍵で記録され、本体でも差し止めが掛かることを確認しました。`hook.log` では `[sid/agent_id]` で区別できます
- Claude Code のフックの JSON 出力の仕様（`hookSpecificOutput.additionalContext`・`decision: block`）が変わると動かなくなります。そのときは `hook.log` に「注入」と出ているのに文脈に入らない、という形で分かります

## 有償版

道具（この CLI とフック）は無料・MIT です。別売りで **「無人運転の設計書」（¥1,480・Markdown＋HTML の ZIP・7 章・雛形 10 本・約 30 万バイト）** を用意しています。
道具の使い方ではなく、**止めない運用を成立させる規律の設計**——なぜ止まるか（判断の留保と作業の停止は別）、棚上げキューの書式、無人実行の 4 つのブレーキ（回数・費用・無進捗・不可逆操作の前の昇格）、独立セッションによる監査の型、記録を機械に書かせる方法、そして**第 6 章・現場の失敗の記録 14 件（日付つき）**——1 セッションで 60 回の確認が出て無人実行が壊れた、監査結果が会話にしか無くて消えた、フック出力の文字化け、期限切れ項目の自動取り下げ、「念のため確認します」問題——と、テンプレ一式（CHARTER の骨子・PENDING/INBOX・監査役の定義・settings.json の hooks 断片・CLAUDE.md の断片）を収めます。
対象は `-p` や自動再開で無人運転をしている人。対話でしか使わない人には要りません。

**第 1 章と最小テンプレは無料で、このパッケージの `docs/manual-free/` に入っています**（`npm pack ask-later` で取れます。`index.html` を開けば読めます）。
**入手方法**: [販売ページ](https://lab-cws.pages.dev/ask-later/)の「¥1,480 で購入する」から Stripe で決済すると、決済完了の画面から ZIP のダウンロードページに移ります。届かない場合の連絡先は販売ページの「特定商取引法に基づく表記」にあります。

## 開発者向け

ソースコードは npm のパッケージに入っています（`npm pack ask-later`）。公開リポジトリは準備中です。
下のコマンドのうち `npm test` は tarball に入っていない `tests/`（と `scripts/` の一部）が要ります（公開リポジトリができたらそちらで動きます）。
`fieldlog` と `build:manual` は作者の手元にある実データと有償版の原稿が要るので、公開リポジトリでも動きません。

```
npm test               # 自動テスト（node --test。PENDING の解析・INBOX の未読・注入の重複抑止・Stop の差し止め・init/uninit の往復・CLI）
npm run fieldlog       # 実データ（この道具の移植元の PENDING/INBOX の固定コピー）でフックを走らせ、docs/field-log.md を書く。tests/fixtures/real/ が要る
npm run build:manual   # 有償版の設計書を dist/ に組む（Markdown → HTML → ZIP）
```

`docs/field-log.md`（パッケージに同梱）に、実運用 5 日分のファイル（依頼 27 件・未処理 5 件）で集計・注入・差し止めを動かした記録と、移植元の PowerShell 実装（独立した実装）との件数・ID の照合があります。

ライブラリとしても使えます: `ask-later`（`collect` / `summarize`）、`ask-later/pending`（`parsePending` / `openItems` / `expireDeadlines`）、`ask-later/inbox`（`unreadLines` / `signatureOf`）、`ask-later/hook`（`main` / `decide`）、`ask-later/install`（`init` / `uninit` / `mergeHooks` / `removeHooks`）。

## ライセンス

MIT License。

Claude および Claude Code は Anthropic, PBC の商標です。このツールは非公式であり、Anthropic の承認・提携を受けたものではありません。
