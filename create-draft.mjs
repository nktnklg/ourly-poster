// 段階1: タイトル・アイキャッチ・カテゴリだけの「空の下書き」(非公開) を作成する。
//
// 使い方:
//   node create-draft.mjs "<本文.md>" [--category <記事カテゴリ>] [--analysis <分析カテゴリ>] \
//        [--eyecatch <png>] [--force] [--dry-run]
//
// - タイトルは本文先頭の H1 から自動取得。
// - カテゴリは実行時に ourly から最新一覧を取得し、CLI 引数 > md の frontmatter (category / analysis)
//   > config.defaults の順で決める。無い・見つからない場合はターミナルで番号を選ぶ（選択は frontmatter に保存）。
// - 成功すると md の frontmatter に ourly_id を書き込む。本文は push-body.mjs で流し込む。
// - ourly_id が既にある md は二重作成防止のため止める（作り直すときは --force）。
import { pathToFileURL } from 'node:url';
import { writeFrontmatterField } from './lib/markdown.mjs';
import {
  openAuthedContext, fetchCategories, fetchReactions, uploadEyecatch, buildArticlePayload, createDraft, emptyContentJson,
} from './lib/ourly.mjs';
import {
  config, parseArgs, showHelp, userPath, deriveEyecatch, loadArticle, chooseCategory, detailUrl, run,
} from './lib/cli.mjs';

export async function createDraftFromMarkdown(mdPath, args) {
  const a = await loadArticle(mdPath, args);
  const eyecatch = args.eyecatch ? userPath(args.eyecatch) : deriveEyecatch(a.absMd);

  console.log('--- 段階1: 空の下書き作成 ---');
  console.log('タイトル :', a.title);
  console.log('アイキャッチ:', eyecatch ?? '(なし)');

  if (a.meta.ourly_id && !args.force) {
    throw new Error(
      `この md は作成済みです (ourly_id: ${a.meta.ourly_id})。\n` +
      `本文の反映は push-body.mjs を使ってください。作り直す場合は --force。`
    );
  }

  const { context, close } = await openAuthedContext(config);
  try {
    // カテゴリ解決（必須）。ourly の最新一覧から選ぶ。dry-run でも行う
    const categories = await fetchCategories(context, config);
    const articleCategory = await chooseCategory(
      categories.article, { kind: '記事カテゴリ', opt: 'category', key: 'category' }, a.articleCategoryName);
    const analysisCategory = await chooseCategory(
      categories.analysis, { kind: '分析カテゴリ', opt: 'analysis', key: 'analysis' }, a.analysisCategoryName);
    console.log('記事カテゴリ:', articleCategory.label);
    console.log('分析カテゴリ:', analysisCategory.label);

    const fmChanges = [['category', articleCategory.label], ['analysis', analysisCategory.label]]
      .filter(([key, label]) => a.meta[key] !== label);
    if (args['dry-run']) {
      if (fmChanges.length) console.log('（dry-run のため md には保存していません）');
      console.log('\n[dry-run] 作成はしません。');
      return null;
    }
    for (const [key, label] of fmChanges) await writeFrontmatterField(a.absMd, key, label);
    if (fmChanges.length) console.log('カテゴリを md の frontmatter に保存しました。');

    const reactions = await fetchReactions(context, config);

    let mainImage = { id: '', url: '' };
    if (eyecatch) {
      console.log('\nアイキャッチをアップロード中...');
      mainImage = await uploadEyecatch(context, config, eyecatch);
      console.log('  OK:', mainImage.url);
    }

    const payload = buildArticlePayload({
      title: a.title,
      contentJson: emptyContentJson(config),
      characterCount: 0,
      mainImage, articleCategory, analysisCategory, reactions, config,
    });

    console.log('空の下書きを作成中 (isOpened=' + payload.isOpened + ')...');
    const { json, raw } = await createDraft(context, config, payload);
    const id = json?.data?.id || json?.id || '';
    if (!id) throw new Error('作成応答から記事 ID を取得できません: ' + raw.slice(0, 300));

    await writeFrontmatterField(a.absMd, 'ourly_id', id);
    console.log('\n✅ 空の下書き作成 完了');
    console.log('   記事ID:', id, '(md の frontmatter に ourly_id として保存)');
    console.log('   詳細  :', detailUrl(id));
    console.log('   次: node push-body.mjs "' + mdPath + '" で本文を流し込む');
    return id;
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(async () => {
    const args = parseArgs(process.argv.slice(2), {
      valueOpts: ['category', 'analysis', 'eyecatch'],
      flagOpts: ['force', 'dry-run'],
    });
    if (args.help) showHelp(import.meta.url);
    if (!args._[0]) {
      console.error('本文 markdown のパスを指定してください。');
      console.error('例: node create-draft.mjs "記事_本文.md"');
      process.exit(1);
    }
    await createDraftFromMarkdown(args._[0], args);
  });
}
