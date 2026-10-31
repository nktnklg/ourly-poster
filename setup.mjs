// セットアップ: 依存のインストールと、管理画面 URL の設定（config.local.json）を行う。
//
// 使い方:
//   node setup.mjs [--base-url <管理画面のURL>]
//
// - Node.js 20 以上が必要。
// - npm install → npx playwright install chromium を順に実行する。
// - 管理画面の URL（例: https://<テナント>.media.ourly.jp）を config.local.json に保存する。
//   --base-url を省略し、まだ設定が無ければ入力を求める。
// - lib/cli.mjs は依存（markdown-it 等）を読み込むため、このスクリプトは Node 標準モジュールだけで書く。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const here = dirname(fileURLToPath(import.meta.url));
const localConfigPath = resolve(here, 'config.local.json');

function fail(msg) {
  console.error('\n❌ ' + msg);
  process.exit(1);
}

function runStep(label, cmd) {
  console.log(`\n▶ ${label}: ${cmd}`);
  return new Promise((ok, ng) => {
    const p = spawn(cmd, { cwd: here, stdio: 'inherit', shell: true });
    p.on('exit', (code) => (code === 0 ? ok() : ng(new Error(`${label} に失敗しました (exit ${code})`))));
    p.on('error', ng);
  });
}

// 入力 URL から origin だけを取り出す。https 以外は null
function toOrigin(input) {
  try {
    const u = new URL(String(input).trim());
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

async function askBaseUrl() {
  if (!process.stdin.isTTY) {
    fail('管理画面の URL が未設定です。`node setup.mjs --base-url https://<テナント>.media.ourly.jp` で指定してください。');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const ans = await rl.question('\nourly 管理画面の URL を入力してください（例: https://xxxx.media.ourly.jp/admin/articles）\nURL> ');
      const origin = toOrigin(ans);
      if (origin) return origin;
      console.log('  https:// で始まる URL を入力してください。');
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--base-url');
  const argUrl = i >= 0 ? argv[i + 1] : null;

  const major = Number(process.versions.node.split('.')[0]);
  if (!(major >= 20)) {
    fail(`Node.js 20 以上が必要です（現在 ${process.versions.node}）。https://nodejs.org/ja から LTS 版をインストールしてください。`);
  }
  console.log(`Node.js ${process.versions.node} OK`);

  await runStep('依存パッケージのインストール', 'npm install');
  await runStep('ブラウザ (Chromium) のインストール', 'npx playwright install chromium');

  const local = existsSync(localConfigPath) ? JSON.parse(readFileSync(localConfigPath, 'utf8')) : {};
  if (argUrl) {
    const origin = toOrigin(argUrl);
    if (!origin) fail(`URL が不正です（https:// で始まる URL を指定してください）: ${argUrl}`);
    local.baseUrl = origin;
  } else if (!local.baseUrl) {
    local.baseUrl = await askBaseUrl();
  }
  writeFileSync(localConfigPath, JSON.stringify(local, null, 2) + '\n');
  console.log(`\n管理画面の URL: ${local.baseUrl}（config.local.json に保存）`);

  console.log('\n✅ セットアップ完了');
  if (existsSync(resolve(here, 'auth', 'profile'))) {
    console.log('   ログイン状態は `npm run doctor` で確認できます。');
  } else {
    console.log('   次は `npm run login` でログインしてください（初回のみ）。');
  }
}

main().catch((err) => fail(err.message || String(err)));
