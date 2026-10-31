// ourly 管理画面とのやりとり（記事の作成・取得・更新、画像アップロード、カテゴリ等の取得）。
// 下書き(非公開)は isOpened:false。公開はしない。
// ログインはツール専用のブラウザプロファイル (auth/profile/) に保持する。
// 普段使いの Chrome のプロファイルや Cookie には触れない。パスワードも扱わない。
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const toolDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_POLL_MS = 2000;

export function profileDir(config) {
  return resolve(toolDir, config.authProfileDir);
}

// 同じプロファイルを複数プロセスで同時に開くと壊れうるので、pid 入りのロックファイルで排他する。
// 持ち主のプロセスが既に死んでいるロックは取り直す。
function acquireLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      const release = () => { try { unlinkSync(lockPath); } catch {} };
      process.once('exit', release);
      return release;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const pid = Number(readFileSync(lockPath, 'utf8'));
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch {}
      if (alive && pid !== process.pid) {
        throw new Error('他の ourly-poster が実行中です（ブラウザのプロファイル使用中）。終了してから再実行してください。');
      }
      unlinkSync(lockPath);
    }
  }
  throw new Error('プロファイルのロックを取得できません: ' + lockPath);
}

// ツール専用プロファイルで persistent context を開く。戻り値の close() で閉じる。
export async function openContext(config, { headless = true } = {}) {
  if (!config.baseUrl) {
    throw new Error('管理画面の URL が未設定です。`npm run setup` で設定してください（config.local.json の baseUrl）。');
  }
  const dir = profileDir(config);
  const release = acquireLock(dir + '.lock');
  let context;
  try {
    context = await chromium.launchPersistentContext(dir, {
      headless,
      ...(config.browserChannel ? { channel: config.browserChannel } : {}),
    });
  } catch (err) {
    release();
    throw err;
  }
  return {
    context,
    close: async () => {
      try {
        await context.close();
      } finally {
        release();
      }
    },
  };
}

// セッション有効性（/admin/articles が 200 か）
export async function isAuthed(context, config) {
  const res = await context.request.get(config.baseUrl + config.adminArticlesPath, { maxRedirects: 0 });
  return res.status() === 200;
}

// 画面ありのブラウザで管理画面を開き、利用者のログイン完了を自動検知するまで待つ（Enter 不要）
async function waitForManualLogin(context, config) {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(config.baseUrl + config.adminArticlesPath, { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log('\n🔑 ブラウザが開きました。その画面で ourly にログインしてください。');
  console.log('   ログインが完了すると自動で続行します（最大5分待ちます）。');
  let closed = false;
  context.once('close', () => { closed = true; });
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LOGIN_POLL_MS));
    // Mac ではウィンドウを閉じてもブラウザ自体は残るので、ページが全て閉じられたら閉じたとみなす
    if (closed || context.pages().length === 0) throw new Error('ログイン前にブラウザが閉じられました。');
    if (await isAuthed(context, config).catch(() => false)) {
      console.log('   ✅ ログインを確認しました。');
      return;
    }
  }
  throw new Error('ログインを確認できませんでした（5分経過）。もう一度実行してください。');
}

/**
 * 認証済みの context を返す。
 * まず画面なしで開き、セッション切れなら画面ありで開き直してログインを待ち、そのまま続行する。
 * headless:false を指定すると最初から画面ありで開く（login.mjs 用）。
 */
export async function openAuthedContext(config, { headless = true } = {}) {
  if (headless) {
    const ctx = await openContext(config, { headless: true });
    if (await isAuthed(ctx.context, config).catch(() => false)) return ctx;
    await ctx.close();
    console.log('セッションが無いか切れています。ログイン用のブラウザを開きます。');
  }
  const ctx = await openContext(config, { headless: false });
  try {
    if (!(await isAuthed(ctx.context, config).catch(() => false))) {
      await waitForManualLogin(ctx.context, config);
    }
  } catch (err) {
    await ctx.close().catch(() => {});
    throw err;
  }
  return ctx;
}

// ourly に現在あるカテゴリ一覧を取得（GET /admin/xhr/Master）→ { article, analysis }
export async function fetchCategories(context, config) {
  const res = await context.request.get(config.baseUrl + config.api.masterPath);
  const text = await res.text();
  if (res.status() !== 200) {
    throw new Error(`カテゴリ取得API失敗: status=${res.status()}\n${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text)?.data ?? {};
  const pick = (xs) => (xs || []).map((x) => ({ id: x.id, label: x.label }));
  return { article: pick(data.articleCategories), analysis: pick(data.analysisCategories) };
}

// テナントのリアクション設定を取得する（記事作成 payload 用）。
// 既存記事の reactions（{id,label,type,canReaction}）を使う。記事が無ければ Master.reactionTypes で代用する。
export async function fetchReactions(context, config) {
  const res = await context.request.get(config.baseUrl + config.api.articlesListPath);
  if (res.status() === 200) {
    const first = (await res.json())?.data?.articles?.[0];
    if (first?.articleId) {
      const article = await getArticle(context, config, first.articleId);
      if (Array.isArray(article.reactions) && article.reactions.length) return article.reactions;
    }
  }
  const master = (await (await context.request.get(config.baseUrl + config.api.masterPath)).json())?.data ?? {};
  console.warn('⚠ 既存記事からリアクション設定を取得できないため、Master の reactionTypes で代用します（type なし）。');
  return (master.reactionTypes || [])
    .filter((r) => r.isEnabled)
    .map((r) => ({ id: r.id, label: r.label, canReaction: true }));
}

// 名前比較用: 前後の空白と絵文字の異体字セレクタ (U+FE0F) を無視する（⭐️ と ⭐ を同一視）
const normName = (s) => String(s).replace(/\uFE0F/g, '').trim();

// カテゴリ名 → {id,label,value}。見つからなければ null
export function findCategory(list, name) {
  if (!name) return null;
  const hit = list.find((c) => normName(c.label) === normName(name));
  return hit ? { id: hit.id, label: hit.label, value: hit.id } : null;
}

// アイキャッチ画像アップロード（実エディタ画面のファイル入力を使う）→ {id,url}
export async function uploadEyecatch(context, config, filePath) {
  const page = await context.newPage();
  try {
    await page.goto(config.baseUrl + '/admin/articles/new', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const respP = page.waitForResponse((r) => /\/admin\/proxy\/api\/images/.test(r.url()), { timeout: 60000 });
    await page.setInputFiles('#article-main-visual-input', filePath);
    const res = await respP;
    if (res.status() !== 200) throw new Error(`画像アップロード失敗: status=${res.status()}`);
    const json = await res.json();
    const file = json.file || {};
    if (!file.id || !file.url) throw new Error('アップロード応答に file.id/url がありません: ' + JSON.stringify(json));
    return { id: file.id, url: file.url };
  } finally {
    await page.close();
  }
}

// 本文画像アップロード（エディタの image ツールと同じ endpoint に multipart で送る）→ {id,url}
// image ツールは @editorjs/image の既定どおりフィールド名 image で送り、応答は {success, file:{url,...}}。
export async function uploadBodyImage(context, config, { name, mimeType, buffer }) {
  const res = await context.request.post(config.baseUrl + config.api.uploadBodyImagePath, {
    multipart: { [config.api.uploadBodyImageField]: { name, mimeType, buffer } },
  });
  const text = await res.text();
  if (res.status() !== 200) throw new Error(`本文画像のアップロード失敗 (${name}): status=${res.status()}\n${text.slice(0, 500)}`);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const file = json?.file || {};
  if (!file.url) throw new Error(`本文画像のアップロード応答に file.url がありません (${name}): ${text.slice(0, 500)}`);
  return { id: file.id || '', url: file.url };
}

// 記事作成の payload を組み立てる（recon の成功リクエストを雛形に）
export function buildArticlePayload({
  title, contentJson, characterCount, mainImage, articleCategory, analysisCategory, reactions, config,
}) {
  return {
    analysisCategory,
    articleCategory,
    articleGenre: { id: '', label: '' },
    articleSubCategory: { id: '', label: '' },
    canComment: true,
    characterCount,
    draft: { content: '', mainImage: { id: '', url: '' }, title: '' },
    id: '',
    isDraft: false,
    isNeedEmailNotify: false,
    isOpened: config.api.draftIsOpened === true, // 既定 false = 非公開(下書き)
    mainImage: mainImage || { id: '', url: '' },
    reactions, // テナントごとに異なるので fetchReactions で取得したものを渡す
    readableGroupId: '',
    title,
    canPublishArticle: true,
    isArticleAdvancedManagementAvailable: false,
    linkedAuthorIds: [],
    linkedCharacterIds: [],
    linkedObserverIds: [],
    content: contentJson,
  };
}

// 記事を作成（下書き保存）
export async function createDraft(context, config, payload) {
  const url = config.baseUrl + config.api.createArticlePath;
  const res = await context.request.post(url, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data: payload,
  });
  const status = res.status();
  const text = await res.text();
  if (status < 200 || status >= 300) {
    throw new Error(`記事作成API失敗: status=${status}\n${text.slice(0, 500)}`);
  }
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status, json, raw: text };
}

// 空本文の Editor.js content（段階1 の空の下書き用）
export function emptyContentJson(config) {
  return JSON.stringify({ time: Date.now(), blocks: [], version: config.api.editorVersion });
}

function apiUrl(config, key, id) {
  return config.baseUrl + config.api[key].replace('{id}', encodeURIComponent(id));
}

// 既存記事を取得（編集画面が使う GET /admin/xhr/Article?id=<id>）
export async function getArticle(context, config, id) {
  const res = await context.request.get(apiUrl(config, 'getArticlePath', id));
  const text = await res.text();
  if (res.status() !== 200) {
    throw new Error(`記事取得API失敗: status=${res.status()}\n${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text);
  return json?.data ?? json;
}

// GET の記事データを、編集画面の「下書き保存する」と同じ形の更新 payload に変換する
// （管理画面の JS から確認: linked* はオブジェクト配列 → ID 配列、サブカテゴリ/ジャンルは {id,label}）。
export function buildUpdatePayload(current, changes) {
  const idLabel = (id) => ({ id: id || '', label: '' });
  return {
    analysisCategory: current.analysisCategory || { id: '', label: '' },
    articleCategory: current.articleCategory || { id: '', label: '' },
    articleGenre: idLabel(current.articleGenreId),
    articleSubCategory: idLabel(current.articleSubCategoryId),
    canComment: current.canComment ?? false,
    characterCount: current.characterCount,
    content: current.content,
    draft: current.draft,
    id: current.id,
    isNeedEmailNotify: current.isNeedEmailNotify ?? false,
    mainImage: current.mainImage,
    reactions: current.reactions || [],
    readableGroupId: current.readableGroupId ?? '',
    title: current.title,
    canPublishArticle: true,
    isArticleAdvancedManagementAvailable: false,
    linkedAuthorIds: (current.linkedAuthors || []).map((x) => x.id),
    linkedCharacterIds: (current.linkedCharacters || []).map((x) => x.id),
    linkedObserverIds: (current.linkedObservers || []).map((x) => x.id),
    ...changes,
    // 未公開記事の下書き保存は isOpened:false / isDraft:false（本文をそのまま上書き）
    isOpened: false,
    isDraft: false,
  };
}

// 公開済み・公開予約済みの記事は、非公開化や公開中本文の上書きを避けるため拒否する。
export function assertUnpublished(current) {
  if (current.isOpened || current.scheduledPublishAt) {
    throw new Error('この記事は公開済み、または公開予約済みです。このツールは未公開の下書きしか更新しません。');
  }
}

// 未公開の下書き記事の一部フィールドを差し替えて更新する（PUT /admin/xhr/Article?id=<id>）。
export async function updateArticle(context, config, current, changes) {
  assertUnpublished(current);
  const res = await context.request.fetch(apiUrl(config, 'updateArticlePath', current.id), {
    method: config.api.updateMethod,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data: buildUpdatePayload(current, changes),
  });
  const text = await res.text();
  if (res.status() < 200 || res.status() >= 300) {
    throw new Error(`記事更新API失敗: status=${res.status()}\n${text.slice(0, 500)}`);
  }
  return text;
}
