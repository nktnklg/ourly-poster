// 状態チェック: 設定・依存・ブラウザ・ログインが揃っているかを確認する（ブラウザ画面は開かない）。
//
// 使い方:
//   node doctor.mjs
//
// - 投稿前の確認用。エージェントもまずこれを実行する。
// - ログインが切れていたら `npm run login` を案内する（ログインは人が画面で行う）。
// - 依存が未インストールでも動くよう、依存を使うモジュールはチェック後に動的 import する。
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const { showHelp } = await import('./lib/cli.mjs');
  showHelp(import.meta.url);
}

let ok = true;
function report(good, msg, next) {
  console.log(`${good ? '✅' : '⚠️'} ${msg}${good || !next ? '' : `\n   → ${next}`}`);
  if (!good) ok = false;
}

report(Number(process.versions.node.split('.')[0]) >= 20, `Node.js ${process.versions.node}`, 'Node.js 20 以上をインストール');
const depsOk = existsSync(resolve(here, 'node_modules', 'playwright')) && existsSync(resolve(here, 'node_modules', 'markdown-it'));
report(depsOk, '依存パッケージ', '`npm run setup` を実行');

if (depsOk) {
  const { chromium } = await import('playwright');
  const { config } = await import('./lib/cli.mjs');
  const { openContext, isAuthed } = await import('./lib/ourly.mjs');
  report(Boolean(config.browserChannel) || existsSync(chromium.executablePath()), 'ブラウザ (Chromium)', '`npm run setup` を実行');
  report(Boolean(config.baseUrl), `管理画面の URL: ${config.baseUrl || '(未設定)'}`, '`npm run setup` で設定');
  if (ok) {
    try {
      const { context, close } = await openContext(config, { headless: true });
      try {
        report(await isAuthed(context, config).catch(() => false), 'ログイン', '`npm run login` でログイン（人が画面で行う）');
      } finally {
        await close();
      }
    } catch (err) {
      report(false, 'ログイン確認: ' + err.message);
    }
  }
}

console.log(ok ? '\n準備 OK です。' : '\n上の ⚠️ を解消してください。');
process.exit(ok ? 0 : 1);
