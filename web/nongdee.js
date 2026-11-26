/*!
 * น้องดี — oneD FAQ assistant widget (production)
 * Include on the FAQ page, after its content:
 *   <script src="nongdee.js" data-endpoint="https://xxxx.execute-api.ap-southeast-1.amazonaws.com" defer></script>
 * Optional: data-support-url="https://support.oned.net/"
 * Demo (no AI, no server): data-endpoint="demo" picks the closest FAQ answer by text matching.
 * Reads FAQ titles from the page (<details class="q" id="...">) to label answer sources.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var ENDPOINT = ((script && script.dataset.endpoint) || '').replace(/\/+$/, '');
  var SUPPORT_URL = (script && script.dataset.supportUrl) || 'https://support.oned.net/';
  if (!ENDPOINT || /YOUR-API/i.test(ENDPOINT)) { console.warn('[nongdee] data-endpoint is not set; assistant hidden'); return; }
  var DEMO = ENDPOINT === 'demo';

  var OTHER = 'อื่นๆ (โปรดระบุ)';
  // Interface text follows the page language (<html lang>, e.g. the FAQ's TH | EN switch).
  // Replies follow the language the user writes in.
  var I18N = {
    th: {
      fab: 'ถามน้องดี', title: 'น้องดี', sub: 'ผู้ช่วย oneD · ตอบจากคำถามที่พบบ่อย',
      hello: 'สวัสดีค่ะ น้องดีเองค่ะ ถามเรื่องการใช้งาน oneD ได้เลยนะคะ เช่น สมัคร PREMIUM แลกโค้ด ดูบนทีวี หรือยกเลิกแพ็กเกจ',
      suggest: ['แลกโค้ดในแอปได้ไหม', 'ยกเลิก PREMIUM ยังไง', 'จ่ายเงินแล้วแต่ยังเห็นโฆษณา', 'ดูบนทีวี Samsung ได้ไหม'],
      placeholder: 'พิมพ์คำถามถึงน้องดี...', note: 'ห้ามพิมพ์รหัสผ่าน OTP หรือเลขบัตร · บทสนทนาถูกบันทึกเพื่อปรับปรุงบริการ',
      contact: 'ติดต่อทีมงาน', handoff: 'ให้ทีมงานช่วยต่อได้นะคะ น้องดีเลือกหัวข้อในแบบฟอร์มไว้ให้แล้วค่ะ',
      handoffBtn: 'ส่งเรื่องให้ทีมงาน', sorry: 'ขออภัยที่ยังช่วยไม่ได้นะคะ ให้ทีมงานช่วยต่อไหมคะ?',
      busy: 'ตอนนี้มีคนถามเยอะอยู่ ลองใหม่อีกสักครู่นะคะ', error: 'ขออภัยค่ะ ตอนนี้น้องดีตอบไม่ได้',
      offline: 'ดูเหมือนอินเทอร์เน็ตจะหลุดอยู่นะคะ ลองใหม่อีกครั้งค่ะ', askInstead: 'ถามน้องดีแทน',
      close: 'ปิด', send: 'ส่ง', up: 'มีประโยชน์', down: 'ไม่มีประโยชน์',
      demoSub: 'โหมดสาธิต · ค้นจาก FAQ ยังไม่ใช่ AI',
      demoNote: 'โหมดสาธิต: ข้อความไม่ถูกส่งหรือบันทึกที่ไหน · ห้ามพิมพ์รหัสผ่าน OTP หรือเลขบัตร',
      demoHello: 'สวัสดีค่ะ น้องดีเองค่ะ ตอนนี้เป็นโหมดสาธิต น้องดีจะค้นคำตอบที่ใกล้ที่สุดจาก FAQ ให้นะคะ (เวอร์ชัน AI จะตอบได้เป็นธรรมชาติกว่านี้ค่ะ)',
      related: 'หรือคุณหมายถึงเรื่องนี้คะ',
      dFound: 'น้องดีเจอคำตอบนี้ใน FAQ ค่ะ', dNone: 'ขออภัยค่ะ น้องดียังหาคำตอบเรื่องนี้ใน FAQ ไม่เจอ ลองถามด้วยคำอื่น หรือให้ทีมงานช่วยต่อได้นะคะ',
      dRefund: 'เรื่องคืนเงิน น้องดีช่วยเองไม่ได้ค่ะ ถ้าสมัครผ่าน App Store หรือ Google Play การคืนเงินเป็นของ Apple หรือ Google นะคะ ให้ทีมงานช่วยดูให้ได้ค่ะ',
      dCancel: 'คุณสมัครผ่านช่องทางไหนคะ? กดหัวข้อด้านล่างเพื่อดูวิธียกเลิกได้เลยค่ะ',
      dPrivate: 'ไม่ต้องพิมพ์ข้อมูลส่วนตัวในแชตนะคะ น้องดีซ่อนไว้ให้แล้วค่ะ ถามต่อได้เลยนะคะ'
    },
    en: {
      fab: 'Ask Nong Dee', title: 'Nong Dee', sub: 'oneD assistant · answers from the FAQ',
      hello: "Hi, I'm Nong Dee! Ask me anything about using oneD, like subscribing to PREMIUM, redeeming a code, watching on TV or cancelling a package.",
      suggest: ['Can I redeem a code in the app?', 'How do I cancel PREMIUM?', "I paid but still see ads", 'Can I watch on a Samsung TV?'],
      placeholder: 'Ask Nong Dee a question...', note: "Don't type passwords, OTPs or card numbers · Chats are recorded to improve the service",
      contact: 'Contact us', handoff: "Our support team can take it from here. I've picked the topic in the form for you.",
      handoffBtn: 'Contact support', sorry: "Sorry I couldn't help. Would you like our support team to help?",
      busy: "Lots of people are asking right now. Please try again in a moment.", error: "Sorry, I can't answer right now.",
      offline: 'You seem to be offline. Please try again.', askInstead: 'Ask Nong Dee instead',
      close: 'Close', send: 'Send', up: 'Helpful', down: 'Not helpful',
      demoSub: 'Demo mode · searches the FAQ, not AI yet',
      demoNote: "Demo mode: nothing you type is sent or saved · Don't type passwords, OTPs or card numbers",
      demoHello: "Hi, I'm Nong Dee! This is a demo: I'll find the closest answer in the FAQ for you. (The AI version answers more naturally.)",
      related: 'Or did you mean:',
      dFound: "Here's what the FAQ says:", dNone: "Sorry, I couldn't find this in the FAQ. Try asking another way, or our support team can help.",
      dRefund: "I can't handle refunds myself. If you subscribed through the App Store or Google Play, refunds are handled by Apple or Google. Our support team can look into it for you.",
      dCancel: 'How did you subscribe? Tap your option below to see how to cancel.',
      dPrivate: "No need to share personal details in the chat. I've hidden them for you. Feel free to keep asking."
    }
  };
  function uiLang() { return /^en/i.test(document.documentElement.lang || '') ? 'en' : 'th'; }
  function textLang(s) { return /[\u0E00-\u0E7F]/.test(s || '') ? 'th' : 'en'; }
  var OTHER = 'อื่นๆ (โปรดระบุ)';

  // ---------- Styles (uses the FAQ page's colours, with fallbacks) ----------
  var css = [
    '.nd-fab{position:fixed;z-index:30;right:16px;bottom:16px;display:inline-flex;align-items:center;gap:8px;height:50px;padding:0 18px 0 14px;border:0;border-radius:99px;cursor:pointer;background:var(--pink,#f20b7e);color:#fff;font:inherit;font-size:15px;font-weight:500;box-shadow:0 8px 24px rgba(242,11,126,.35)}',
    '.nd-open .nd-fab{display:none}',
    '.nd-sheet{position:fixed;z-index:40;inset:0;display:none;flex-direction:column;background:var(--bg,#0a0a0c);color:var(--text,#f4f4f6)}',
    '.nd-open .nd-sheet{display:flex}',
    '@media(min-width:720px){.nd-sheet{left:auto;width:400px;border-left:1px solid var(--line,#26262e);box-shadow:-12px 0 40px rgba(0,0,0,.5)}}',
    '.nd-head{flex:none;display:flex;align-items:center;gap:10px;padding:10px 8px 10px 16px;border-bottom:1px solid var(--line,#26262e)}',
    '.nd-avatar{width:34px;height:34px;border-radius:50%;background:var(--pink-soft,rgba(242,11,126,.14));border:1px solid var(--pink,#f20b7e);display:grid;place-items:center;color:var(--pink,#f20b7e);flex:none}',
    '.nd-title{flex:1;line-height:1.3}.nd-title b{display:block;font-size:15px;font-weight:500}.nd-title span{font-size:12.5px;color:var(--text-3,#80808c)}',
    '.nd-x{width:44px;height:44px;border:0;background:none;color:var(--text-2,#b9b9c3);font-size:26px;cursor:pointer}',
    '.nd-log{flex:1;overflow-y:auto;padding:16px 14px 8px;-webkit-overflow-scrolling:touch}',
    '.nd-msg{display:flex;margin-bottom:12px}.nd-me{justify-content:flex-end}',
    '.nd-wrap{max-width:86%}',
    '.nd-bubble{padding:10px 13px;border-radius:16px;font-size:15px;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
    '.nd-me .nd-bubble{max-width:86%;background:var(--pink,#f20b7e);color:#fff;border-bottom-right-radius:4px}',
    '.nd-bot .nd-bubble{background:var(--surface,#16161a);border:1px solid var(--line,#26262e);border-bottom-left-radius:4px}',
    '.nd-srcs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
    '.nd-rel{margin-top:10px;font-size:13px;color:var(--text-2,#b9b9c3)}',
    '.nd-src{display:inline-flex;align-items:center;gap:4px;max-width:100%;font:inherit;font-size:13px;padding:5px 10px;border-radius:99px;border:1px solid var(--line,#26262e);background:var(--surface-2,#202027);color:var(--text-2,#b9b9c3);cursor:pointer;text-align:left}',
    '.nd-src:before{content:"FAQ";font-size:10.5px;font-weight:500;color:var(--pink,#f20b7e)}',
    '.nd-rate{display:flex;gap:4px;margin-top:6px}.nd-rate button{width:34px;height:30px;border-radius:8px;border:1px solid transparent;background:none;color:var(--text-3,#80808c);cursor:pointer;font-size:15px}',
    '.nd-rate button[aria-pressed=true]{border-color:var(--line,#26262e);background:var(--surface-2,#202027)}',
    '.nd-handoff{margin-top:10px;padding:12px;border-radius:12px;background:var(--pink-soft,rgba(242,11,126,.14));border:1px solid rgba(242,11,126,.4);font-size:14px}',
    '.nd-handoff a{display:inline-flex;align-items:center;height:38px;margin-top:8px;padding:0 14px;border-radius:99px;background:var(--pink,#f20b7e);color:#fff;font-size:14px;text-decoration:none}',
    '.nd-chips{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 14px}',
    '.nd-chips button{font:inherit;font-size:14px;color:var(--text,#f4f4f6);background:var(--surface,#16161a);border:1px solid var(--line,#26262e);border-radius:99px;min-height:38px;padding:4px 14px;cursor:pointer;text-align:left}',
    '.nd-typing span{display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%;background:var(--text-3,#80808c);animation:nd-blink 1.2s infinite}',
    '.nd-typing span:nth-child(2){animation-delay:.2s}.nd-typing span:nth-child(3){animation-delay:.4s}',
    '@keyframes nd-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}',
    '.nd-foot{flex:none;border-top:1px solid var(--line,#26262e);padding:10px 12px 12px}',
    '.nd-form{display:flex;align-items:flex-end;gap:8px}',
    '.nd-form textarea{flex:1;min-height:46px;max-height:120px;resize:none;font:inherit;font-size:16px;line-height:1.45;color:var(--text,#f4f4f6);background:var(--surface,#16161a);border:1px solid var(--line,#26262e);border-radius:14px;padding:11px 14px;outline:none}',
    '.nd-form textarea:focus{border-color:var(--pink,#f20b7e)}',
    '.nd-send{flex:none;width:46px;height:46px;border-radius:50%;border:0;background:var(--pink,#f20b7e);color:#fff;cursor:pointer;display:grid;place-items:center}.nd-send:disabled{opacity:.45}',
    '.nd-note{margin:8px 2px 0;font-size:12px;color:var(--text-3,#80808c);line-height:1.5}.nd-note a{color:var(--pink,#f20b7e);text-decoration:none}',
    '.nd-ask-empty{display:inline-block;margin:12px auto 0;height:42px;padding:0 18px;border-radius:99px;border:1px solid var(--pink,#f20b7e);background:var(--pink-soft,rgba(242,11,126,.14));color:#fff;font:inherit;font-size:15px;cursor:pointer}',
    'body.nd-ready .page{padding-bottom:90px}'
  ].join('\n');

  var ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg>';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function init() {
    var style = el('style'); style.textContent = css; document.head.appendChild(style);

    var fab = el('button', 'nd-fab'); fab.type = 'button';
    fab.innerHTML = ICON + '<span class="nd-fab-text"></span>';

    var sheet = el('div', 'nd-sheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML =
      '<div class="nd-head"><div class="nd-avatar">' + ICON + '</div>' +
      '<div class="nd-title"><b class="nd-name"></b><span class="nd-sub"></span></div>' +
      '<button class="nd-x" type="button">×</button></div>' +
      '<div class="nd-log" aria-live="polite"></div>' +
      '<div class="nd-foot"><form class="nd-form">' +
      '<textarea rows="1" enterkeyhint="send"></textarea>' +
      '<button class="nd-send" type="submit" disabled><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
      '</form><p class="nd-note"><span class="nd-note-text"></span> · <a class="nd-contact"></a></p></div>';

    document.body.appendChild(fab); document.body.appendChild(sheet); document.body.classList.add('nd-ready');

    var root = document.documentElement;
    var log = sheet.querySelector('.nd-log');
    var input = sheet.querySelector('textarea');
    var send = sheet.querySelector('.nd-send');
    var form = sheet.querySelector('form');
    var history = [], chatId = null, busy = false, started = false, turn = 0;
    var T = I18N.th, convLang = 'th'; // T: interface text; convLang: language of the user's last message
    try { chatId = sessionStorage.getItem('nd-chat') || null; } catch (e) {}

    // Titles shown on source chips: whatever language the page shows right now
    function title(id) {
      var q = document.getElementById(id), s = q && q.querySelector('summary span');
      return s ? s.textContent.trim() : '';
    }

    // ---------- Demo mode: closest FAQ entry by character-bigram overlap (works for Thai without word breaks) ----------
    // Reads every FAQ question on the page, including both languages of a TH | EN page (kept in <template>s).
    function entriesIn(rootNode) {
      return [].map.call(rootNode.querySelectorAll('details.q[id]'), function (q) {
        var a = q.querySelector('.a'), c = a ? a.cloneNode(true) : document.createElement('div');
        [].forEach.call(c.querySelectorAll('li'), function (li) { li.insertBefore(document.createTextNode('\n• '), li.firstChild); });
        [].forEach.call(c.querySelectorAll('p, h4, br'), function (x) { x.parentNode.insertBefore(document.createTextNode('\n'), x); });
        [].forEach.call(c.querySelectorAll('img[alt]'), function (i) { i.replaceWith(document.createTextNode(i.alt)); });
        var answer = c.textContent.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
        var s = q.querySelector('summary span'), qt = s ? s.textContent.trim() : '';
        return { id: q.id, cat: q.dataset.cat, q: qt, a: answer, lang: textLang(qt + answer.slice(0, 40)) };
      });
    }
    var FAQ = [], seenKey = {};
    [].forEach.call(document.querySelectorAll('template'), function (t) { FAQ = FAQ.concat(entriesIn(t.content)); });
    FAQ = FAQ.concat(entriesIn(document));
    FAQ = FAQ.filter(function (f) { var k = f.id + '|' + f.q; if (seenKey[k]) return false; seenKey[k] = 1; return true; });
    function grams(s) {
      s = s.toLowerCase().replace(/[^\u0E00-\u0E7Fa-z0-9]+/g, '');
      var g = {}; for (var i = 0; i < s.length - 1; i++) g[s.substr(i, 2)] = 1; return g;
    }
    FAQ.forEach(function (f) { f.gq = grams(f.q); f.ga = grams(f.a); });
    // Bigrams found in many entries (e.g. from "PREMIUM") count for less
    var df = {};
    FAQ.forEach(function (f) { var k, seen = {}; for (k in f.gq) seen[k] = 1; for (k in f.ga) seen[k] = 1; for (k in seen) df[k] = (df[k] || 0) + 1; });
    function w(k) { return Math.log((FAQ.length + 1) / ((df[k] || 0) + 1)) + 0.2; }
    function overlap(qg, g) { var n = 0, k; for (k in qg) if (g[k]) n += w(k); return n; }
    var ISSUE_BY_ID = { signinissue: 'เข้าสู่ระบบไม่ได้', Signin: 'เข้าสู่ระบบไม่ได้', technicalissue: 'ดูวิดีโอไม่ได้',
      subscription: 'ไม่สามารถสมัครสมาชิกพรีเมียมได้', premiumnotreceived: 'สมัครสมาชิกพรีเมียมแล้ว แต่ไม่ขึ้นสถานะพรีเมียม',
      ChromecastAirplay: 'สมัครสมาชิกพรีเมียมแล้ว แต่ cast ขึ้น TV ไม่ได้', unsubscribeais: 'แพ็กเกจ AIS',
      codefailed: 'สมาชิก oneD PREMIUM แบบเติมวัน', Activateonetimecode: 'สมาชิก oneD PREMIUM แบบเติมวัน' };
    function demoChat(text) {
      var qg = grams(text), size = 0, k;
      for (k in qg) size += w(k);
      size = size || 1;
      var ranked = FAQ.map(function (f) {
        return { f: f, s: (2 * overlap(qg, f.gq) + overlap(qg, f.ga)) / size };
      }).sort(function (x, y) { return y.s - x.s; });
      var best = ranked[0];
      var r, D = I18N[textLang(text)];
      var lower = text.toLowerCase();
      if (/[\[](อีเมล|เบอร์โทร|ตัวเลข)[\]]/.test(text)) {
        r = { answer: D.dPrivate, sources: [], status: 'partial', handoff_issue: null, suggestions: [] };
      } else if (/คืนเงิน|เงินคืน|refund/.test(lower)) {
        r = { answer: D.dRefund, sources: [], status: 'not_in_faq', handoff_issue: OTHER, suggestions: [] };
      } else if (/ยกเลิก|cancel|unsubscribe/.test(lower) && !/เติมวัน|โค้ด|code/.test(lower)) {
        r = { answer: D.dCancel, sources: ['unsubscribe', 'unsubscribeandroid', 'unsubscribeais'],
              status: 'partial', handoff_issue: null, suggestions: [] };
      } else if (!best || best.s < 0.85) {
        var near = [];
        ranked.forEach(function (x) { if (near.length < 2 && x.s >= 0.3 && near.indexOf(x.f.id) < 0) near.push(x.f.id); });
        r = { answer: D.dNone, sources: [], related: near, status: 'not_in_faq',
              handoff_issue: OTHER, suggestions: [] };
      } else {
        var want = textLang(text), same = FAQ.filter(function (f) { return f.id === best.f.id && f.lang === want; })[0] || best.f;
        var lines = same.a.split('\n'), body = lines.slice(0, 7).join('\n') + (lines.length > 7 ? '\n…' : '');
        var more = [], ids = {}; ids[best.f.id] = 1;
        ranked.slice(1).forEach(function (x) { if (more.length < 2 && x.s >= 0.85 && !ids[x.f.id]) { ids[x.f.id] = 1; more.push(title(x.f.id) || x.f.q); } });
        r = { answer: D.dFound + '\n\n' + body, sources: [best.f.id], status: 'answered', handoff_issue: null, suggestions: more };
        r.demoIssue = ISSUE_BY_ID[best.f.id] || OTHER;
      }
      r.chatId = 'c_demo';
      return new Promise(function (res) { setTimeout(function () { res({ status: 200, data: r }); }, 500); });
    }

    function mask(s) {
      return s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[อีเมล]')
              .replace(/\b(?:\d[ -]?){12,19}\b/g, '[ตัวเลข]')
              .replace(/(?:\+?66|0)[\s-]?\d(?:[\s-]?\d){7,8}\b/g, '[เบอร์โทร]');
    }
    function down() { log.scrollTop = log.scrollHeight; }
    function supportLink(issue) {
      var u = SUPPORT_URL + (SUPPORT_URL.indexOf('?') > -1 ? '&' : '?') + 'issue=' + encodeURIComponent(issue || OTHER);
      if (uiLang() === 'en' && !/[?&]lang=/.test(u)) u += '&lang=en';
      return chatId ? u + '&chat=' + encodeURIComponent(chatId) : u;
    }
    function handoffCard(issue, text) {
      var C = I18N[convLang];
      var h = el('div', 'nd-handoff'); h.appendChild(el('div', null, text || C.handoff));
      var a = el('a', null, C.handoffBtn); a.href = supportLink(issue); h.appendChild(a); return h;
    }
    function chipsRow(list) {
      var row = el('div', 'nd-chips');
      list.forEach(function (q) { var b = el('button', null, q); b.type = 'button'; b.onclick = function () { ask(q); }; row.appendChild(b); });
      return row;
    }
    function feedback(n, rating) {
      if (!chatId || DEMO) return;
      try {
        fetch(ENDPOINT + '/feedback', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chatId: chatId, turn: n, rating: rating }) }).catch(function () {});
      } catch (e) {}
    }
    function addBot(r, n) {
      var m = el('div', 'nd-msg nd-bot'), w = el('div', 'nd-wrap');
      w.appendChild(el('div', 'nd-bubble', r.answer));
      var srcs = (r.sources || []).filter(function (id) { return title(id); });
      if (srcs.length) {
        var s = el('div', 'nd-srcs');
        srcs.forEach(function (id) {
          var c = el('button', 'nd-src', title(id)); c.type = 'button';
          c.onclick = function () { close(); location.hash = ''; location.hash = id; };
          s.appendChild(c);
        });
        w.appendChild(s);
      }
      var rel = (r.related || []).filter(function (id) { return title(id) && srcs.indexOf(id) < 0; });
      if (rel.length) {
        w.appendChild(el('div', 'nd-rel', I18N[convLang].related));
        var rs = el('div', 'nd-srcs');
        rel.forEach(function (id) {
          var c = el('button', 'nd-src', title(id)); c.type = 'button';
          c.onclick = function () { close(); location.hash = ''; location.hash = id; };
          rs.appendChild(c);
        });
        w.appendChild(rs);
      }
      if (r.handoff_issue) w.appendChild(handoffCard(r.handoff_issue));
      if (r.status === 'answered' || r.status === 'partial') {
        var rate = el('div', 'nd-rate'), up = el('button', null, '👍'), dn = el('button', null, '👎');
        up.type = dn.type = 'button'; up.setAttribute('aria-label', I18N[convLang].up); dn.setAttribute('aria-label', I18N[convLang].down);
        up.onclick = function () { up.setAttribute('aria-pressed', 'true'); dn.setAttribute('aria-pressed', 'false'); feedback(n, 'up'); };
        dn.onclick = function () {
          dn.setAttribute('aria-pressed', 'true'); up.setAttribute('aria-pressed', 'false'); feedback(n, 'down');
          if (!w.querySelector('.nd-handoff')) { w.appendChild(handoffCard(r.handoff_issue || r.demoIssue || OTHER, I18N[convLang].sorry)); down(); }
        };
        rate.appendChild(up); rate.appendChild(dn); w.appendChild(rate);
      }
      m.appendChild(w); log.appendChild(m);
      if (r.suggestions && r.suggestions.length) log.appendChild(chipsRow(r.suggestions));
      down();
    }
    function addError(text) {
      var m = el('div', 'nd-msg nd-bot'), w = el('div', 'nd-wrap');
      w.appendChild(el('div', 'nd-bubble', text)); w.appendChild(handoffCard(OTHER));
      m.appendChild(w); log.appendChild(m); down();
    }

    function ask(text) {
      text = (text || '').trim();
      if (busy || !text) return;
      var safe = mask(text).slice(0, 1000);
      [].forEach.call(log.querySelectorAll('.nd-chips'), function (c) { c.remove(); });
      var me = el('div', 'nd-msg nd-me'); me.appendChild(el('div', 'nd-bubble', safe)); log.appendChild(me);
      history.push({ role: 'user', content: safe });
      convLang = textLang(safe);
      busy = true; send.disabled = true;
      var t = el('div', 'nd-msg nd-bot'), tb = el('div', 'nd-bubble nd-typing'); tb.innerHTML = '<span></span><span></span><span></span>';
      t.appendChild(tb); log.appendChild(t); down();

      (DEMO ? demoChat(safe) : fetch(ENDPOINT + '/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: chatId, messages: history.slice(-10) })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
      })).then(function (r) {
        t.remove();
        if (r.data && r.data.chatId) { chatId = r.data.chatId; try { sessionStorage.setItem('nd-chat', chatId); } catch (e) {} }
        if (r.status === 200) {
          turn += 1; addBot(r.data, turn);
          history.push({ role: 'assistant', content: r.data.answer });
        } else {
          history.pop();
          addError(r.status === 429 || r.status === 503 ? I18N[convLang].busy : I18N[convLang].error);
        }
      }).catch(function () {
        t.remove(); history.pop(); addError(navigator.onLine === false ? I18N[convLang].offline : I18N[convLang].error);
      }).then(function () { busy = false; send.disabled = !input.value.trim(); });
    }

    function open(prefill) {
      root.classList.add('nd-open');
      if (!started) {
        started = true;
        convLang = uiLang();
        var m = el('div', 'nd-msg nd-bot'); m.appendChild(el('div', 'nd-bubble', DEMO ? T.demoHello : T.hello));
        log.appendChild(m); log.appendChild(chipsRow(T.suggest));
      }
      if (prefill) { input.value = prefill; send.disabled = false; }
      setTimeout(function () { input.focus(); }, 50);
    }
    function close() { root.classList.remove('nd-open'); }

    fab.onclick = function () { open(); };
    sheet.querySelector('.nd-x').onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    input.addEventListener('input', function () {
      send.disabled = busy || !input.value.trim();
      input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit')); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); var v = input.value; input.value = ''; input.style.height = ''; send.disabled = true; ask(v);
    });

    // "Ask น้องดี instead" when the FAQ search finds nothing
    var empty = document.getElementById('empty'), search = document.getElementById('search');
    if (empty) {
      var askBtn = el('button', 'nd-ask-empty'); askBtn.type = 'button';
      askBtn.onclick = function () { open(search ? search.value : ''); };
      empty.appendChild(document.createElement('br')); empty.appendChild(askBtn);
    }

    // ---------- Interface language: set now, and again whenever the page switches TH | EN ----------
    function applyLang() {
      T = I18N[uiLang()];
      fab.setAttribute('aria-label', T.fab); fab.querySelector('.nd-fab-text').textContent = T.fab;
      sheet.setAttribute('aria-label', T.title);
      sheet.querySelector('.nd-name').textContent = T.title;
      sheet.querySelector('.nd-sub').textContent = DEMO ? T.demoSub : T.sub;
      sheet.querySelector('.nd-x').setAttribute('aria-label', T.close);
      send.setAttribute('aria-label', T.send);
      input.placeholder = T.placeholder; input.setAttribute('aria-label', T.placeholder);
      sheet.querySelector('.nd-note-text').textContent = DEMO ? T.demoNote : T.note;
      var c = sheet.querySelector('.nd-contact'); c.textContent = T.contact;
      c.href = uiLang() === 'en' && !/[?&]lang=/.test(SUPPORT_URL) ? SUPPORT_URL + (SUPPORT_URL.indexOf('?') > -1 ? '&' : '?') + 'lang=en' : SUPPORT_URL;
      if (typeof askBtn !== 'undefined') askBtn.textContent = T.askInstead;
      // Before the first message, swap the greeting and suggestions too
      if (started && !history.length) { log.innerHTML = ''; started = false; if (root.classList.contains('nd-open')) open(); }
    }
    applyLang();
    if (window.MutationObserver) new MutationObserver(applyLang).observe(root, { attributes: true, attributeFilter: ['lang'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
