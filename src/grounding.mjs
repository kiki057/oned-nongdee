// FAQ-only guardrail. Runs on every reply AFTER the model answers, so a reply that isn't backed by the FAQ
// never reaches the user, whatever the model wrote.
//
//   1. An answer must cite at least one real FAQ entry.
//   2. Its "evidence" quotes must appear word for word in the cited entries.
//   3. Every link, number (2+ digits) and "quoted" button name in the answer must appear in the cited entries.
//   4. "Not in FAQ" and "off-topic" replies use fixed wording, so the model can't slip facts into them.
//   5. (Optional, in handler.mjs) a second Claude call checks the answer against the cited entries.
// A reply that fails 1–3 or 5 is replaced by a safe "not sure" reply with links to the related FAQ entries
// and the handoff button.

export const FIXED = {
  th: {
    not_in_faq: 'ขออภัยค่ะ เรื่องนี้ยังไม่มีในคำถามที่พบบ่อย น้องวันดีจึงตอบให้ไม่ได้ ให้ทีมงานช่วยต่อได้นะคะ',
    out_of_scope: 'น้องวันดีช่วยได้เฉพาะเรื่องการใช้งาน oneD นะคะ มีเรื่องไหนเกี่ยวกับ oneD ให้ช่วยไหมคะ?',
    unsure: 'ขออภัยค่ะ น้องวันดีไม่แน่ใจคำตอบนี้ ลองดูหัวข้อที่เกี่ยวข้องด้านล่าง หรือให้ทีมงานช่วยต่อได้นะคะ',
  },
  en: {
    not_in_faq: "Sorry, this isn't covered in the FAQ, so I can't answer it. Our support team can help you.",
    out_of_scope: 'I can only help with using oneD. Is there anything about oneD I can help with?',
    unsure: "Sorry, I'm not sure about this one. Have a look at the related FAQ topics below, or ask our support team.",
  },
};

export function lang(text) {
  return /[฀-๿]/.test(text || '') ? 'th' : 'en';
}

// Compare text ignoring spaces, punctuation, quotes and case (Thai has no word breaks, so match on characters).
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s"'“”‘’`.,:;!?()[\]{}›»«•·…\-–—_/\\|*#]+/g, '');
}

// Facts in the answer that must come from the FAQ: links, numbers with 2+ digits, and "quoted" names.
export function facts(answer) {
  const text = String(answer || '').replace(/^\s*\d{1,2}[.)]\s/gm, ' '); // ignore step numbers "1. "
  const links = text.match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi) || [];
  const numbers = (text.match(/\d[\d.,:]*\d|\d{2,}/g) || []).map((n) => n.replace(/[.,:]+$/, ''));
  const quoted = [];
  const re = /["“”]([^"“”\n]{2,60})["“”]/g;
  let m;
  while ((m = re.exec(text))) quoted.push(m[1].trim());
  return { links, numbers, quoted };
}

// reply: { answer, sources, status, handoff_issue, suggestions, evidence } — sources already limited to real ids.
// faqById: { id: { question, answer } }. userText: the user's last message (for the language).
export function ground(reply, faqById, userText, otherIssue) {
  const L = lang(userText);
  const out = { ...reply };
  delete out.evidence;

  if (out.status === 'out_of_scope') {
    return { reply: { ...out, answer: FIXED[L].out_of_scope, sources: [], handoff_issue: null }, check: { ok: true, fixed: 'out_of_scope' } };
  }
  if (out.status === 'not_in_faq') {
    return { reply: { ...out, answer: FIXED[L].not_in_faq, handoff_issue: out.handoff_issue || otherIssue }, check: { ok: true, fixed: 'not_in_faq' } };
  }

  // answered / partial
  const reasons = [];
  if (!out.sources.length) reasons.push('no_source');
  const cited = norm(out.sources.map((id) => `${faqById[id].question} ${faqById[id].answer}`).join(' '));

  const evidence = (Array.isArray(reply.evidence) ? reply.evidence : [])
    .filter((e) => typeof e === 'string' && norm(e).length >= 4)
    .slice(0, 5);
  for (const e of evidence) if (!cited.includes(norm(e))) reasons.push(`quote_not_in_faq: ${e.slice(0, 60)}`);
  if (out.status === 'answered' && !evidence.length) reasons.push('no_evidence');

  const f = facts(out.answer);
  for (const x of f.links) if (!cited.includes(norm(x.replace(/^https?:\/\//i, '')))) reasons.push(`link_not_in_faq: ${x}`);
  for (const x of f.numbers) if (!cited.includes(norm(x))) reasons.push(`number_not_in_faq: ${x}`);
  for (const x of f.quoted) if (!cited.includes(norm(x))) reasons.push(`name_not_in_faq: ${x}`);

  if (!reasons.length) return { reply: out, check: { ok: true } };
  return { reply: unsure(out, L, otherIssue), check: { ok: false, reasons } };
}

export function unsure(reply, L, otherIssue) {
  return {
    ...reply,
    answer: FIXED[L].unsure,
    status: 'not_in_faq',
    handoff_issue: reply.handoff_issue || otherIssue,
    suggestions: [],
  };
}
