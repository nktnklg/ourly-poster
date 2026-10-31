// create-draft / push-body / post-draft で共通の CLI 処理。
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseMarkdownFile, writeFrontmatterField } from './markdown.mjs';
import { findCategory, fetchCategories } from './ourly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const toolDir = resolve(here, '..');
export const localConfigPath = resolve(toolDir, 'config.local.json');

// config.json（共通・公開）に config.local.json（各自・git 管理外。baseUrl など）を重ねる
function loadConfig() {
  const base = JSON.parse(readFileSync(resolve(toolDir, 'config.json'), 'utf8'));
  if (!existsSync(localConfigPath)) return base;
  const local = JSON.parse(readFileSync(localConfigPath, 'utf8'));
  return { ...base, ...local, api: { ...base.api, ...local.api }, defaults: { ...base.defaults, ...local.defaults } };
}
export const config = loadConfig();

// 値を取るオプションは valueOpts、フラグは flagOpts に列挙する
export function parseArgs(argv, { valueOpts = [], flagOpts = [] } = {}) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const name = x.replace(/^--/, '');
    if (x === '-h' || x === '--help') a.help = true;
    else if (x.startsWith('--') && flagOpts.includes(name)) a[name] = true;
    else if (x.startsWith('--') && valueOpts.includes(name)) a[name] = argv[++i];
    else if (x.startsWith('--')) throw new Error(`不明なオプション: ${x}`);
    else a._.push(x);
  }
  return a;
}

// スクリプト先頭の // コメント（使い方）を表示して終了する
export function showHelp(scriptUrl) {
  const lines = readFileSync(fileURLToPath(scriptUrl), 'utf8').split('\n');
  const head = [];
  for (const l of lines) {
    if (!l.startsWith('//')) break;
    head.push(l.replace(/^\/\/ ?/, ''));
  }
  console.log(head.join('\n'));
  process.exit(0);
}

// 利用者が指定した相対パスの基準。npm run 経由だと cwd がツールのフォルダになるため INIT_CWD を優先する
export function userPath(p) {
  return resolve(process.env.INIT_CWD || process.cwd(), p);
}

export function deriveEyecatch(mdPath) {
  const png = mdPath.replace(/_本文\.md$/, '_アイキャッチ.png');
  return png !== mdPath && existsSync(png) ? png : null;
}

/**
 * md を読み、タイトル・本文・カテゴリ名・記事 ID を決める。
 * カテゴリの優先順位: CLI 引数 > frontmatter > config.defaults
 */
export async function loadArticle(mdPath, args) {
  const absMd = userPath(mdPath);
  const { title, bodyMarkdown, meta } = await parseMarkdownFile(absMd);
  return {
    absMd,
    title,
    bodyMarkdown,
    meta,
    articleCategoryName: args.category ?? meta.category ?? config.defaults.articleCategory,
    analysisCategoryName: args.analysis ?? meta.analysis ?? config.defaults.analysisCategory,
    id: args.id ?? meta.ourly_id ?? '',
  };
}

/**
 * カテゴリを確定する。current が一覧にあればそれを使い、無ければ TTY で番号選択させる。
 * TTY でない（エージェント実行など）場合は候補一覧つきのエラーで止める。
 * @param {{id,label}[]} list ourly から取得したカテゴリ一覧
 * @param {{kind: string, opt: string, key: string}} k 表示名 / CLI オプション名 / frontmatter キー
 */
export async function chooseCategory(list, k, current) {
  const found = findCategory(list, current);
  if (found) return found;

  const labels = list.map((c) => c.label);
  const reason = current ? `${k.kind} "${current}" は現在のカテゴリにありません。` : `${k.kind} が未指定です（保存に必須）。`;
  if (!process.stdin.isTTY) {
    throw new Error(
      `${reason}\n--${k.opt} で指定するか、md の frontmatter に "${k.key}: <名前>" を書いてください。\n` +
      `候補: ${labels.join(' / ')}`
    );
  }

  console.log(`\n${reason}`);
  console.log(`${k.kind}を選んでください:`);
  labels.forEach((l, i) => console.log(`  ${i + 1}) ${l}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const n = Number((await rl.question('番号> ')).trim());
      if (Number.isInteger(n) && n >= 1 && n <= list.length) return findCategory(list, labels[n - 1]);
      console.log(`  1〜${list.length} の番号を入力してください。`);
    }
  } finally {
    rl.close();
  }
}

/**
 * ourly の最新一覧から記事カテゴリ・分析カテゴリを確定し、dry-run でなければ frontmatter に保存する。
 * article / analysis が false の側は解決せず null を返す。
 */
export async function resolveCategories(context, a, { article = true, analysis = true, dryRun = false } = {}) {
  const categories = await fetchCategories(context, config);
  const articleCategory = article
    ? await chooseCategory(categories.article, { kind: '記事カテゴリ', opt: 'category', key: 'category' }, a.articleCategoryName)
    : null;
  const analysisCategory = analysis
    ? await chooseCategory(categories.analysis, { kind: '分析カテゴリ', opt: 'analysis', key: 'analysis' }, a.analysisCategoryName)
    : null;
  if (articleCategory) console.log('記事カテゴリ:', articleCategory.label);
  if (analysisCategory) console.log('分析カテゴリ:', analysisCategory.label);

  const fmChanges = [['category', articleCategory], ['analysis', analysisCategory]]
    .filter(([key, c]) => c && a.meta[key] !== c.label);
  if (dryRun) {
    if (fmChanges.length) console.log('（dry-run のため md には保存していません）');
  } else {
    for (const [key, c] of fmChanges) await writeFrontmatterField(a.absMd, key, c.label);
    if (fmChanges.length) console.log('カテゴリを md の frontmatter に保存しました。');
  }
  return { articleCategory, analysisCategory };
}

export function detailUrl(id) {
  return `${config.baseUrl}/admin/articles/detail/${id}`;
}

export function printBlocksPreview(blocks, characterCount) {
  const types = {};
  for (const b of blocks) types[b.type] = (types[b.type] || 0) + 1;
  console.log('ブロック :', blocks.length, JSON.stringify(types), `/ ${characterCount}文字`);
  console.log('先頭5ブロック:');
  for (const b of blocks.slice(0, 5)) console.log('  -', b.type, JSON.stringify(b.data).slice(0, 80));
}

export function run(main) {
  main().catch((err) => {
    console.error('\nエラー:', err.message || err);
    process.exit(1);
  });
}
