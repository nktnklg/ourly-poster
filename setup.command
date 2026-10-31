#!/bin/bash
# Mac 用: ダブルクリックでセットアップを実行する
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。https://nodejs.org/ja から LTS 版をインストールしてから、もう一度実行してください。"
  read -r -p "Enter で閉じます..."
  exit 1
fi

node setup.mjs
echo
read -r -p "Enter で閉じます..."
