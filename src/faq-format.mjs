// The FAQ's data format, shared by the Lambda (GET /faq, น้องวันดี) and scripts/build-faq.mjs.
//
// src/faq.json is the source of truth. Each answer is a list of blocks, so the web page, the
// iOS app (SwiftUI) and the Android app (Jetpack Compose) can all render it natively:
//
//   Block  = { type: "paragraph", style?: "note" | "warning" | "fine", content: Inline[] }
//          | { type: "heading", content: Inline[] }
//          | { type: "list", ordered: boolean, items: [{ content: Inline[], children?: Block[] }] }
//   Inline = { type: "text", text, bold?: true, muted?: true }
//          | { type: "ui", text }              an app button / screen name (shown as a chip)
//          | { type: "link", text, href }      "#id" = another FAQ question
//          | { type: "icon", name, src }       a small inline icon (Chromecast, AirPlay)
//          | { type: "break" }
//
// renderAnswer() turns blocks into the FAQ page's HTML; answerFromHtml() is the reverse (used to
// import the page once, and by tests to prove the round trip is lossless).

// ---------------- Blocks -> HTML (the FAQ page) ----------------

const CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
const MUTED_STYLE = 'color:var(--text-3);font-size:14px';
const FINE_STYLE = 'font-size:13px;color:var(--text-3)';
const P_CLASS = { note: 'note', warning: 'note warn' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

export function renderInlines(inlines) {
  let html = '';
  for (const n of inlines) {
    if (n.type === 'text') {
      let t = esc(n.text);
      if (n.bold) t = `<b>${t}</b>`;
      if (n.muted) t = `<span style="${MUTED_STYLE}">${t}</span>`;
      html += t;
    } else if (n.type === 'ui') html += `<span class="ui">${esc(n.text)}</span>`;
    else if (n.type === 'link') html += `<a href="${escAttr(n.href)}">${esc(n.text)}</a>`;
    else if (n.type === 'icon') html += `<img class="ico" src="${escAttr(n.src)}" alt="${escAttr(n.name)}">`;
    else if (n.type === 'break') html += '<br>';
    else throw new Error('unknown inline type ' + n.type);
  }
  return html;
}

function renderBlocks(blocks, pad) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      const attr = b.style === 'fine' ? ` style="${FINE_STYLE}"` : b.style ? ` class="${P_CLASS[b.style]}"` : '';
      out.push(`${pad}<p${attr}>${renderInlines(b.content)}</p>`);
    } else if (b.type === 'heading') {
      out.push(`${pad}<h4>${renderInlines(b.content)}</h4>`);
    } else if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      out.push(`${pad}<${tag}>`);
      for (const it of b.items) {
        if (it.children?.length) {
          out.push(`${pad}  <li>${renderInlines(it.content)}`, ...renderBlocks(it.children, pad + '    '), `${pad}  </li>`);
        } else out.push(`${pad}  <li>${renderInlines(it.content)}</li>`);
      }
      out.push(`${pad}</${tag}>`);
    } else throw new Error('unknown block type ' + b.type);
  }
  return out;
}

export function renderAnswer(blocks, pad = '') {
  return renderBlocks(blocks, pad).join('\n');
}

// One language's question list, exactly as it sits in the FAQ page.
export function renderList(faq, lang) {
  const out = [];
  let cat = null;
  for (const e of faq.entries) {
    if (e.category !== cat) {
      cat = e.category;
      const label = faq.categories.find((c) => c.id === cat)[lang];
      if (out.length) out.push('');
      out.push(`      <!-- ===== ${label} ===== -->`);
    } else out.push('');
    const L = e[lang];
    out.push(
      `      <details class="q" id="${escAttr(e.id)}" data-cat="${escAttr(e.category)}"${e.popular ? ' data-popular' : ''}>`,
      `        <summary><span>${esc(L.question)}</span>${CHEVRON}</summary>`,
      '        <div class="a">',
      renderAnswer(L.answer, '          '),
      '        </div>',
      '      </details>',
    );
  }
  return out.join('\n');
}

// ---------------- HTML -> blocks (import + round-trip check) ----------------

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&');
}

const VOID = new Set(['br', 'img', 'path']);

// A small parser for the FAQ answers' HTML: elements, attributes and text, nothing else.
export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+(?:\s*=\s*"[^"]*")?)*)\s*\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      if (top.tag !== tag) throw new Error(`unexpected </${tag}> inside <${top.tag}>`);
      stack.pop();
    } else if (m[2]) {
      const el = { tag: m[2].toLowerCase(), attrs: {}, children: [] };
      for (const a of m[3].matchAll(/([a-zA-Z-]+)(?:\s*=\s*"([^"]*)")?/g)) el.attrs[a[1].toLowerCase()] = a[2] == null ? '' : decode(a[2]);
      top.children.push(el);
      if (!VOID.has(el.tag) && !m[0].endsWith('/>')) stack.push(el);
    } else {
      top.children.push({ tag: '#text', text: decode(m[4]) });
    }
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].tag}> is not closed`);
  return root;
}

const isBlank = (n) => n.tag === '#text' && !n.text.trim();

function inlinesOf(nodes, marks = {}) {
  const out = [];
  for (const n of nodes) {
    if (n.tag === '#text') out.push({ type: 'text', text: n.text, ...marks });
    else if (n.tag === 'b' || n.tag === 'strong') out.push(...inlinesOf(n.children, { ...marks, bold: true }));
    else if (n.tag === 'span' && n.attrs.class === 'ui') out.push({ type: 'ui', text: textOnly(n) });
    else if (n.tag === 'span' && n.attrs.style === MUTED_STYLE) out.push(...inlinesOf(n.children, { ...marks, muted: true }));
    else if (n.tag === 'a') out.push({ type: 'link', text: textOnly(n), href: n.attrs.href || '' });
    else if (n.tag === 'img') out.push({ type: 'icon', name: n.attrs.alt || '', src: n.attrs.src || '' });
    else if (n.tag === 'br') out.push({ type: 'break' });
    else throw new Error(`unsupported inline <${n.tag}${n.attrs.class ? ' class=' + n.attrs.class : ''}${n.attrs.style ? ' style=' + n.attrs.style : ''}>`);
  }
  return out;
}

function textOnly(el) {
  if (el.children.some((c) => c.tag !== '#text')) throw new Error(`<${el.tag}> may only contain text`);
  return el.children.map((c) => c.text).join('').replace(/\s+/g, ' ').trim();
}

// Collapse whitespace like a browser, drop it at the edges and around line breaks, merge same-style text.
function tidy(inlines) {
  const out = [];
  for (const n of inlines) {
    if (n.type !== 'text') { out.push(n); continue; }
    const text = n.text.replace(/\s+/g, ' ');
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && !!prev.bold === !!n.bold && !!prev.muted === !!n.muted) prev.text += text;
    else out.push({ ...n, text });
  }
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (n.type !== 'text') continue;
    if (i === 0 || out[i - 1].type === 'break') n.text = n.text.replace(/^ /, '');
    if (i === out.length - 1 || out[i + 1].type === 'break') n.text = n.text.replace(/ $/, '');
  }
  return out.filter((n) => n.type !== 'text' || n.text);
}

const BLOCK_TAGS = new Set(['p', 'h4', 'ol', 'ul']);

function blocksOf(nodes) {
  const out = [];
  for (const n of nodes) {
    if (isBlank(n)) continue;
    if (n.tag === 'p') {
      const b = { type: 'paragraph' };
      if (n.attrs.class === 'note') b.style = 'note';
      else if (n.attrs.class === 'note warn') b.style = 'warning';
      else if (n.attrs.style === FINE_STYLE) b.style = 'fine';
      else if (n.attrs.class || n.attrs.style) throw new Error(`unsupported <p class="${n.attrs.class || ''}" style="${n.attrs.style || ''}">`);
      b.content = tidy(inlinesOf(n.children));
      out.push(b);
    } else if (n.tag === 'h4') {
      out.push({ type: 'heading', content: tidy(inlinesOf(n.children)) });
    } else if (n.tag === 'ol' || n.tag === 'ul') {
      const items = [];
      for (const li of n.children) {
        if (isBlank(li)) continue;
        if (li.tag !== 'li') throw new Error(`<${n.tag}> may only contain <li>`);
        const split = li.children.findIndex((c) => BLOCK_TAGS.has(c.tag));
        const inl = split < 0 ? li.children : li.children.slice(0, split);
        const item = { content: tidy(inlinesOf(inl)) };
        if (split >= 0) item.children = blocksOf(li.children.slice(split));
        items.push(item);
      }
      out.push({ type: 'list', ordered: n.tag === 'ol', items });
    } else throw new Error(`unsupported block <${n.tag}>`);
  }
  return out;
}

export function answerFromHtml(html) {
  return blocksOf(parseHtml(html).children);
}

// Every <details class="q"> in a chunk of the page: { id, category, popular, question, answer: Block[] }
export function questionsFromHtml(html) {
  const out = [];
  const re = /<details\b([^>]*)>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (!/\bclass\s*=\s*"[^"]*\bq\b[^"]*"/.test(attrs)) continue;
    const id = attr(attrs, 'id');
    const q = /<summary[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(m[2]);
    const a = /<div\s+class\s*=\s*"a"[^>]*>([\s\S]*)<\/div>\s*$/i.exec(m[2]);
    if (!id || !q || !a) throw new Error('malformed FAQ question ' + (id || m[0].slice(0, 80)));
    out.push({ id, category: attr(attrs, 'data-cat') || '', popular: /\bdata-popular\b/.test(attrs), question: toText(q[1]), answer: answerFromHtml(a[1]) });
  }
  return out;
}

// ---------------- Plain text (what น้องวันดี reads) ----------------

// Unchanged from the original page parser, so the bot sees exactly the same text as before.
export function parseFaq(html) {
  const out = [];
  html = html.replace(/<template\b[\s\S]*?<\/template>/gi, '');
  const re = /<details\b([^>]*)>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (!/\bclass\s*=\s*"[^"]*\bq\b[^"]*"/.test(attrs)) continue;
    const id = attr(attrs, 'id');
    if (!id) continue;
    const q = /<summary[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(m[2]);
    const a = /<div\s+class\s*=\s*"a"[^>]*>([\s\S]*)<\/div>\s*$/i.exec(m[2]);
    if (!q || !a) continue;
    out.push({ id, category: attr(attrs, 'data-cat') || '', question: toText(q[1]), answer: toText(a[1]) });
  }
  return out;
}

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return m ? m[1] : '';
}

export function toText(html) {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi, '[$1]')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/?(p|h\d|br|ol|ul|div)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const answerText = (blocks) => toText(renderAnswer(blocks));

// ---------------- Checks ----------------

export function validate(faq) {
  const errors = [];
  const cats = new Set((faq.categories || []).map((c) => c.id));
  const seen = new Set();
  for (const c of faq.categories || []) if (!c.th || !c.en) errors.push(`category ${c.id}: needs th and en labels`);
  for (const e of faq.entries || []) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(e.id || '')) errors.push(`bad id ${e.id}`);
    if (seen.has(e.id)) errors.push(`duplicate id ${e.id}`);
    seen.add(e.id);
    if (!cats.has(e.category)) errors.push(`${e.id}: unknown category ${e.category}`);
    for (const L of ['th', 'en']) {
      if (!e[L]?.question || !Array.isArray(e[L]?.answer) || !e[L].answer.length) { errors.push(`${e.id}: missing ${L} question or answer`); continue; }
      try { renderAnswer(e[L].answer); } catch (err) { errors.push(`${e.id} (${L}): ${err.message}`); }
    }
  }
  if (!faq.entries?.length) errors.push('no entries');
  return errors;
}
