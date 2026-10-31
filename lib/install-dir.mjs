// インストール先: ダウンロードしたフォルダ（Downloads など）は消されやすいため、setup がツール一式を
// 固定の場所（既定 ~/.ourly-poster、環境変数 OURLY_POSTER_HOME で変更可）へコピーし、以降はそこから使う。
//
// - ログイン状態・設定・キャッシュ・依存（auth/, config.local.json, cache/, node_modules/）はコピー先のものを残す。
//   コピー先にまだ無ければコピー元から引き継ぐ（node_modules は除く）。
// - それ以外のファイルはコピー先から消してからコピーし直す（上流で消えたファイルを残さない）。
// - setup.mjs から依存なしで呼ぶため、Node 標準モジュールだけで書く。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

const KEEP = ['node_modules', 'auth', 'cache', 'config.local.json'];
const MIGRATE = ['auth', 'cache', 'config.local.json'];
const SKIP_NAMES = new Set(['.git', '.claude', 'recon', '.DS_Store', ...KEEP]);
// ブラウザ実行中のロック（ツールのロックと Chromium のロック）は引き継がない
const LOCK_NAMES = new Set(['profile.lock', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']);

export function installDir() {
  return resolve(process.env.OURLY_POSTER_HOME || join(homedir(), '.ourly-poster'));
}

function real(p) {
  const r = realpathSync(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

export function isInstalled(here) {
  const dest = installDir();
  return existsSync(dest) && real(here) === real(dest);
}

function skipTop(name) {
  return SKIP_NAMES.has(name) || /^recon.*\.mjs$/.test(name) || name.endsWith('.log');
}

// 既存のコピー先が ourly-poster のものか（他のフォルダを消さないための確認）
function assertOurs(dest) {
  if (!existsSync(dest)) return;
  if (readdirSync(dest).length === 0) return;
  const pkg = join(dest, 'package.json');
  let name;
  try { name = JSON.parse(readFileSync(pkg, 'utf8')).name; } catch {}
  if (name !== 'ourly-poster') {
    throw new Error(`${dest} は ourly-poster のフォルダではないため、コピーしません。環境変数 OURLY_POSTER_HOME で別の場所を指定してください。`);
  }
}

// src のツール一式をインストール先へコピーし、その場所を返す
export function copyToInstallDir(src) {
  const dest = installDir();
  const [s, d] = [real(src), existsSync(dest) ? real(dest) : dest];
  if (s.startsWith(d + sep) || d.startsWith(s + sep)) {
    throw new Error(`コピー元とコピー先が入れ子になっています: ${src} / ${dest}`);
  }
  assertOurs(dest);
  mkdirSync(dest, { recursive: true });

  for (const name of readdirSync(dest)) {
    if (!KEEP.includes(name)) rmSync(join(dest, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(src)) {
    if (skipTop(name)) continue;
    cpSync(join(src, name), join(dest, name), {
      recursive: true,
      filter: (p) => basename(p) !== '.DS_Store',
    });
  }
  for (const name of MIGRATE) {
    if (existsSync(join(dest, name)) || !existsSync(join(src, name))) continue;
    cpSync(join(src, name), join(dest, name), {
      recursive: true,
      filter: (p) => !LOCK_NAMES.has(basename(p)),
    });
  }
  return dest;
}
