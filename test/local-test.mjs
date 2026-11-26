// Runs the Lambda handler on your machine with a fake Claude API, so you can check the plumbing
// without an API key:   node test/local-test.mjs
// To try the REAL Claude API locally instead, see README ("Test locally with a real key").
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ALLOWED_ORIGINS = 'https://assets.oned.net';

const faqHtml = await readFile(new URL('../web/faq-th-beta.html', import.meta.url), 'utf8');
let lastClaudeBody = null;
let lastVerifyBody = null;
let fakeReply = null;
let fakeVerdict = '{"supported": true, "unsupported": []}';
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://assets.oned.net/')) return new Response(faqHtml, { status: 200 });
  if (String(url) === 'https://api.anthropic.com/v1/messages') {
    const body = JSON.parse(opts.body);
    assert.equal(opts.headers['x-api-key'], 'test-key');
    if (typeof body.system === 'string') { // the second-pass verifier
      lastVerifyBody = body;
      if (fakeVerdict === 'ERROR') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: fakeVerdict }], usage: {}, stop_reason: 'end_turn' }), { status: 200 });
    }
    lastClaudeBody = body;
    assert.equal(opts.headers['anthropic-version'], '2023-06-01');
    return new Response(JSON.stringify({ content: [{ type: 'text', text: fakeReply }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }), { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
};
console.log = () => {}; console.warn = () => {}; console.error = () => {}; // keep test output clean

const { handler, normalise, clean } = await import('../src/handler.mjs');
const { parseFaq, questionsFromHtml, renderList, validate } = await import('../src/faq-format.mjs');
const { loadFaq } = await import('../src/faq.mjs');
const { writeLists } = await import('../scripts/build-faq.mjs');
const faqJson = JSON.parse(await readFile(new URL('../src/faq.json', import.meta.url), 'utf8'));
const ev = (body, extra = {}) => ({
  rawPath: extra.path || '/chat',
  requestContext: { http: { method: extra.method || 'POST', sourceIp: extra.ip || '1.2.3.4' } },
  headers: { ...(extra.origin === null ? {} : { origin: extra.origin ?? 'https://assets.oned.net' }), 'user-agent': 'test', ...extra.headers },
  queryStringParameters: extra.query,
  body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' — ' + e.message]); } };

await test('parses every FAQ question from the page', async () => {
  const faq = parseFaq(faqHtml);
  assert.ok(faq.length >= 20, 'only ' + faq.length);
  assert.equal(new Set(faq.map((f) => f.id)).size, faq.length, 'no duplicate ids (English template skipped)');
  assert.ok(/[\u0E00-\u0E7F]/.test(faq[0].question), 'Thai questions');
  const code = faq.find((f) => f.id === 'Activateonetimecode');
  assert.ok(code && code.answer.includes('redeem.oned.net') && code.answer.includes('\n- '));
});

// ---------------- FAQ as data (src/faq.json) ----------------
await test('faq.json is valid: unique ids, known categories, Thai and English for every question', async () => {
  assert.deepEqual(validate(faqJson), []);
  assert.ok(faqJson.entries.length >= 20);
});

await test('the FAQ page is generated from faq.json (run scripts/build-faq.mjs if this fails)', async () => {
  assert.equal(writeLists(faqHtml, faqJson), faqHtml);
  const en = await readFile(new URL('../web/faq-en-beta.html', import.meta.url), 'utf8');
  assert.equal(en, faqHtml, 'faq-en-beta.html and faq-th-beta.html are the same file');
});

await test('page -> JSON -> page round trip loses nothing', async () => {
  const th = /<!-- faq:th[^>]*-->([\s\S]*?)<!-- \/faq:th -->/.exec(faqHtml)[1];
  const en = /<!-- faq:en[^>]*-->([\s\S]*?)<!-- \/faq:en -->/.exec(faqHtml)[1];
  const back = (html, L) => questionsFromHtml(html).map((q) => ({ id: q.id, category: q.category, popular: q.popular, question: q.question, answer: q.answer }));
  const want = (L) => faqJson.entries.map((e) => ({ id: e.id, category: e.category, popular: !!e.popular, question: e[L].question, answer: e[L].answer }));
  assert.deepEqual(back(th, 'th'), want('th'));
  assert.deepEqual(back(en, 'en'), want('en'));
  assert.equal(renderList(faqJson, 'th').trim(), th.trim());
});

await test('น้องวันดี reads the same Thai text from faq.json as from the page', async () => {
  assert.deepEqual(await loadFaq(), parseFaq(faqHtml));
});

await test('openapi.yaml lists the same support-form issues as src/prompt.mjs', async () => {
  const { ISSUES } = await import('../src/prompt.mjs');
  const spec = await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8');
  const listed = /SupportIssue:[\s\S]*?enum:\n((?:\s+- .*\n)+)/.exec(spec)[1].trim().split('\n').map((l) => l.trim().slice(2));
  assert.deepEqual(listed, ISSUES);
});

const getFaq = (query, extra = {}) => handler(ev(null, { path: '/faq', method: 'GET', query, ...extra }));

await test('GET /faq returns Thai by default and English with ?lang=en, same ids', async () => {
  const th = await getFaq(undefined, { origin: null });
  assert.equal(th.statusCode, 200, 'apps send no Origin header');
  const t = JSON.parse(th.body);
  assert.equal(t.lang, 'th');
  assert.match(th.headers['cache-control'], /public/);
  const e = JSON.parse((await getFaq({ lang: 'en' })).body);
  assert.equal(e.lang, 'en');
  assert.deepEqual(e.entries.map((x) => [x.id, x.category, x.popular]), t.entries.map((x) => [x.id, x.category, x.popular]));
  assert.ok(/[\u0E00-\u0E7F]/.test(t.entries[0].question) && !/[\u0E00-\u0E7F]/.test(e.entries[0].question));
  const code = e.entries.find((x) => x.id === 'Activateonetimecode');
  assert.ok(code.answer.some((b) => b.type === 'list'), 'answers are blocks');
  assert.ok(code.text.includes('redeem.oned.net'), 'plus plain text for search');
  assert.equal(code.url, 'https://assets.oned.net/doc/faq-en.html#Activateonetimecode');
  assert.deepEqual(t.categories.map((c) => c.id), ['account', 'premium', 'code', 'help', 'cancel', 'general']);
});

await test('GET /faq: 304 for a matching ETag, 400 for an unknown language, 405 for POST', async () => {
  const first = await getFaq({ lang: 'th' });
  assert.ok(first.headers.etag);
  assert.equal((await getFaq({ lang: 'th' }, { headers: { 'if-none-match': first.headers.etag } })).statusCode, 304);
  assert.equal((await getFaq({ lang: 'jp' })).statusCode, 400);
  assert.equal((await handler(ev({}, { path: '/faq', method: 'POST' }))).statusCode, 405);
});

// ---------------- Typos: "did you mean" ----------------
const { relatedFaq } = await import('../src/faq.mjs');
const { normaliseText } = await import('../src/match.mjs');

await test('typo matching: misspelled Thai and English questions find the right FAQ entry', async () => {
  const cases = [
    ['แลกโคดในแอบได้มั้ย', 'Activateonetimecode'], ['แลกโค๊ดไม่ได้', 'codefailed'], ['ยกเลิกแพ็คเก็ดไอโฟน', 'unsubscribe'],
    ['จ่ายตังแล้วไม่เป็นพรีเมี่ยม', 'premiumnotreceived'], ['ดูบนทีวีซัมซุงได้ป่าว', 'watchontv'], ['วีดีโอกระตุก', 'technicalissue'],
    ['ใช้ต่างประเทสได้ไหม', 'servicearea'], ['สมัคพรีเมียมยังไง', 'subscription'], ['แก้ไขโปรไฟล', 'editprofile'],
    ['cansel subscribtion iphone', 'unsubscribe'], ['how to redem code', 'Activateonetimecode'], ['wach on tv', 'watchontv'],
    ['chromcast', 'ChromecastAirplay'], ['use oned abroad', 'servicearea'], ['cancel ais', 'unsubscribeais'],
  ];
  const misses = cases.filter(([q, id]) => !relatedFaq(q).includes(id));
  assert.deepEqual(misses, []);
});

await test('typo matching: ignores tone marks, repeated letters and spacing; nothing for off-topic', async () => {
  assert.equal(normaliseText('ค่าาาา  โค๊ด!'), normaliseText('คา โคด'));
  assert.deepEqual(relatedFaq('แนะนำละครสนุกๆ'), []);
  assert.deepEqual(relatedFaq('สวัสดี'), []);
  assert.deepEqual(relatedFaq('ยกเลิกแพคเกจ android', ['unsubscribeandroid']).includes('unsubscribeandroid'), false, 'excludes ids already cited');
});

await test('not_in_faq replies carry "did you mean" FAQ ids; answered replies do not', async () => {
  fakeReply = '{"answer":"x","sources":[],"evidence":[],"status":"not_in_faq","handoff_issue":null,"suggestions":[]}';
  let b = JSON.parse((await handler(ev({ messages: [{ role: 'user', content: 'แลกโคดในแอบได้มั้ย' }] }, { ip: 'typo1' }))).body);
  assert.equal(b.status, 'not_in_faq');
  assert.ok(b.related.includes('Activateonetimecode'), JSON.stringify(b.related));
  fakeReply = '{"answer":"แลกในแอปไม่ได้ค่ะ","sources":["Activateonetimecode"],"evidence":["แลกในแอปไม่ได้"],"status":"answered","handoff_issue":null,"suggestions":[]}';
  b = JSON.parse((await handler(ev({ messages: [{ role: 'user', content: 'แลกโคดในแอบได้มั้ย' }] }, { ip: 'typo2' }))).body);
  assert.equal(b.status, 'answered'); assert.deepEqual(b.related, []);
});

await test('the prompt tells น้องวันดี to read through typos', async () => {
  const { RULES } = await import('../src/prompt.mjs');
  assert.match(RULES, /typos/); assert.match(RULES, /closest FAQ question/);
});

await test('answers, keeps only real FAQ ids, returns a chat id', async () => {
  fakeReply = 'Sure! {"answer":"แลกในแอปไม่ได้ค่ะ","sources":["Activateonetimecode","made-up-id"],"evidence":["แลกในแอปไม่ได้"],"status":"answered","handoff_issue":null,"suggestions":["แลกโค้ดไม่สำเร็จ"]}';
  const r = await handler(ev({ messages: [{ role: 'user', content: 'แลกโค้ดในแอปได้ไหม' }] }));
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.deepEqual(b.sources, ['Activateonetimecode']);
  assert.equal(b.answer, 'แลกในแอปไม่ได้ค่ะ');
  assert.equal(b.evidence, undefined, 'evidence is internal');
  assert.match(b.chatId, /^c_[a-z0-9]{16}$/);
  assert.equal(r.headers['access-control-allow-origin'], 'https://assets.oned.net');
  assert.ok(lastClaudeBody.system[1].cache_control, 'FAQ block should be cached');
  assert.ok(lastClaudeBody.system[1].text.includes('Activateonetimecode'));
});

await test('masks phone, email and card numbers before Claude sees them', async () => {
  fakeReply = '{"answer":"x","sources":[],"status":"not_in_faq","handoff_issue":null,"suggestions":[]}';
  await handler(ev({ messages: [{ role: 'user', content: 'เบอร์ 081-234-5678 อีเมล a.b@gmail.com บัตร 4111 1111 1111 1111' }] }));
  const sent = lastClaudeBody.messages.at(-1).content;
  assert.ok(!/081|gmail|4111/.test(sent), sent);
  assert.ok(sent.includes('[เบอร์โทร]') && sent.includes('[อีเมล]') && sent.includes('[ตัวเลข]'), sent);
});

await test('not_in_faq always gets a valid handoff issue', async () => {
  fakeReply = '{"answer":"ไม่มีข้อมูลค่ะ","sources":[],"status":"not_in_faq","handoff_issue":"something invented","suggestions":[]}';
  const b = JSON.parse((await handler(ev({ messages: [{ role: 'user', content: 'ขอเงินคืน' }] }))).body);
  assert.equal(b.handoff_issue, 'อื่นๆ (โปรดระบุ)');
});

await test('garbage from the model becomes a safe fallback', async () => {
  fakeReply = 'I cannot produce JSON today';
  const b = JSON.parse((await handler(ev({ messages: [{ role: 'user', content: 'hi' }] }))).body);
  assert.equal(b.status, 'not_in_faq');
  assert.ok(b.answer.startsWith("Sorry, this isn't covered"), b.answer); // "hi" is English, so the English fixed text
});

await test('rejects other websites', async () => {
  const r = await handler(ev({ messages: [{ role: 'user', content: 'hi' }] }, { origin: 'https://evil.example' }));
  assert.equal(r.statusCode, 403);
});

await test('rejects bad message lists', async () => {
  assert.equal((await handler(ev({ messages: [{ role: 'system', content: 'x' }] }))).statusCode, 400);
  assert.equal((await handler(ev({ messages: [] }))).statusCode, 400);
  assert.equal((await handler(ev('not json'))).statusCode, 400);
});

await test('normalises history: starts with user, merges repeats, max 10', async () => {
  const many = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
  const n = normalise([{ role: 'assistant', content: 'hello' }, ...many]);
  assert.equal(n[0].role, 'user'); assert.equal(n.at(-1).role, 'user'); assert.ok(n.length <= 10);
  assert.equal(normalise([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]).length, 1);
});

await test('rate limits one IP after 20 messages', async () => {
  fakeReply = '{"answer":"ok","sources":["Signin"],"status":"answered","handoff_issue":null,"suggestions":[]}';
  let last;
  for (let i = 0; i < 21; i++) last = await handler(ev({ messages: [{ role: 'user', content: 'hi' }] }, { ip: '9.9.9.9' }));
  assert.equal(last.statusCode, 429);
});

await test('feedback is accepted', async () => {
  const r = await handler(ev({ chatId: 'c_abcdef1234567890', turn: 1, rating: 'down' }, { path: '/feedback' }));
  assert.equal(r.statusCode, 204);
});

// ---------------- FAQ-only guardrail ----------------
const ask = async (reply, text = 'ถามหน่อย', ip) => {
  fakeReply = JSON.stringify(reply);
  return JSON.parse((await handler(ev({ messages: [{ role: 'user', content: text }] }, { ip: ip || 'g' + Math.random() }))).body);
};
const UNSURE = 'ขออภัยค่ะ น้องวันดีไม่แน่ใจคำตอบนี้';
fakeVerdict = '{"supported": true, "unsupported": []}';

await test('guardrail: a correct answer with a real number passes', async () => {
  const b = await ask({ answer: 'โทร AIS Call Center 1175 แจ้งยกเลิกได้ค่ะ', sources: ['unsubscribeais'], evidence: ['โทร AIS Call Center 1175'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.equal(b.status, 'answered'); assert.ok(b.answer.includes('1175'));
});

await test('guardrail: blocks an invented phone number', async () => {
  const b = await ask({ answer: 'โทร 02-123-4567 เพื่อยกเลิกได้เลยค่ะ', sources: ['unsubscribeais'], evidence: ['โทร AIS Call Center 1175'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE), b.answer); assert.equal(b.status, 'not_in_faq'); assert.ok(b.handoff_issue);
  assert.deepEqual(b.sources, ['unsubscribeais'], 'still links the related FAQ');
});

await test('guardrail: blocks a link that is not in the FAQ', async () => {
  const b = await ask({ answer: 'แลกโค้ดได้ที่ oned-redeem.com ค่ะ', sources: ['Activateonetimecode'], evidence: ['แลกในแอปไม่ได้'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE), b.answer);
});

await test('guardrail: allows the real link redeem.oned.net', async () => {
  const b = await ask({ answer: 'แลกได้ที่ redeem.oned.net ค่ะ', sources: ['Activateonetimecode'], evidence: ['redeem.oned.net'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.equal(b.status, 'answered');
});

await test('guardrail: blocks a made-up "quote" from the FAQ', async () => {
  const b = await ask({ answer: 'ยกเลิกแล้วได้เงินคืนเต็มจำนวนค่ะ', sources: ['unsubscribe'], evidence: ['ยกเลิกแล้วได้เงินคืนเต็มจำนวน'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE), b.answer);
});

await test('guardrail: blocks an invented button name', async () => {
  const b = await ask({ answer: 'กดปุ่ม "ยกเลิกทันที" ในแอปได้เลยค่ะ', sources: ['unsubscribe'], evidence: ['การสมัครรับ'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE), b.answer);
});

await test('guardrail: blocks a real fact cited from the wrong FAQ entry', async () => {
  const b = await ask({ answer: 'โทร 1175 ได้ค่ะ', sources: ['Signin'], evidence: ['เข้าสู่ระบบ'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE), b.answer);
});

await test('guardrail: blocks an answer with no FAQ source or no evidence', async () => {
  let b = await ask({ answer: 'ได้ค่ะ', sources: [], evidence: ['เข้าสู่ระบบ'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE));
  b = await ask({ answer: 'ได้ค่ะ', sources: ['Signin'], evidence: [], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE));
});

await test('guardrail: "not in FAQ" replies use fixed wording (no slipped-in facts)', async () => {
  const b = await ask({ answer: 'ไม่มีใน FAQ ค่ะ แต่ลองโทร 02-999-9999 นะคะ', sources: [], evidence: [], status: 'not_in_faq', handoff_issue: null, suggestions: [] });
  assert.ok(!b.answer.includes('02-999'), b.answer); assert.ok(b.answer.includes('ยังไม่มีในคำถามที่พบบ่อย'));
  assert.equal(b.handoff_issue, 'อื่นๆ (โปรดระบุ)');
});

await test('guardrail: off-topic replies use fixed wording', async () => {
  const b = await ask({ answer: 'แนะนำละครเรื่อง X ค่ะ', sources: ['Signin'], evidence: [], status: 'out_of_scope', handoff_issue: null, suggestions: [] }, 'เรื่องไหนสนุก');
  assert.ok(b.answer.includes('เฉพาะเรื่องการใช้งาน oneD')); assert.deepEqual(b.sources, []);
});

await test('guardrail: English questions get English fixed wording', async () => {
  const b = await ask({ answer: 'Call 1-800-FAKE', sources: [], evidence: [], status: 'not_in_faq', handoff_issue: null, suggestions: [] }, 'how do I get a refund?');
  assert.ok(b.answer.startsWith("Sorry, this isn't covered in the FAQ"), b.answer);
});

await test('guardrail: second-pass check blocks a paraphrased invention', async () => {
  fakeVerdict = '{"supported": false, "unsupported": ["ยกเลิกได้ทุกเมื่อและได้เงินคืน"]}';
  const b = await ask({ answer: 'ยกเลิกได้ทุกเมื่อและได้เงินคืนค่ะ', sources: ['unsubscribe'], evidence: ['การสมัครรับ'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE), b.answer);
  assert.ok(lastVerifyBody.messages[0].content.includes('การสมัครรับ'), 'verifier sees the cited entry');
  assert.ok(!lastVerifyBody.messages[0].content.includes('redeem.oned.net'), 'verifier sees only cited entries');
});

await test('guardrail: if the second-pass check fails to run, the answer is blocked', async () => {
  fakeVerdict = 'ERROR';
  const b = await ask({ answer: 'ไปที่การสมัครรับค่ะ', sources: ['unsubscribe'], evidence: ['การสมัครรับ'], status: 'answered', handoff_issue: null, suggestions: [] });
  assert.ok(b.answer.startsWith(UNSURE), b.answer);
  fakeVerdict = '{"supported": true, "unsupported": []}';
});

await test('Claude API errors return 502 / 503 without leaking details', async () => {
  globalThis.fetch = async (url) => String(url).startsWith('https://assets') ? new Response(faqHtml) : new Response('overloaded', { status: 529 });
  const r = await handler(ev({ messages: [{ role: 'user', content: 'hi' }] }, { ip: '5.5.5.5' }));
  assert.equal(r.statusCode, 503);
  assert.ok(!r.body.includes('overloaded'));
});

for (const [s, n] of results) process.stdout.write(`${s}  ${n}\n`);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
