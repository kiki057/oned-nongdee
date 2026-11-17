// Runs the Lambda handler on your machine with a fake Claude API, so you can check the plumbing
// without an API key:   node test/local-test.mjs
// To try the REAL Claude API locally instead, see README ("Test locally with a real key").
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.FAQ_URL = 'https://assets.oned.net/doc/faq-th-beta.html';
process.env.ALLOWED_ORIGINS = 'https://assets.oned.net';

const faqHtml = await readFile(new URL('../web/faq-th-beta.html', import.meta.url), 'utf8');
let lastClaudeBody = null;
let fakeReply = null;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://assets.oned.net/')) return new Response(faqHtml, { status: 200 });
  if (String(url) === 'https://api.anthropic.com/v1/messages') {
    lastClaudeBody = JSON.parse(opts.body);
    assert.equal(opts.headers['x-api-key'], 'test-key');
    assert.equal(opts.headers['anthropic-version'], '2023-06-01');
    return new Response(JSON.stringify({ content: [{ type: 'text', text: fakeReply }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }), { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
};
console.log = () => {}; console.warn = () => {}; console.error = () => {}; // keep test output clean

const { handler, normalise, clean } = await import('../src/handler.mjs');
const { parseFaq } = await import('../src/faq.mjs');
const ev = (body, extra = {}) => ({
  rawPath: extra.path || '/chat',
  requestContext: { http: { method: extra.method || 'POST', sourceIp: extra.ip || '1.2.3.4' } },
  headers: { origin: extra.origin ?? 'https://assets.oned.net', 'user-agent': 'test' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' — ' + e.message]); } };

await test('parses every FAQ question from the page', async () => {
  const faq = parseFaq(faqHtml);
  assert.ok(faq.length >= 20, 'only ' + faq.length);
  const code = faq.find((f) => f.id === 'Activateonetimecode');
  assert.ok(code && code.answer.includes('redeem.oned.net') && code.answer.includes('\n- '));
});

await test('answers, keeps only real FAQ ids, returns a chat id', async () => {
  fakeReply = 'Sure! {"answer":"แลกในแอปไม่ได้ค่ะ","sources":["Activateonetimecode","made-up-id"],"status":"answered","handoff_issue":null,"suggestions":["แลกโค้ดไม่สำเร็จ"]}';
  const r = await handler(ev({ messages: [{ role: 'user', content: 'แลกโค้ดในแอปได้ไหม' }] }));
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.deepEqual(b.sources, ['Activateonetimecode']);
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
  assert.ok(b.answer.includes('น้องดี'));
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

await test('Claude API errors return 502 / 503 without leaking details', async () => {
  globalThis.fetch = async (url) => String(url).startsWith('https://assets') ? new Response(faqHtml) : new Response('overloaded', { status: 529 });
  const r = await handler(ev({ messages: [{ role: 'user', content: 'hi' }] }, { ip: '5.5.5.5' }));
  assert.equal(r.statusCode, 503);
  assert.ok(!r.body.includes('overloaded'));
});

for (const [s, n] of results) process.stdout.write(`${s}  ${n}\n`);
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
