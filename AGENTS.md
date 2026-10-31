# AGENTS.md — ourly-poster

AI エージェント（Codex / Claude Code など）がこのリポジトリを扱うときの手引き。人向けの説明は README.md。

## 概要

markdown 記事を ourly 管理画面に **非公開の下書き** として保存する Node.js CLI。2段階で動く。

1. `create-draft.mjs`: タイトル（本文先頭の H1）・アイキャッチ・カテゴリだけの空の下書きを作り、md の frontmatter に `ourly_id` を書き込む。
2. `push-body.mjs`: md 本文を Editor.js ブロックに変換し（本文の画像はアップロードして画像ブロックにする）、`ourly_id` の下書きの本文だけを更新する（何度でも上書き可）。

`post-draft.mjs` は 1 → 2 を続けて実行する。

## コマンド

| コマンド | 用途 | 書き込み |
|---|---|---|
| `npm run setup -- [--base-url <URL>] [--skip-login] [--skill user\|none\|<dir>]` | 依存のインストール・管理画面 URL の設定・ログイン・スキルの配置。未ログインならブラウザが開き、**人がログインする**。人がその場にいないときは `--skip-login` | ローカルのみ |
| `npm run login` | ログイン。ブラウザが開き、**人が画面でログインする**（完了を自動検知、最大5分） | ローカルのみ |
| `npm run skill -- --scope user\|project [--dir <dir>] [--agent claude\|codex\|both] [--uninstall]` | Claude Code / Codex 用のスキル `ourly-poster` を置く・消す | ローカルのみ |
| `npm run doctor` | 設定・依存・ログイン状態の確認（画面は開かない） | なし |
| `npm run categories` | 現在のカテゴリ一覧を表示 | なし |
| `node create-draft.mjs <md> --category <名前> --analysis <名前> [--dry-run]` | ① 空の下書きを作成 | **ourly に作成** |
| `node push-body.mjs <md> [--dry-run]` | ② 本文を流し込む | **ourly を更新** |
| `node post-draft.mjs <md> ...` | ① → ② | **ourly に作成・更新** |

各コマンドは `--help` で使い方を表示する。

## 初期設定を頼まれたとき

1. 管理画面の URL（例: `https://xxxx.media.ourly.jp/admin/articles`）と、スキルの置き場所をユーザーに聞く。
   - ユーザー全体（`~/.claude/skills`・`~/.agents/skills`。どのフォルダで起動しても使える）→ `--skill user`
   - 特定のディレクトリ（記事を書くプロジェクトなど）→ `--skill <ディレクトリ>`
   - 置かない → `--skill none`
2. `node setup.mjs --base-url <URL> --skill <...>` を実行する。未ログインならブラウザが開くので、「開いたブラウザで ourly にログインしてください」とユーザーに伝える。完了は自動で検知される（最大5分待つ）ため、コマンドのタイムアウトは 10 分にする。
   setup はツール一式を `~/.ourly-poster`（`OURLY_POSTER_HOME` で変更可）にコピーし、そこで続きを実行する。以降のコマンドはコピー先で実行する。ダウンロードしたフォルダは削除してよいと伝える。
3. `~/.ourly-poster` で `npm run doctor` を実行し、全て ✅ になったことを確認する。スキルを置いた場合は「Claude Code / Codex を起動し直すと、そのフォルダから ourly-poster スキルで投稿できる」と伝える。

Codex のサンドボックスではブラウザの起動とネットワーク接続が塞がれるため、setup / login / doctor / 投稿系のコマンドは権限の昇格を求めて実行する。

## エージェントが実行するときの手順

1. `npm run doctor` を実行する。⚠️ があれば解消する。ログイン切れなら `npm run login` を実行し、開いたブラウザで人にログインしてもらう（タイムアウトは 10 分）。
2. `--dry-run` で内容を確認する: `node create-draft.mjs <md> --category ... --analysis ... --dry-run` / `node push-body.mjs <md> --dry-run`。
3. カテゴリが分からなければ `npm run categories` で候補を取得し、ユーザーに選んでもらう。エージェントの実行環境ではターミナルの番号選択が使えないため、`--category` / `--analysis` で渡すか、frontmatter に書く。
4. **ユーザーの指示を得てから** dry-run なしで ① → ② を実行する。出力の「詳細」URL をユーザーに伝える。

## frontmatter（本文 md の先頭）

```md
---
category: 📝ナレッジ共有   # 記事カテゴリ（必須）
analysis: その他           # 分析カテゴリ（必須）
ourly_id: <自動>           # ① が書き込む。手で変えない
---
# 記事タイトル
```

カテゴリの優先順位: CLI 引数 > frontmatter > `config.json` の `defaults`。

## 安全ルール（厳守）

- 必ず **非公開の下書き** として保存する。公開・公開予約をする処理を追加しない、実行しない。
- **検証やテストのために ourly に下書きを作らない。** 作成や更新は、ユーザーが対象の md を指定して実行を指示したときだけ行う。API の調査は GET のみで行う。
- ログインは人がブラウザ画面で行う。エージェントはログイン用のブラウザを開くところまで。パスワードを聞かない、扱わない、入力を代行しない。
- `auth/`（ログイン状態）と `config.local.json`（テナント URL）はコミットしない、内容を出力しない。
- 公開済み・公開予約済みの記事は `push-body` が拒否する。このガードを外さない。
- 記事の削除はツールでは行わない（管理画面から人が行う）。

## 構成

- `lib/ourly.mjs`: ブラウザプロファイル（`auth/profile/`、ロック付き）の起動、ログイン待ち、記事 API（作成・取得・更新）、画像アップロード（アイキャッチ・本文）、カテゴリ・リアクションの取得
- `lib/markdown.mjs`: frontmatter の読み書き、markdown → Editor.js ブロックへの変換
- `lib/images.mjs`: 本文画像の確認・読み込み、アップロード結果の再利用（`cache/uploaded-images.json`、git 管理外）
- `install-skill.mjs`: スキルの配置。`skills/ourly-poster/SKILL.md` をひな形に、ツールの絶対パス（`{{TOOL_DIR}}`）を埋め込んでコピーし、配置先を `config.local.json` の `skillInstalls` に記録する（setup の再実行で更新）
- `skills/ourly-poster/SKILL.md`: スキルのひな形（Claude Code / Codex 共通）。手順を変えたら AGENTS.md と合わせる
- `lib/install-dir.mjs`: setup がツール一式をインストール先（`~/.ourly-poster`）へコピーする処理。`auth/`・`cache/`・`config.local.json`・`node_modules/` はコピー先のものを残す。開発中はリポジトリを編集し、setup を再実行してコピー先に反映する
- `lib/cli.mjs`: 設定の読み込み（`config.json` + `config.local.json`）、引数の解析、カテゴリ選択、`--help`
- `config.json`: 共通設定（API パスなど）。テナント固有の値は書かない
- `config.local.json`: 各自の管理画面 URL・スキルの配置先（git 管理外。`setup` が作成）
