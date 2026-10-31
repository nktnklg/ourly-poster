// アップデート: GitHub から最新版をダウンロードし、インストール先（~/.ourly-poster）を新しい版で入れ替える。
//
// 使い方:
//   node update.mjs   （npm run update）
//
// - 最新版（main ブランチ）の tar.gz を一時フォルダにダウンロードし、tar で展開する
//   （Mac / Windows 10 以降は tar が標準で入っている。git は不要）。
// - 展開したフォルダの setup.mjs を `--skip-login --skill none` で実行する。setup がツール一式をインストール先へ
//   コピーし直し（ログイン状態・管理画面の URL・スキルの記録・画像のキャッシュは残る）、依存を入れ直し、
//   置いてあるスキルを全て更新する。
// - setup.mjs から呼ぶ処理と同じく、Node 標準モジュールだけで書く。
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'nktnklg/ourly-poster';
const BRANCH = 'main';
const TARBALL_URL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;

const here = dirname(fileURLToPath(import.meta.url));

function fail(msg) {
  console.error('\n❌ ' + msg);
  process.exit(1);
}

function readVersion(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return pkg.name === 'ourly-poster' ? pkg.version : null;
  } catch {
    return null;
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((ok, ng) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? ok() : ng(new Error(`${cmd} が失敗しました (exit ${code})`))));
    p.on('error', ng);
  });
}

async function main() {
  const current = readVersion(here);
  console.log(`現在の版: ${current ?? '不明'}`);

  const tmp = mkdtempSync(join(tmpdir(), 'ourly-poster-update-'));
  try {
    console.log(`\n▶ 最新版をダウンロード: ${TARBALL_URL}`);
    const res = await fetch(TARBALL_URL);
    if (!res.ok) throw new Error(`ダウンロードに失敗しました (HTTP ${res.status})`);
    const archive = join(tmp, 'ourly-poster.tar.gz');
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

    console.log('\n▶ 展開');
    await run('tar', ['-xzf', archive, '-C', tmp]);
    const name = readdirSync(tmp).find((n) => n.startsWith('ourly-poster-'));
    const src = name && join(tmp, name);
    const latest = src && readVersion(src);
    if (!latest) throw new Error('ダウンロードしたファイルに ourly-poster が見つかりません。');
    console.log(`最新の版: ${latest}`);

    console.log('\n▶ 新しい版を反映（setup を実行）');
    await run(process.execPath, [join(src, 'setup.mjs'), '--skip-login', '--skill', 'none'], {
      cwd: src,
      env: { ...process.env, OURLY_POSTER_UPDATING: '1' },
    });

    console.log(`\n✅ アップデート完了: ${current ?? '不明'} → ${latest}`);
    console.log('   Claude Code / Codex を起動中なら、起動し直すと新しいスキルが読み込まれます。');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err.message || String(err)));
