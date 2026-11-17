// น้องดี chat API — AWS Lambda (Node.js 22) behind API Gateway HTTP API.
//   POST /chat      { chatId?, messages: [{ role: "user"|"assistant", content }] }  -> reply JSON
//   POST /feedback  { chatId, turn, rating: "up"|"down" }                           -> 204
// The Anthropic API key never leaves this function.

import { randomUUID } from 'node:crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { loadFaq } from './faq.mjs';
import { RULES, ISSUES, STATUSES } from './prompt.mjs';

const MODEL = process.env.MODEL || 'claude-haiku-5-5';
const FAQ_URL = process.env.FAQ_URL || 'https://assets.oned.net/doc/faq-th-beta.html';
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
  if (status === 'answered' && !sources.length) status = 'partial';
  let handoff_issue = ISSUES.includes(v.handoff_issue) ? v.handoff_issue : null;
  if (status === 'not_in_faq' && !handoff_issue) handoff_issue = ISSUES[ISSUES.length - 1];
  const suggestions = (Array.isArray(v.suggestions) ? v.suggestions : []).filter((x) => typeof x === 'string' && x.length < 60).slice(0, 2);
  return { answer, sources, status, handoff_issue, suggestions };
}

function parseJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

async function askClaude(messages, faq) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': await apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      system: [
        { type: 'text', text: RULES },
        // The FAQ is the same on every call: cache it to cut cost and latency.
        { type: 'text', text: 'FAQ ENTRIES (Thai):\n' + JSON.stringify(faq), cache_control: { type: 'ephemeral' } },
      ],
      messages,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw Object.assign(new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`), { upstream: res.status });
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { parsed: parseJson(text), usage: data.usage, stop: data.stop_reason };
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
    const faq = await loadFaq(FAQ_URL);
    const ids = new Set(faq.map((f) => f.id));
    const { parsed, usage, stop } = await askClaude(messages, faq);
    const out = clean(parsed, ids);
    console.log(JSON.stringify({
      type: 'chat_turn', chatId, platform, model: MODEL, turn: messages.filter((m) => m.role === 'user').length,
      user: messages[messages.length - 1].content, answer: out.answer, status: out.status, sources: out.sources,
      handoff_issue: out.handoff_issue, parsed_ok: !!parsed, stop, latency_ms: Date.now() - started, usage,
    }));
    return reply(200, { chatId, ...out }, corsOrigin);
  } catch (err) {
    console.error(JSON.stringify({ type: 'chat_error', chatId, message: String(err?.message || err), upstream: err?.upstream, latency_ms: Date.now() - started }));
    const busy = err?.upstream === 429 || err?.upstream === 529;
    return reply(busy ? 503 : 502, { error: busy ? 'busy' : 'upstream_error', chatId }, corsOrigin);
  }
}
