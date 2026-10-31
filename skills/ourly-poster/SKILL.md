---
name: ourly-poster
description: markdown 記事を ourly 管理画面に非公開の下書きとして保存する（初期設定・ログイン・カテゴリ確認も行う）。「ourly に投稿」「ourly に下書き保存」「ourly の本文を更新」「ourly-poster」と頼まれたら使う。
---
<!-- ourly-poster:installed  このファイルは install-skill.mjs が生成する。手で編集しても setup の再実行で上書きされる。 -->

# ourly-poster

markdown 記事を ourly 管理画面に **非公開の下書き** として保存する。ツールの場所: `{{TOOL_DIR}}`

コマンドは必ずツールの絶対パスで呼び、md のパスも絶対パスで渡す。

## 手順

1. 状態を確認する: `node "{{TOOL_DIR}}/doctor.mjs"`
   - 依存・管理画面の URL が ⚠️ のとき: 管理画面の URL（例: `https://xxxx.media.ourly.jp/admin/articles`）をユーザーに聞き、`node "{{TOOL_DIR}}/setup.mjs" --base-url <URL> --skill none` を実行する。
   - ログインが ⚠️ のとき: `node "{{TOOL_DIR}}/login.mjs"` を実行し、「開いたブラウザで ourly にログインしてください」とユーザーに伝える。ログイン完了は自動で検知される（最大5分待つ）。コマンドのタイムアウトは 10 分（600000ms）にする。
2. カテゴリを決める: md の frontmatter に `category` / `analysis` が無ければ、`node "{{TOOL_DIR}}/categories.mjs"` で候補を取得し、ユーザーに選んでもらう。選んだものは `--category` / `--analysis` で渡す（成功時に frontmatter へ保存される）。
3. 内容を確認する（保存しない）:
   - frontmatter に `ourly_id` が無い: `node "{{TOOL_DIR}}/post-draft.mjs" "<md の絶対パス>" [--category <名前>] [--analysis <名前>] --dry-run`
   - `ourly_id` がある: `node "{{TOOL_DIR}}/push-body.mjs" "<md の絶対パス>" --dry-run`
4. **ユーザーの指示を得てから**、同じコマンドを `--dry-run` なしで実行する。出力の「詳細」URL をユーザーに伝える。
   - `ourly_id` がある md は `push-body.mjs` で本文だけを上書きする（下書きを作り直さない）。

各コマンドの詳細は `--help` で表示できる。アイキャッチは md と同じフォルダの `<タイトル>_アイキャッチ.png` を自動で使う（`--eyecatch <png>` で指定も可）。

本文の画像は `![キャプション](相対パス or URL)` で書く（相対パスは md のフォルダ基準、png / jpg / jpeg / gif）。dry-run の「本文画像」に ⚠️ が出たら、パスか形式を直してから実行する。

## 安全ルール（厳守）

- 必ず非公開の下書きとして保存する。公開・公開予約はしない。
- 検証やテストのために ourly に下書きを作らない。作成・更新は、ユーザーが対象の md を指定して指示したときだけ行う。
- ログインは人がブラウザ画面で行う。パスワードを聞かない、扱わない、入力を代行しない。
- `{{TOOL_DIR}}/auth/` と `{{TOOL_DIR}}/config.local.json` の内容を出力しない。
- 記事を削除しない（管理画面から人が行う）。
- frontmatter の `ourly_id` を手で変えない。

## Codex で実行するとき

サンドボックスではブラウザの起動とネットワーク接続が塞がれる。`doctor` / `setup` / `login` / `categories` / `post-draft` / `push-body` は、権限の昇格（サンドボックス外での実行の承認）を求めて実行する。
