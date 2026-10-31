// markdown ファイルをタイトルと本文HTMLに変換する。
// - 先頭の H1 (# ...) をタイトルとして抽出し、本文からは除去する。
// - 残りを markdown-it で HTML 化する。
import { readFile, writeFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false, // md 内の生 HTML は無効化（安全側）
  linkify: true, // 素の URL を自動リンク化
  breaks: true, // 改行を <br> に（本文の改行ニュアンスを保持）
  typographer: false,
});

// --- frontmatter ---
// ファイル先頭が `---` のときだけ、次の `---` までを `key: value` として読む（依存なし）。
// 本文中の水平線 `---` には影響しない。
const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

export function splitFrontmatter(text) {
  const m = text.match(FM_RE);
  if (!m) return { meta: {}, rest: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, rest: text.slice(m[0].length) };
}

/**
 * md ファイルの frontmatter に key: value を書き込む（既存キーは置換、無ければ追記）。
 * frontmatter が無ければ先頭に新規作成する。
 */
export async function writeFrontmatterField(filePath, key, value) {
  const text = (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n');
  const line = `${key}: ${value}`;
  const m = text.match(FM_RE);
  let out;
  if (!m) {
    out = `---\n${line}\n---\n${text}`;
  } else {
    const lines = m[1].split('\n');
    const i = lines.findIndex((l) => l.startsWith(key + ':'));
    if (i >= 0) lines[i] = line;
    else lines.push(line);
    out = `---\n${lines.join('\n')}\n---\n` + text.slice(m[0].length);
  }
  await writeFile(filePath, out, 'utf8');
}

/**
 * markdown テキストを解析して { title, bodyMarkdown, html, meta } を返す。
 * @param {string} raw markdown 全文
 */
export function parseMarkdown(raw) {
  const { meta, rest: text } = splitFrontmatter(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n');

  // 先頭の空行を飛ばして最初の H1 を探す
  let title = '';
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) {
      title = m[1].trim();
      bodyStart = i + 1;
    }
    break; // 最初の非空行が H1 でなければタイトル無しとして扱う
  }

  const bodyMarkdown = lines.slice(bodyStart).join('\n').trim();
  const html = md.render(bodyMarkdown);

  return { title, bodyMarkdown, html, meta };
}

/**
 * ファイルパスから読み込んで解析する。
 * @param {string} filePath
 */
export async function parseMarkdownFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const parsed = parseMarkdown(raw);
  if (!parsed.title) {
    throw new Error(`タイトル(H1)が見つかりません: ${filePath}\n本文先頭に "# タイトル" が必要です。`);
  }
  return parsed;
}

// --- Editor.js ブロック変換 ---
// ourly の Editor.js は header / paragraph ツールのみ対応（recon で確認）。
// quote / delimiter ツールは無いので、引用は段落化、水平線(---)はスキップする。
// 太字 <strong> は <b>、斜体 <em> は <i> に正規化（ourly の inline 許可タグに合わせる）。
// ソフト/ハード改行は \n（Editor.js が保存する形式）にする。

function randomId(i) {
  // Editor.js 風の 10 文字 ID。ワークフローではなく通常スクリプトなので Math.random 可。
  const s = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return (s + i.toString(36)).slice(0, 10);
}

function normalizeInline(html) {
  return html
    .replace(/<strong>/g, '<b>')
    .replace(/<\/strong>/g, '</b>')
    .replace(/<em>/g, '<i>')
    .replace(/<\/em>/g, '</i>')
    .replace(/<br\s*\/?>\s*/g, '\n')
    // a / b / i 以外のタグは除去（属性は a の href のみ残る想定）
    .replace(/<(?!\/?(?:a|b|i)(?:\s|>|\/))[^>]*>/g, '')
    .trim();
}

function inlineText(inlineToken) {
  const html = md.renderer.renderInline(inlineToken.children, md.options, {});
  return normalizeInline(html);
}

/**
 * 本文 markdown を Editor.js のブロック配列に変換する。
 * @param {string} bodyMarkdown H1 を除いた本文
 * @returns {{blocks: Array, characterCount: number}}
 */
export function markdownToBlocks(bodyMarkdown) {
  const tokens = md.parse(bodyMarkdown, {});
  const blocks = [];
  let idc = 0;
  const push = (type, data) => blocks.push({ id: randomId(idc++), type, data });

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      const level = Math.min(Math.max(Number(t.tag.slice(1)) || 2, 2), 6);
      const text = inlineText(tokens[i + 1]);
      if (text) push('header', { text, level });
      i += 2; // inline + heading_close
    } else if (t.type === 'paragraph_open') {
      const text = inlineText(tokens[i + 1]);
      if (text) push('paragraph', { text, alignment: 'left' });
      i += 2;
    } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const ordered = t.type === 'ordered_list_open';
      let n = 1;
      for (i++; i < tokens.length; i++) {
        const it = tokens[i];
        if (it.type === (ordered ? 'ordered_list_close' : 'bullet_list_close')) break;
        if (it.type === 'inline') {
          const text = inlineText(it);
          if (text) push('paragraph', { text: (ordered ? `${n++}. ` : '・') + text, alignment: 'left' });
        }
      }
    }
    // blockquote_open/close: 何もしない（中の paragraph は上で段落化される）
    // hr: スキップ
  }

  const characterCount = blocks.reduce(
    (sum, b) => sum + (b.data.text || '').replace(/<[^>]+>/g, '').length,
    0
  );
  return { blocks, characterCount };
}
