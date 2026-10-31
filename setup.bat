@echo off
rem Windows 用: ダブルクリックでセットアップを実行する
chcp 65001 > nul
cd /d "%~dp0"

where node > nul 2>&1
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ja から LTS 版をインストールしてから、もう一度実行してください。
  pause
  exit /b 1
)

node setup.mjs
echo.
pause
