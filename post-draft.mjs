// 一括: 段階1 (create-draft) → 段階2 (push-body) を続けて実行する（後方互換のラッパー）。
//
// 使い方:
//   node post-draft.mjs "<本文.md>" [--category <記事カテゴリ>] [--analysis <分析カテゴリ>] \
//        [--eyecatch <png>] [--force] [--dry-run]
//
// - カテゴリは CLI 引数 > md の frontmatter > config.defaults の順で決める。
// - --dry-run は変換結果を表示するだけで保存しない。
import { createDraftFromMarkdown } from './create-draft.mjs';
import { pushBodyFromMarkdown } from './push-body.mjs';
import { parseArgs, showHelp, run } from './lib/cli.mjs';

run(async () => {
  const args = parseArgs(process.argv.slice(2), {
    valueOpts: ['category', 'analysis', 'eyecatch'],
    flagOpts: ['force', 'dry-run'],
  });
  if (args.help) showHelp(import.meta.url);
  const mdPath = args._[0];
  if (!mdPath) {
    console.error('本文 markdown のパスを指定してください。');
    console.error('例: node post-draft.mjs "記事_本文.md" --category "📝ナレッジ共有" --analysis "その他"');
    process.exit(1);
  }
  await createDraftFromMarkdown(mdPath, args);
  console.log('');
  // 段階1 で frontmatter に書かれた ourly_id を段階2 が読む（dry-run 時は ID なしでプレビューのみ）
  await pushBodyFromMarkdown(mdPath, { 'dry-run': args['dry-run'] });
});
