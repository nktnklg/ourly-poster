// 段階2: md 本文を Editor.js ブロックに変換し、既存の下書きの本文だけを更新する。
//
// 使い方:
//   node push-body.mjs "<本文.md>" [--id <記事ID>] [--dry-run]
//
// - 記事 ID は --id、なければ md の frontmatter の ourly_id（create-draft.mjs が書き込む）。
// - タイトル・アイキャッチ・カテゴリは既存記事の値を保ったまま、本文 (content) と文字数だけ差し替える。
// - 何度実行しても同じ下書きを上書きする。常に非公開 (isOpened:false) で保存する。
// - 本文の画像 ![キャプション](パス or URL) はアップロードして画像ブロックにする（相対パスは md のフォルダ基準）。
//   一度アップロードした画像は cache/ に記録し、次回からは再利用する。
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { markdownToBlocks } from './lib/markdown.mjs';
import { checkImageSource, uploadImages } from './lib/images.mjs';
import {
  openAuthedContext, getArticle, updateArticle, assertUnpublished, uploadBodyImage,
} from './lib/ourly.mjs';
import {
  config, parseArgs, showHelp, loadArticle, detailUrl, printBlocksPreview, run,
} from './lib/cli.mjs';

export async function pushBodyFromMarkdown(mdPath, args) {
  const a = await loadArticle(mdPath, args);
  const { blocks, characterCount, images, warnings } = markdownToBlocks(a.bodyMarkdown);
  const imageInfos = images.map((img) => checkImageSource(img.src, dirname(a.absMd)));

  console.log('--- 段階2: 本文の流し込み ---');
  console.log('タイトル :', a.title);
  console.log('記事ID   :', a.id || '(未作成)');
  printBlocksPreview(blocks, characterCount);
  if (imageInfos.length) {
    console.log('本文画像 :');
    for (const info of imageInfos) console.log(`  - ${info.label}${info.error ? `  ⚠️ ${info.error}` : ''}`);
  }
  for (const w of warnings) console.log('⚠️', w);
  const bad = imageInfos.filter((info) => info.error);
  if (bad.length) {
    throw new Error(`読み込めない本文画像があります（${bad.length}件）。パスと形式（png / jpg / jpeg / gif）を確認してください。`);
  }

  if (args['dry-run']) {
    console.log('\n[dry-run] 保存はしません。');
    return;
  }
  if (!a.id) {
    throw new Error('記事 ID がありません。先に create-draft.mjs で空の下書きを作成してください（または --id を指定）。');
  }

  const { context, close } = await openAuthedContext(config);
  try {
    const current = await getArticle(context, config, a.id);
    assertUnpublished(current);
    if (imageInfos.length) {
      console.log('本文画像をアップロード中...');
      const files = await uploadImages(imageInfos, config.baseUrl, (file) => uploadBodyImage(context, config, file));
      files.forEach((file, i) => { images[i].block.data.file = file; });
    }
    const contentJson = JSON.stringify({ time: Date.now(), blocks, version: config.api.editorVersion });
    console.log('本文を更新中...');
    await updateArticle(context, config, current, { content: contentJson, characterCount });
    console.log('\n✅ 本文の流し込み 完了');
    console.log('   詳細  :', detailUrl(a.id));
    console.log('   公開状態: 非公開(下書き)');
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(async () => {
    const args = parseArgs(process.argv.slice(2), { valueOpts: ['id'], flagOpts: ['dry-run'] });
    if (args.help) showHelp(import.meta.url);
    if (!args._[0]) {
      console.error('本文 markdown のパスを指定してください。');
      console.error('例: node push-body.mjs "記事_本文.md"');
      process.exit(1);
    }
    await pushBodyFromMarkdown(args._[0], args);
  });
}
