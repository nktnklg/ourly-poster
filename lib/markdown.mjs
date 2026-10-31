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
// ourly の Editor.js のツール（編集画面の JS と既存記事の content で確認）:
//   header / paragraph / list (nested-list) / quote / delimiter / image / embed / linkTool / attaches
// このツールが出すのは header / paragraph / list / quote / delimiter / image。
// 太字 <strong> は <b>、斜体 <em> は <i> に正規化（ourly の inline 許可タグに合わせる）。
// 段落内の改行は \n（Editor.js が保存する形式）、引用内の改行は <br>（既存記事の quote に合わせる）。
// 画像ブロックの file は空のまま返し、push-body がアップロードして埋める（images に一覧を返す）。

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

function renderChildren(children) {
  return normalizeInline(md.renderer.renderInline(children, md.options, {}));
}

// markdown-it は src をパーセントエンコードするので、ローカルパスとして使えるよう戻す
function decodeSrc(src) {
  try { return decodeURI(src); } catch { return src; }
}

/**
 * 本文 markdown を Editor.js のブロック配列に変換する。
 * @param {string} bodyMarkdown H1 を除いた本文
 * @returns {{blocks: Array, characterCount: number, images: {block: object, src: string}[], warnings: string[]}}
 */
export function markdownToBlocks(bodyMarkdown) {
  const tokens = md.parse(bodyMarkdown, {});
  const blocks = [];
  const images = [];
  const warnings = [];
  let idc = 0;
  const push = (type, data) => {
    const block = { id: randomId(idc++), type, data };
    blocks.push(block);
    return block;
  };

  // 段落以外（見出し・リスト・引用）の中の画像は置けないので、警告を出して落とす
  const inlineText = (inlineToken, where) => {
    const imgs = (inlineToken.children || []).filter((c) => c.type === 'image');
    for (const img of imgs) warnings.push(`${where}の中の画像は入れられないため省きました: ${decodeSrc(img.attrGet('src'))}`);
    return renderChildren(inlineToken.children || []);
  };

  // 段落は画像の前後で分け、画像は image ブロックにする（キャプションは alt）
  const pushParagraph = (inlineToken) => {
    let seg = [];
    const flush = () => {
      const text = renderChildren(seg);
      if (text) push('paragraph', { text, alignment: 'left' });
      seg = [];
    };
    for (const c of inlineToken.children || []) {
      if (c.type !== 'image') { seg.push(c); continue; }
      flush();
      const block = push('image', {
        file: { id: '', url: '' },
        caption: c.content || '',
        withBorder: false,
        stretched: false,
        withBackground: false,
      });
      images.push({ block, src: decodeSrc(c.attrGet('src')) });
    }
    flush();
  };

  // tokens[i] が bullet_list_open / ordered_list_open のとき、対応する close までを nested-list の items にする
  const parseList = (i) => {
    const close = tokens[i].type.replace('_open', '_close');
    const items = [];
    for (i++; i < tokens.length && tokens[i].type !== close; i++) {
      const t = tokens[i];
      if (t.type === 'list_item_open') {
        items.push({ content: '', items: [] });
      } else if (t.type === 'inline') {
        const item = items[items.length - 1];
        const text = inlineText(t, 'リスト');
        item.content = item.content ? `${item.content}\n${text}` : text;
      } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
        const sub = parseList(i);
        items[items.length - 1].items.push(...sub.items);
        i = sub.end;
      }
    }
    return { items, end: i };
  };

  // tokens[i] が blockquote_open のとき、対応する close までを 1 つの quote にする
  const parseQuote = (i) => {
    const parts = [];
    let depth = 0;
    let listDepth = 0;
    for (; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'blockquote_open') depth++;
      else if (t.type === 'blockquote_close' && --depth === 0) break;
      else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') listDepth++;
      else if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') listDepth--;
      else if (t.type === 'inline') {
        const text = inlineText(t, '引用');
        if (text) parts.push((listDepth ? '・' : '') + text);
      }
    }
    return { text: parts.join('\n').replace(/\n/g, '<br>'), end: i };
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      const level = Math.min(Math.max(Number(t.tag.slice(1)) || 2, 2), 6);
      const text = inlineText(tokens[i + 1], '見出し');
      if (text) push('header', { text, level });
      i += 2; // inline + heading_close
    } else if (t.type === 'paragraph_open') {
      pushParagraph(tokens[i + 1]);
      i += 2;
    } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const { items, end } = parseList(i);
      if (items.length) push('list', { style: t.type === 'ordered_list_open' ? 'ordered' : 'unordered', items });
      i = end;
    } else if (t.type === 'blockquote_open') {
      const { text, end } = parseQuote(i);
      if (text) push('quote', { text, caption: '', alignment: 'left' });
      i = end;
    } else if (t.type === 'hr') {
      push('delimiter', {});
    }
  }

  const strip = (s) => (s || '').replace(/<[^>]+>/g, '');
  const listChars = (items) => items.reduce((n, it) => n + strip(it.content).length + listChars(it.items), 0);
  const characterCount = blocks.reduce((sum, b) => {
    if (b.type === 'list') return sum + listChars(b.data.items);
    if (b.type === 'quote') return sum + strip(b.data.text.replace(/<br>/g, '')).length;
    return sum + strip(b.data.text).length;
  }, 0);
  return { blocks, characterCount, images, warnings };
}
