// Builds preview/ for GitHub Pages: copies of the beta FAQ and the support form that link to EACH OTHER
// instead of the live sites, so the whole flow can be tried at kiki057.github.io/oned-nongdee/preview/.
//   node scripts/build-preview.mjs
// Optional: NONGDEE_ENDPOINT=https://xxxx.execute-api.ap-southeast-1.amazonaws.com node scripts/build-preview.mjs
//   (also add https://kiki057.github.io to AllowedOrigins in the AWS stack, or the browser will block the calls)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
// Without NONGDEE_ENDPOINT the preview runs น้องวันดี in demo mode (FAQ text matching, no AI, no server).
const endpoint = process.env.NONGDEE_ENDPOINT || 'demo';
// Version the widget URL by its content, so phones and the app's web view never keep an old copy
const widgetVersion = createHash('sha1').update(await read('web/nongdee.js')).digest('hex').slice(0, 8);

let faq = await read('web/faq-th-beta.html');
let support = await read('web/support-index.html');
let faqEn = await read('web/faq-en-beta.html');

const banner = (text) =>
  `<div style="background:#ffb020;color:#1a1a1a;font:500 13px/1.4 system-ui,sans-serif;text-align:center;padding:6px 12px">${text}</div>`;

// FAQ preview: "contact us" links go to the preview support form; widget uses ../web/nongdee.js
faq = faq
  .replaceAll('https://support.oned.net/?lang=en', 'support.html?lang=en')
  .replaceAll('https://support.oned.net/', 'support.html')
  .replace(/src="nongdee\.js(?:\?v=[^"]*)?"/, `src="../web/nongdee.js?v=${widgetVersion}"`)
  .replace(/data-support-url="[^"]*"/, 'data-support-url="support.html"')
  .replace(/<body>/, '<body>\n' + banner('ตัวอย่างสำหรับทดสอบ · Preview only — not the live oneD FAQ'));
faq = faq.replace(/data-endpoint="[^"]*"/, `data-endpoint="${endpoint}"`);

// Same bilingual page saved as faq-en.html: the file name makes it open in English
faqEn = faqEn
  .replaceAll('https://support.oned.net/?lang=en', 'support.html?lang=en')
  .replaceAll('https://support.oned.net/', 'support.html')
  .replace(/src="nongdee\.js(?:\?v=[^"]*)?"/, `src="../web/nongdee.js?v=${widgetVersion}"`)
  .replace(/data-support-url="[^"]*"/, 'data-support-url="support.html"')
  .replace(/data-endpoint="[^"]*"/, `data-endpoint="${endpoint}"`)
  .replace(/<body>/, '<body>\n' + banner('ตัวอย่างสำหรับทดสอบ · Preview only — not the live oneD FAQ'));

// Support preview: FAQ links go to the preview FAQ; the form must not reach the real /submit
support = support
  .replaceAll('https://assets.oned.net/doc/faq-th.html', 'faq.html')
  .replaceAll('https://assets.oned.net/doc/faq-en.html', 'faq-en.html')
  .replace('action="/submit"', 'action="#"')
  .replace(/<body>/, '<body>\n' + banner('ตัวอย่างสำหรับทดสอบ · Preview only — the form is not sent'));
const stub = `
        msg.classList.remove('show');
        e.preventDefault(); // PREVIEW: nothing is sent
        msg.style.color = 'var(--ok)';
        msg.textContent = lang === 'en' ? 'Preview only: the form is valid. On support.oned.net it would be sent.' : 'ตัวอย่างเท่านั้น: ข้อมูลครบถูกต้อง บนหน้าจริงจะส่งให้ทีมงาน';
        msg.classList.add('show');
        return;`;
const before = "        msg.classList.remove('show');\n        btn.disabled = true; btn.classList.add('loading');";
if (!support.includes(before)) throw new Error('support form submit code changed: update build-preview.mjs');
support = support.replace(before, stub + "\n        btn.disabled = true; btn.classList.add('loading');");

await mkdir(new URL('preview/', root), { recursive: true });
await writeFile(new URL('preview/faq.html', root), faq);
await writeFile(new URL('preview/support.html', root), support);
await writeFile(new URL('preview/faq-en.html', root), faqEn);
console.log(`preview/faq.html, preview/faq-en.html and preview/support.html written (น้องวันดี: ${endpoint === 'demo' ? 'demo mode, no AI' : endpoint})`);
