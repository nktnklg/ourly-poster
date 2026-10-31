// スキルのインストール: Claude Code / Codex から ourly-poster を使えるよう、スキル ourly-poster を置く。
//
// 使い方:
//   node install-skill.mjs --scope user [--agent claude|codex|both] [--uninstall]
//   node install-skill.mjs --scope project --dir <ディレクトリ> [--agent claude|codex|both] [--uninstall]
//   node install-skill.mjs --refresh
//
// - --scope user: ユーザー全体（~/.claude/skills/ourly-poster と ~/.agents/skills/ourly-poster）。
//   どのフォルダで Claude Code / Codex を起動しても使える。
// - --scope project --dir <ディレクトリ>: そのディレクトリ（記事を書くプロジェクトなど）だけで使える。
//   <ディレクトリ>/.claude/skills/ourly-poster と <ディレクトリ>/.agents/skills/ourly-poster に置く。
// - --agent で片方だけにできる（既定 both。claude = Claude Code、codex = Codex）。
// - skills/ourly-poster/SKILL.md をひな形に、このツールの場所（絶対パス）を埋め込んでコピーする。
// - インストール先は config.local.json の skillInstalls に記録する。--refresh（setup が実行する）で記録先を全て更新する。
// - --uninstall で、インストールしたスキルのフォルダを消し、記録から外す。
// - setup.mjs から依存なしで呼ぶため、Node 標準モジュールだけで書く。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const localConfigPath = resolve(here, 'config.local.json');
const templatePath = resolve(here, 'skills', 'ourly-poster', 'SKILL.md');
const MARKER = '<!-- ourly-poster:installed';
const AGENT_DIRS = { claude: '.claude', codex: '.agents' };

function readLocal() {
  return existsSync(localConfigPath) ? JSON.parse(readFileSync(localConfigPath, 'utf8')) : {};
}

function writeLocal(local) {
  writeFileSync(localConfigPath, JSON.stringify(local, null, 2) + '\n');
}

function agentsOf(agent) {
  if (agent === 'both') return ['claude', 'codex'];
  if (agent in AGENT_DIRS) return [agent];
  throw new Error(`--agent は claude / codex / both のいずれかです: ${agent}`);
}

// 記録 { scope, dir?, agent } → スキルのフォルダの一覧
function skillDirs({ scope, dir, agent }) {
  const base = scope === 'user' ? homedir() : dir;
  return agentsOf(agent).map((a) => join(base, AGENT_DIRS[a], 'skills', 'ourly-poster'));
}

function sameTarget(x, y) {
  return x.scope === y.scope && (x.scope === 'user' || x.dir === y.dir);
}

// ourly-poster が書いた SKILL.md でなければ上書き・削除しない
function assertOurs(skillDir) {
  const file = join(skillDir, 'SKILL.md');
  if (existsSync(file) && !readFileSync(file, 'utf8').includes(MARKER)) {
    throw new Error(`${file} は ourly-poster が作ったものではないため、変更しません。`);
  }
}

// 引数を検証して記録の形にする
export function toInstall({ scope, dir, agent = 'both' }) {
  if (scope === 'user') return { scope, agent };
  if (scope === 'project') {
    if (!dir) throw new Error('--scope project には --dir <ディレクトリ> が必要です。');
    // npm run 経由だと cwd がツールのフォルダになるため INIT_CWD を基準にする
    const abs = resolve(process.env.INIT_CWD || process.cwd(), dir);
    if (!existsSync(abs)) throw new Error(`ディレクトリがありません: ${abs}`);
    return { scope, dir: abs, agent };
  }
  throw new Error('--scope は user か project を指定してください。');
}

function write(install) {
  const body = readFileSync(templatePath, 'utf8').replaceAll('{{TOOL_DIR}}', here);
  for (const d of skillDirs(install)) {
    assertOurs(d);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'SKILL.md'), body);
    console.log(`  ✅ ${join(d, 'SKILL.md')}`);
  }
}

export function installSkill(install) {
  write(install);
  const local = readLocal();
  const prev = (local.skillInstalls ?? []).find((x) => sameTarget(x, install));
  // 同じ場所に別の agent で入れ直したときは、両方を記録に残す
  const agents = new Set([...agentsOf(install.agent), ...(prev ? agentsOf(prev.agent) : [])]);
  const merged = { ...install, agent: agents.size === 2 ? 'both' : install.agent };
  local.skillInstalls = [...(local.skillInstalls ?? []).filter((x) => !sameTarget(x, install)), merged];
  writeLocal(local);
}

export function uninstallSkill(install) {
  for (const d of skillDirs(install)) {
    if (!existsSync(d)) continue;
    assertOurs(d);
    rmSync(d, { recursive: true });
    console.log(`  🗑 ${d}`);
  }
  const local = readLocal();
  if (!local.skillInstalls) return;
  // 片方の agent だけ消したときは、残りを記録に残す
  const left = agentsOf(install.agent);
  local.skillInstalls = local.skillInstalls.flatMap((x) => {
    if (!sameTarget(x, install)) return [x];
    const rest = agentsOf(x.agent).filter((a) => !left.includes(a));
    return rest.length ? [{ ...x, agent: rest.length === 2 ? 'both' : rest[0] }] : [];
  });
  writeLocal(local);
}

// 記録されたインストール先を全て更新する。記録が無ければ false
export function refreshSkills() {
  const installs = readLocal().skillInstalls ?? [];
  for (const x of installs) {
    if (x.scope === 'project' && !existsSync(x.dir)) {
      console.log(`  ⚠️ ディレクトリが無いため飛ばします: ${x.dir}`);
      continue;
    }
    write(x);
  }
  return installs.length > 0;
}

function showUsage() {
  const head = [];
  for (const l of readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')) {
    if (!l.startsWith('//')) break;
    head.push(l.replace(/^\/\/ ?/, ''));
  }
  console.log(head.join('\n'));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return showUsage();
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--refresh')) {
    if (!refreshSkills()) console.log('インストール先の記録がありません。');
    return;
  }
  const install = toInstall({ scope: opt('--scope'), dir: opt('--dir'), agent: opt('--agent') ?? 'both' });
  if (argv.includes('--uninstall')) {
    console.log('スキルを削除します:');
    uninstallSkill(install);
  } else {
    console.log('スキルをインストールします:');
    installSkill(install);
    console.log('\nClaude Code / Codex を起動し直すと、スキル ourly-poster が使えます。');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error('\n❌ ' + (err.message || err));
    process.exit(1);
  }
}
