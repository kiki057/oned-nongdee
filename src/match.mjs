// "Did you mean": finds the FAQ questions closest to what the user typed, even with typos.
// Used when น้องดี can't answer (status not_in_faq), so a misspelled question still ends one tap from the
// right answer. It only suggests FAQ entries to open; it never adds words to her answer.
//
// How: both the question and every FAQ question (Thai and English) are normalised (lower case, no spaces,
// punctuation, tone marks or repeated letters), cut into overlapping 3-character pieces, and compared.
// Pieces that appear in many questions ("ได้ไหม", "อย่างไร", "how do") count for little.

const TONE = /[็-์]/g; // ็ ่ ้ ๊ ๋ ์ : the marks people most often miss or misplace
const JUNK = /[\s​-‍﻿"'“”‘’`.,:;!?()[\]{}<>›»«•·…\-–—_/\\|*#+=~@^%&$]+/g;

export function normaliseText(s) {
  return String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ํา/g, 'ำ') // ํ + า typed separately = ำ
    .replace(TONE, '')
    .replace(JUNK, '')
    .replace(/(.)\1{2,}/gu, '$1'); // ค่าาาา -> ค่า, sooo -> so
}

export function grams(s) {
  const t = [...normaliseText(s)];
  const out = new Set();
  if (t.length < 3) { if (t.length) out.add(t.join('')); return out; }
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3).join(''));
  return out;
}

// entries: [{ id, texts: [string, ...] }] — the strings a user might be trying to type for that entry.
export function buildIndex(entries) {
  const docs = entries.map((e) => ({ id: e.id, sets: e.texts.map(grams) }));
  const df = new Map();
  for (const d of docs) {
    const all = new Set(d.sets.flatMap((s) => [...s]));
    for (const g of all) df.set(g, (df.get(g) || 0) + 1);
  }
  const N = docs.length;
  const weight = (g) => Math.log(1 + N / (df.get(g) || 0.5));
  return { docs, weight };
}

// Returns [{ id, score }] best first. score = share of the query's (weighted) pieces found in the entry's
// best-matching text, so a short, misspelled query can still match a long question.
export function closest(index, query, { limit = 2, min = 0.15, exclude = [] } = {}) {
  const q = grams(query);
  if (!q.size) return [];
  let total = 0;
  for (const g of q) total += index.weight(g);
  const scored = index.docs
    .filter((d) => !exclude.includes(d.id))
    .map((d) => {
      let best = 0;
      for (const s of d.sets) {
        let hit = 0;
        for (const g of q) if (s.has(g)) hit += index.weight(g);
        best = Math.max(best, hit / total);
      }
      return { id: d.id, score: Math.round(best * 1000) / 1000 };
    })
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
