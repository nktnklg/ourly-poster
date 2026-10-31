// カテゴリ一覧: ourly に現在ある記事カテゴリ・分析カテゴリを表示する（読み取りのみ）。
//
// 使い方:
//   node categories.mjs
//
// - ここに表示された名前を、md の frontmatter（category / analysis）や --category / --analysis に使う。
// - セッションが切れていれば、ログイン用のブラウザが開く。
import { openAuthedContext, fetchCategories } from './lib/ourly.mjs';
import { config, parseArgs, showHelp, run } from './lib/cli.mjs';

run(async () => {
  if (parseArgs(process.argv.slice(2)).help) showHelp(import.meta.url);
  const { context, close } = await openAuthedContext(config);
  try {
    const { article, analysis } = await fetchCategories(context, config);
    console.log('記事カテゴリ (category):');
    for (const c of article) console.log('  ' + c.label);
    console.log('\n分析カテゴリ (analysis):');
    for (const c of analysis) console.log('  ' + c.label);
  } finally {
    await close();
  }
});
