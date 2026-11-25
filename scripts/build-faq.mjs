// Writes the FAQ questions from src/faq.json (the source of truth) into the FAQ page:
//   node scripts/build-faq.mjs            check src/faq.json, then rewrite the question lists in web/faq-*-beta.html
//   node scripts/build-faq.mjs --check    only check that the page matches src/faq.json (exit 1 if not)
//   node scripts/build-faq.mjs --import   one-off: rebuild src/faq.json from the page (how it was first created)
// Then run: node scripts/build-preview.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { questionsFromHtml, renderList, validate } from '../src/faq-format.mjs';

const root = new URL('../', import.meta.url);
const PAGES = ['web/faq-th-beta.html', 'web/faq-en-beta.html'];
const JSON_PATH = 'src/faq.json';
const read = (p) => readFile(new URL(p, root), 'utf8');
const mode = process.argv[2] || '';

const MARK = {
  th: ['<!-- faq:th (generated from src/faq.json by scripts/build-faq.mjs: edit the JSON, not this list) -->', '<!-- /faq:th -->'],
  en: ['<!-- faq:en (generated from src/faq.json by scripts/build-faq.mjs: edit the JSON, not this list) -->', '<!-- /faq:en -->'],
};

// Where each language's list sits in the page: between the markers, or (before the first build)
// inside <div class="list" id="list"> for Thai and <template id="list-en"> for English.
export function region(html, lang) {
  const [open, close] = MARK[lang];
  let a = html.indexOf(open), b = html.indexOf(close);
  if (a >= 0 && b > a) return { start: a, end: b + close.length, inner: html.slice(a + open.length, b), lead: '' };
  const startTag = lang === 'th' ? '<div class="list" id="list">' : '<template id="list-en">';
  const endTag = lang === 'th' ? '\n    </div>\n\n    <!-- English questions' : '\n    </template>';
  a = html.indexOf(startTag); b = html.indexOf(endTag, a);
  if (a < 0 || b < 0) throw new Error(`can't find the ${lang} question list in the page`);
  a += startTag.length;
  return { start: a, end: b, inner: html.slice(a, b), lead: '\n      ' };
}

export function writeLists(html, faq) {
  for (const lang of ['en', 'th']) { // English first: it comes later in the file, so the Thai offsets stay valid
    const r = region(html, lang);
    html = html.slice(0, r.start) + `${r.lead}${MARK[lang][0]}\n${renderList(faq, lang)}\n      ${MARK[lang][1]}` + html.slice(r.end);
  }
  return html;
}

function importFromPage(html) {
  const th = questionsFromHtml(region(html, 'th').inner);
  const en = new Map(questionsFromHtml(region(html, 'en').inner).map((q) => [q.id, q]));
  if (th.length !== en.size) throw new Error(`Thai has ${th.length} questions, English ${en.size}`);
  const thTabs = Object.fromEntries([...html.matchAll(/<button class="tab"[^>]*data-cat="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]));
  const enBlock = /en:\s*\{[\s\S]*?tabs:\s*\{([^}]*)\}/.exec(html)[1];
  const enTabs = Object.fromEntries([...enBlock.matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]]));
  const order = [...new Set(th.map((q) => q.category))];
  return {
    source: 'FAQ on oneD WebApp TH Version 2.0 (Nov 2026)',
    version: '2.0',
    popular: { th: thTabs.popular, en: enTabs.popular },
    categories: order.map((id) => ({ id, th: thTabs[id], en: enTabs[id] })),
    entries: th.map((q) => {
      const e = en.get(q.id);
      if (!e) throw new Error(`no English question for ${q.id}`);
      if (e.category !== q.category || e.popular !== q.popular) throw new Error(`${q.id}: English category/popular differs from Thai`);
      return { id: q.id, category: q.category, popular: q.popular, th: { question: q.question, answer: q.answer }, en: { question: e.question, answer: e.answer } };
    }),
  };
}

// JSON.stringify with 2-space indent, but small objects (one inline, one category) stay on one line, so the file reads like the answers.
export function pretty(v, pad = '') {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || (flat.length <= 110 && !Object.values(v).some((x) => x && typeof x === 'object' && (Array.isArray(x) ? x.some((y) => y && typeof y === 'object') : Object.values(x).some((y) => y && typeof y === 'object'))))) return flat;
  const inner = pad + '  ';
  if (Array.isArray(v)) return '[\n' + v.map((x) => inner + pretty(x, inner)).join(',\n') + '\n' + pad + ']';
  return '{\n' + Object.entries(v).map(([k, x]) => inner + JSON.stringify(k) + ': ' + pretty(x, inner)).join(',\n') + '\n' + pad + '}';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (mode === '--import') {
    const faq = importFromPage(await read(PAGES[0]));
    await writeFile(new URL(JSON_PATH, root), pretty(faq) + '\n');
    console.log(`${JSON_PATH} written: ${faq.entries.length} questions in ${faq.categories.length} categories`);
  }
  const faq = JSON.parse(await read(JSON_PATH));
  const errors = validate(faq);
  if (errors.length) { console.error('src/faq.json has problems:\n- ' + errors.join('\n- ')); process.exit(1); }
  let stale = 0;
  for (const p of PAGES) {
    const html = await read(p);
    const next = writeLists(html, faq);
    if (next === html) continue;
    if (mode === '--check') { console.error(`${p} is out of date: run node scripts/build-faq.mjs`); stale++; }
    else { await writeFile(new URL(p, root), next); console.log(`${p} updated`); }
  }
  if (stale) process.exit(1);
  if (mode === '--check') console.log('FAQ page matches src/faq.json');
}
