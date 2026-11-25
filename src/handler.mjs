// น้องดี chat API — AWS Lambda (Node.js 22) behind API Gateway HTTP API.
//   POST /chat      { chatId?, messages: [{ role: "user"|"assistant", content }] }  -> reply JSON
//   POST /feedback  { chatId, turn, rating: "up"|"down" }                           -> 204
//   GET  /faq?lang=th|en                                                            -> the FAQ (see openapi.yaml)
// The Anthropic API key never leaves this function.

import { randomUUID } from 'node:crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { loadFaq, faqDocument } from './faq.mjs';
import { RULES, VERIFY_RULES, ISSUES, STATUSES } from './prompt.mjs';
import { ground, unsure, lang } from './grounding.mjs';

const MODEL = process.env.MODEL || 'claude-haiku-5-5';
const VERIFY = (process.env.VERIFY || 'on') === 'on';
const VERIFY_MODEL = process.env.VERIFY_MODEL || 'claude-haiku-5-5';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_TURNS = 10;
const MAX_CHARS = 1000;
const RATE = { max: 20, windowMs: 10 * 60 * 1000 }; // per IP, per warm Lambda instance (API Gateway throttling is the real limit)

// ---------- API key from Secrets Manager (or ANTHROPIC_API_KEY for local testing) ----------
let keyPromise = null;
function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return Promise.resolve(process.env.ANTHROPIC_API_KEY);
  if (!keyPromise) {
    keyPromise = new SecretsManagerClient({})
      .send(new GetSecretValueCommand({ SecretId: process.env.ANTHROPIC_SECRET_ARN }))
      .then(({ SecretString }) => {
        const s = (SecretString || '').trim();
        try { const j = JSON.parse(s); return j.ANTHROPIC_API_KEY || j.apiKey || s; } catch { return s; }
      })
      .catch((e) => { keyPromise = null; throw e; });
  }
  return keyPromise;
}

// ---------- Helpers ----------
export function mask(s) {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[อีเมล]')
    .replace(/\b(?:\d[ -]?){12,19}\b/g, '[ตัวเลข]')
    .replace(/(?:\+?66|0)[\s-]?\d(?:[\s-]?\d){7,8}\b/g, '[เบอร์โทร]');
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE.max;
}

function reply(status, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) { headers['access-control-allow-origin'] = origin; headers.vary = 'Origin'; }
  return { statusCode: status, headers, body: body == null ? '' : JSON.stringify(body) };
}

// Messages must start with the user and alternate; keep the last MAX_TURNS.
export function normalise(messages) {
  if (!Array.isArray(messages)) return null;
  const out = [];
  for (const m of messages.slice(-MAX_TURNS * 2)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    const content = (m.role === 'user' ? mask(m.content) : m.content).trim().slice(0, MAX_CHARS);
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n' + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  const trimmed = out.slice(-MAX_TURNS);
  while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();
  if (!trimmed.length || trimmed[trimmed.length - 1].role !== 'user') return null;
  return trimmed;
}

// Check the model's reply: only real FAQ ids, only known statuses and support-form issues.
export function clean(v, faqIds) {
  v = v && typeof v === 'object' ? v : {};
  let status = STATUSES.includes(v.status) ? v.status : 'not_in_faq';
  const sources = (Array.isArray(v.sources) ? v.sources : []).filter((id) => faqIds.has(id)).slice(0, 3);
  const answer = typeof v.answer === 'string' && v.answer.trim() ? v.answer.trim().slice(0, 1200) : 'ขออภัยค่ะ ตอนนี้น้องดียังตอบคำถามนี้ไม่ได้';
  let handoff_issue = ISSUES.includes(v.handoff_issue) ? v.handoff_issue : null;
  if (status === 'not_in_faq' && !handoff_issue) handoff_issue = ISSUES[ISSUES.length - 1];
  const suggestions = (Array.isArray(v.suggestions) ? v.suggestions : []).filter((x) => typeof x === 'string' && x.length < 60).slice(0, 2);
  const evidence = (Array.isArray(v.evidence) ? v.evidence : []).filter((x) => typeof x === 'string').slice(0, 5);
  return { answer, sources, status, handoff_issue, suggestions, evidence };
}

function parseJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

async function callClaude(model, system, messages, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': await apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw Object.assign(new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`), { upstream: res.status });
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { parsed: parseJson(text), usage: data.usage, stop: data.stop_reason };
}

function askClaude(messages, faq) {
  return callClaude(MODEL, [
    { type: 'text', text: RULES },
    // The FAQ is the same on every call: cache it to cut cost and latency.
    { type: 'text', text: 'FAQ ENTRIES (Thai):\n' + JSON.stringify(faq), cache_control: { type: 'ephemeral' } },
  ], messages, 900);
}

// Second opinion: does the answer say anything the cited FAQ entries don't? Fails closed.
async function verify(answer, cited) {
  try {
    const { parsed } = await callClaude(VERIFY_MODEL, VERIFY_RULES, [{
      role: 'user',
      content: 'FAQ ENTRIES:\n' + JSON.stringify(cited) + '\n\nANSWER:\n' + answer,
    }], 300);
    if (parsed && typeof parsed.supported === 'boolean') return { ok: parsed.supported, unsupported: Array.isArray(parsed.unsupported) ? parsed.unsupported.slice(0, 5) : [] };
    return { ok: false, unsupported: ['verifier_unreadable'] };
  } catch (e) {
    return { ok: false, unsupported: ['verifier_error: ' + String(e.message || e).slice(0, 80)] };
  }
}

// ---------- GET /faq ----------
// Public, read-only and the same for everyone: no Origin needed (the apps don't send one), cacheable, ETag for 304s.
function getFaq(method, event, headers, corsOrigin) {
  if (method !== 'GET' && method !== 'HEAD') return reply(405, { error: 'method_not_allowed' }, corsOrigin);
  const lang = event.queryStringParameters?.lang || 'th';
  const doc = faqDocument(lang);
  if (!doc) return reply(400, { error: 'bad_lang' }, corsOrigin);
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', etag: doc.etag, 'content-language': lang };
  if (corsOrigin) { h['access-control-allow-origin'] = corsOrigin; h.vary = 'Origin'; }
  const match = (headers['if-none-match'] || '').split(',').map((s) => s.trim().replace(/^W\//, ''));
  if (match.includes(doc.etag)) return { statusCode: 304, headers: h, body: '' };
  return { statusCode: 200, headers: h, body: method === 'HEAD' ? '' : doc.json };
}

// ---------- Handler ----------
export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'POST';
  const path = event.rawPath || event.path || '/chat';
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const origin = headers.origin || '';
  const allowed = !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin);
  const corsOrigin = allowed && origin ? origin : '';

  if (method === 'OPTIONS') return reply(204, null, corsOrigin);
  if (path.endsWith('/faq')) return getFaq(method, event, headers, corsOrigin);
  if (method !== 'POST') return reply(405, { error: 'method_not_allowed' }, corsOrigin);
  if (!allowed) return reply(403, { error: 'origin_not_allowed' });

  let body;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '{}';
    if (raw.length > 30000) return reply(413, { error: 'too_large' }, corsOrigin);
    body = JSON.parse(raw);
  } catch { return reply(400, { error: 'bad_json' }, corsOrigin); }

  const ip = event.requestContext?.http?.sourceIp || headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const platform = /oneD/i.test(headers['user-agent'] || '') ? 'app' : 'web';

  // Thumbs up / down
  if (path.endsWith('/feedback')) {
    const rating = body.rating === 'up' || body.rating === 'down' ? body.rating : null;
    if (!rating || typeof body.chatId !== 'string') return reply(400, { error: 'bad_feedback' }, corsOrigin);
    console.log(JSON.stringify({ type: 'feedback', chatId: body.chatId.slice(0, 64), turn: Number(body.turn) || 0, rating, platform }));
    return reply(204, null, corsOrigin);
  }

  if (rateLimited(ip)) return reply(429, { error: 'rate_limited' }, corsOrigin);
  const messages = normalise(body.messages);
  if (!messages) return reply(400, { error: 'bad_messages' }, corsOrigin);
  const chatId = typeof body.chatId === 'string' && /^c_[a-z0-9]{8,32}$/.test(body.chatId) ? body.chatId : 'c_' + randomUUID().replace(/-/g, '').slice(0, 16);

  const started = Date.now();
  try {
    const faq = await loadFaq();
    const byId = Object.fromEntries(faq.map((f) => [f.id, f]));
    const ids = new Set(Object.keys(byId));
    const userText = messages[messages.length - 1].content;
    const { parsed, usage, stop } = await askClaude(messages, faq);
    const modelReply = clean(parsed, ids);

    // FAQ-only guardrail (grounding.mjs), then the optional second opinion
    let { reply: out, check } = ground(modelReply, byId, userText, ISSUES[ISSUES.length - 1]);
    if (check.ok && VERIFY && (out.status === 'answered' || out.status === 'partial')) {
      const v = await verify(out.answer, out.sources.map((id) => byId[id]));
      if (!v.ok) {
        check = { ok: false, reasons: v.unsupported.map((u) => 'verifier: ' + u) };
        out = unsure(out, lang(userText), ISSUES[ISSUES.length - 1]);
      }
    }

    console.log(JSON.stringify({
      type: 'chat_turn', chatId, platform, model: MODEL, turn: messages.filter((m) => m.role === 'user').length,
      user: userText, answer: out.answer, status: out.status, sources: out.sources, handoff_issue: out.handoff_issue,
      guardrail: check.ok ? (check.fixed ? 'fixed_text' : 'pass') : 'blocked', blocked_reasons: check.reasons,
      blocked_answer: check.ok ? undefined : modelReply.answer, verify: VERIFY,
      parsed_ok: !!parsed, stop, latency_ms: Date.now() - started, usage,
    }));
    return reply(200, { chatId, ...out }, corsOrigin);
  } catch (err) {
    console.error(JSON.stringify({ type: 'chat_error', chatId, message: String(err?.message || err), upstream: err?.upstream, latency_ms: Date.now() - started }));
    const busy = err?.upstream === 429 || err?.upstream === 529;
    return reply(busy ? 503 : 502, { error: busy ? 'busy' : 'upstream_error', chatId }, corsOrigin);
  }
}
