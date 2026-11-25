// The FAQ, from src/faq.json (the source of truth, bundled with the Lambda).
//   loadFaq()          Thai entries as plain text: what น้องดี answers from and the guardrail checks against
//   faqDocument(lang)  one language's FAQ for GET /faq (web page and the iOS / Android apps)
// To change the FAQ: edit src/faq.json, run `node scripts/build-faq.mjs` (updates the web page), then deploy.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { answerText, validate } from './faq-format.mjs';

export const LANGS = ['th', 'en'];

// Where each question lives on the web (deep link by id).
const PAGE_URL = { th: 'https://assets.oned.net/doc/faq-th.html', en: 'https://assets.oned.net/doc/faq-en.html' };

let data = null;
export function faqData() {
  if (!data) {
    const raw = JSON.parse(readFileSync(new URL('./faq.json', import.meta.url), 'utf8'));
    const errors = validate(raw);
    if (errors.length) throw new Error('src/faq.json is invalid: ' + errors.join('; '));
    data = raw;
  }
  return data;
}

// Thai only: the guardrail checks every fact against the Thai source, also for English questions.
let botEntries = null;
export async function loadFaq() {
  if (!botEntries) {
    botEntries = faqData().entries.map((e) => ({ id: e.id, category: e.category, question: e.th.question, answer: answerText(e.th.answer) }));
  }
  return botEntries;
}

const docs = {};
export function faqDocument(lang) {
  if (!LANGS.includes(lang)) return null;
  if (!docs[lang]) {
    const f = faqData();
    const body = {
      lang,
      version: f.version,
      popularLabel: f.popular[lang],
      categories: f.categories.map((c) => ({ id: c.id, label: c[lang] })),
      entries: f.entries.map((e) => ({
        id: e.id,
        category: e.category,
        popular: !!e.popular,
        question: e[lang].question,
        answer: e[lang].answer,
        text: answerText(e[lang].answer),
        url: `${PAGE_URL[lang]}#${e.id}`,
      })),
    };
    const json = JSON.stringify(body);
    docs[lang] = { json, etag: '"' + createHash('sha256').update(json).digest('base64url').slice(0, 22) + '"' };
  }
  return docs[lang];
}
