// Reads the FAQ entries straight from the published FAQ page, so the bot never drifts from it.
// Each question on the page is: <details class="q" id="..." data-cat="..."> <summary><span>Question</span>…</summary> <div class="a">Answer</div> </details>

const TTL_MS = 10 * 60 * 1000; // re-read the page at most every 10 minutes
let cache = { at: 0, url: '', entries: null };

export async function loadFaq(url) {
  if (cache.entries && cache.url === url && Date.now() - cache.at < TTL_MS) return cache.entries;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`FAQ fetch failed: ${res.status}`);
    const entries = parseFaq(await res.text());
    if (!entries.length) throw new Error('FAQ page has no <details class="q"> entries (is it the new layout?)');
    cache = { at: Date.now(), url, entries };
  } catch (err) {
    if (!cache.entries) throw err; // nothing cached yet: fail
    console.warn(JSON.stringify({ type: 'faq_refresh_failed', message: String(err) })); // keep serving the last good copy
  }
  return cache.entries;
}

export function parseFaq(html) {
  const out = [];
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

function toText(html) {
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
