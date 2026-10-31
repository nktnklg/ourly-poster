// 本文画像の読み込みとアップロード結果の再利用。
// - md の ![alt](src) の src は、md ファイルからの相対パス・絶対パス・http(s) URL のどれでもよい。
// - 対応形式は ourly のエディタと同じ png / jpg / jpeg / gif。
// - 同じ画像を push のたびにアップロードしないよう、内容のハッシュごとに結果を cache/uploaded-images.json に残す。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cachePath = resolve(toolDir, 'cache/uploaded-images.json');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
const isUrl = (src) => /^https?:\/\//i.test(src);

/**
 * src を確認し、{ src, label, path? | url, ext? } を返す。読めない・対応外のときは error を付ける。
 * ファイルの存在と拡張子だけを見る（dry-run 用。ネットワークには出ない）。
 */
export function checkImageSource(src, mdDir) {
  if (isUrl(src)) {
    // URL は拡張子が無いことも多いので、形式は取得時の content-type で確かめる
    return { src, label: src, url: src, error: null };
  }
  const path = isAbsolute(src) ? src : resolve(mdDir, src);
  const ext = extname(path).toLowerCase();
  let error = null;
  if (!existsSync(path)) error = 'ファイルが見つかりません';
  else if (!MIME[ext]) error = '対応していない形式です（png / jpg / jpeg / gif のみ）';
  return { src, label: path, path, ext, error };
}

async function loadImage(info) {
  if (info.path) return { name: basename(info.path), mimeType: MIME[info.ext], buffer: await readFile(info.path) };
  const res = await fetch(info.url);
  if (!res.ok) throw new Error(`画像を取得できません (${info.url}): status=${res.status}`);
  const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = Object.keys(MIME).find((e) => MIME[e] === mimeType);
  if (!ext) throw new Error(`対応していない形式です（png / jpg / jpeg / gif のみ）: ${info.url} (${mimeType || '不明'})`);
  const name = basename(new URL(info.url).pathname);
  return { name: extname(name) ? name : `image${ext}`, mimeType, buffer: Buffer.from(await res.arrayBuffer()) };
}

async function readCache() {
  try { return JSON.parse(await readFile(cachePath, 'utf8')); } catch { return {}; }
}

/**
 * 画像を読み込み、未アップロードのものだけ upload({name,mimeType,buffer}) → {id,url} でアップロードする。
 * 戻り値は infos と同じ順の {id,url} 配列。キャッシュはテナント（baseUrl）ごとに分ける。
 */
export async function uploadImages(infos, baseUrl, upload) {
  const cache = await readCache();
  const out = [];
  for (const info of infos) {
    const { name, mimeType, buffer } = await loadImage(info);
    const key = `${baseUrl}|${createHash('sha256').update(buffer).digest('hex')}`;
    if (cache[key]) {
      console.log('  再利用:', info.label);
    } else {
      console.log('  アップロード:', info.label);
      cache[key] = await upload({ name, mimeType, buffer });
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf8');
    }
    out.push(cache[key]);
  }
  return out;
}
