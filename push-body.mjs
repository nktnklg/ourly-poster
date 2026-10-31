// 段階2: md 本文を Editor.js ブロックに変換し、既存の下書きの本文を更新する。
// オプションでタイトル・アイキャッチ・カテゴリも更新できる。
//
// 使い方:
//   node push-body.mjs "<本文.md>" [--id <記事ID>] [--meta] [--title] [--eyecatch <png>] \
//        [--category <記事カテゴリ>] [--analysis <分析カテゴリ>] [--no-body] [--dry-run]
//
// - 記事 ID は --id、なければ md の frontmatter の ourly_id（create-draft.mjs が書き込む）。
// - 既定では本文 (content) と文字数だけ差し替え、タイトル・アイキャッチ・カテゴリは既存の値を保つ。
// - 何度実行しても同じ下書きを上書きする。常に非公開 (isOpened:false) で保存する。
// - 本文の画像 ![キャプション](パス or URL) はアップロードして画像ブロックにする（相対パスは md のフォルダ基準）。
//   一度アップロードした画像は cache/ に記録し、次回からは再利用する。
//
// タイトル・アイキャッチ・カテゴリの更新:
//   --meta              タイトル（本文先頭の H1）・アイキャッチ・記事/分析カテゴリをまとめて md から反映する。
//                       アイキャッチは --eyecatch か、md と同じフォルダの <タイトル>_アイキャッチ.png（無ければ既存のまま）。
//                       カテゴリは CLI 引数 > frontmatter > config.defaults の順で決める。
//   --title             タイトルだけ H1 から反映する。
//   --eyecatch <png>    アイキャッチを差し替える。
//   --category <名前>   記事カテゴリを差し替える（--analysis も同様）。
//   --no-body           本文は更新しない（タイトル等だけ更新する）。
//   --dry-run でタイトル等の更新を指定したときは、ourly から現在の値を読み取り（保存はしない）差分を表示する。
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { markdownToBlocks } from './lib/markdown.mjs';
import { checkImageSource, uploadImages } from './lib/images.mjs';
import {
  openAuthedContext, getArticle, updateArticle, assertUnpublished, uploadBodyImage, uploadEyecatch,
} from './lib/ourly.mjs';
import {
  config, parseArgs, showHelp, userPath, deriveEyecatch, loadArticle, resolveCategories,
  detailUrl, printBlocksPreview, run,
} from './lib/cli.mjs';

// args から、本文以外に更新する項目を決める
function metaTargets(a, args) {
  const all = !!args.meta;
  const t = {
    title: all || !!args.title,
    eyecatch: all || args.eyecatch !== undefined,
    articleCategory: all || args.category !== undefined,
    analysisCategory: all || args.analysis !== undefined,
    eyecatchPath: null,
  };
  if (t.eyecatch) {
    if (args.eyecatch !== undefined) {
      t.eyecatchPath = userPath(args.eyecatch);
      if (!existsSync(t.eyecatchPath)) throw new Error('アイキャッチ画像が見つかりません: ' + t.eyecatchPath);
    } else {
      t.eyecatchPath = deriveEyecatch(a.absMd);
      if (!t.eyecatchPath) {
        console.log('アイキャッチ: md と同じフォルダに画像が無いため、既存のままにします。');
        t.eyecatch = false;
      }
    }
  }
  t.any = t.title || t.eyecatch || t.articleCategory || t.analysisCategory;
  return t;
}

const label = (c) => c?.label || '(なし)';

export async function pushBodyFromMarkdown(mdPath, args) {
  const a = await loadArticle(mdPath, args);
  const withBody = !args['no-body'];
  const meta = metaTargets(a, args);
  if (!withBody && !meta.any) {
    throw new Error('--no-body のときは、更新する項目（--meta / --title / --eyecatch / --category / --analysis）を指定してください。');
  }

  console.log(withBody ? '--- 段階2: 本文の流し込み ---' : '--- 下書きの情報を更新 ---');
  console.log('タイトル :', a.title);
  console.log('記事ID   :', a.id || '(未作成)');

  let blocks, characterCount, images = [], imageInfos = [];
  if (withBody) {
    let warnings;
    ({ blocks, characterCount, images, warnings } = markdownToBlocks(a.bodyMarkdown));
    imageInfos = images.map((img) => checkImageSource(img.src, dirname(a.absMd)));
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
  } else {
    console.log('本文     : 更新しない (--no-body)');
  }

  const dryRun = !!args['dry-run'];
  // タイトル等の更新が無い dry-run は、従来どおりログインせずにプレビューだけ
  if (dryRun && !meta.any) {
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

    const changes = {};
    const updated = [];
    if (meta.any) {
      console.log('\n更新する項目:');
      if (meta.title) {
        console.log(`  タイトル    : ${current.title || '(なし)'} → ${a.title}`);
        changes.title = a.title;
        updated.push('タイトル');
      }
      if (meta.eyecatch) {
        console.log(`  アイキャッチ: ${current.mainImage?.url || '(なし)'} → ${meta.eyecatchPath}`);
      }
      if (meta.articleCategory || meta.analysisCategory) {
        const cats = await resolveCategories(context, a, {
          article: meta.articleCategory, analysis: meta.analysisCategory, dryRun,
        });
        if (cats.articleCategory) {
          console.log(`  記事カテゴリ: ${label(current.articleCategory)} → ${cats.articleCategory.label}`);
          changes.articleCategory = cats.articleCategory;
          updated.push('記事カテゴリ');
        }
        if (cats.analysisCategory) {
          console.log(`  分析カテゴリ: ${label(current.analysisCategory)} → ${cats.analysisCategory.label}`);
          changes.analysisCategory = cats.analysisCategory;
          updated.push('分析カテゴリ');
        }
      }
    }

    if (dryRun) {
      console.log('\n[dry-run] 保存はしません。');
      return;
    }

    if (meta.eyecatch) {
      console.log('アイキャッチをアップロード中...');
      changes.mainImage = await uploadEyecatch(context, config, meta.eyecatchPath);
      console.log('  OK:', changes.mainImage.url);
      updated.push('アイキャッチ');
    }
    if (withBody) {
      if (imageInfos.length) {
        console.log('本文画像をアップロード中...');
        const files = await uploadImages(imageInfos, config.baseUrl, (file) => uploadBodyImage(context, config, file));
        files.forEach((file, i) => { images[i].block.data.file = file; });
      }
      changes.content = JSON.stringify({ time: Date.now(), blocks, version: config.api.editorVersion });
      changes.characterCount = characterCount;
      updated.push('本文');
    }

    console.log('下書きを更新中...');
    await updateArticle(context, config, current, changes);
    console.log('\n✅ 下書きの更新 完了（' + updated.join('・') + '）');
    console.log('   詳細  :', detailUrl(a.id));
    console.log('   公開状態: 非公開(下書き)');
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(async () => {
    const args = parseArgs(process.argv.slice(2), {
      valueOpts: ['id', 'eyecatch', 'category', 'analysis'],
      flagOpts: ['dry-run', 'meta', 'title', 'no-body'],
    });
    if (args.help) showHelp(import.meta.url);
    if (!args._[0]) {
      console.error('本文 markdown のパスを指定してください。');
      console.error('例: node push-body.mjs "記事_本文.md"');
      process.exit(1);
    }
    await pushBodyFromMarkdown(args._[0], args);
  });
}
