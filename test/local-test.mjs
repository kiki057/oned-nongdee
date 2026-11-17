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
  assert.equal(new Set(faq.map((f) => f.id)).size, faq.length, 'no duplicate ids (English template skipped)');
  assert.ok(/[\u0E00-\u0E7F]/.test(faq[0].question), 'Thai questions');
  const code = faq.find((f) => f.id === 'Activateonetimecode');
  assert.ok(code && code.answer.includes('redeem.oned.net') && code.answer.includes('\n- '));
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
const UNSURE = 'ขออภัยค่ะ น้องดีไม่แน่ใจคำตอบนี้';
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
