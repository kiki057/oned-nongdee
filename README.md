# น้องดี on AWS: deploy guide

This puts the น้องดี assistant on a **test copy** of the FAQ page (`faq-th-beta.html`). The live FAQ stays untouched until you decide to switch.

```
FAQ page (assets.oned.net)  --POST /chat-->  API Gateway  -->  Lambda  -->  Claude API
        nongdee.js                         (CORS, throttle)   (masks PII, checks replies, logs)
                                                                   |
                                                    Secrets Manager (API key), CloudWatch (logs)
```

## What's in this folder

| Path | What it is |
| --- | --- |
| `template.yaml` | AWS SAM template: Lambda, HTTP API (CORS + throttling), secret for the API key, 90-day log retention |
| `src/handler.mjs` | The chat API: `POST /chat` and `POST /feedback` |
| `src/prompt.mjs` | น้องดี's rules and the support-form issue list. **Edit her behaviour here** |
| `src/faq.mjs` | Reads the FAQ entries from the FAQ page (cached 10 minutes) |
| `src/grounding.mjs` | The FAQ-only guardrail (see below) |
| `web/nongdee.js` | The chat widget the FAQ page loads |
| `web/faq-th-beta.html` | The new FAQ page (Thai + English with a TH \| EN switch) with the widget included |
| `web/faq-en-beta.html` | The same file. Named `-en`, it opens in English (so does `?lang=en`) |
| `web/support-index.html` | The new support form (reads `?issue=` from น้องดี's handoff) |
| `test/local-test.mjs` | Local tests with a fake Claude API (`npm test`) |
| `index.html`, `preview/`, `scripts/build-preview.mjs` | GitHub Pages preview (see below) |

## Languages

น้องดี speaks Thai and English:

- **Her screen** (button, title, hints, greeting, suggestions) follows the page's language, i.e. `<html lang>`. On the FAQ page that's the TH | EN switch, and she follows it live.
- **Her replies** follow the language the user writes in. In English she's "Nong Dee" and uses the app's English button names.
- **The FAQ she answers from** stays the Thai questions (the source of truth). The AI translates the steps for English questions and the guardrail still checks every fact against the Thai entries. The fixed refusals have English versions.
- **Handoff** opens the support form in English when the page is in English.

## FAQ-only guardrail

น้องดี may only say what the FAQ says. Her instructions ask for that, but instructions alone aren't a guarantee, so every reply is also checked **in code** before it reaches the user:

| Check | What fails it |
| --- | --- |
| Cites the FAQ | No valid FAQ entry cited |
| Quotes match | Her "evidence" quotes aren't word for word in the entries she cited |
| Facts match | A link, a number (2+ digits) or a "quoted" button name in the answer isn't in the cited entries |
| Fixed refusals | "Not in the FAQ" and off-topic replies always use fixed wording, so nothing can slip in there |
| Second opinion (`Verify=on`, the default) | A separate Claude call reads only the cited entries and the answer, and finds a statement they don't support. If this check can't run, the answer is blocked |

A reply that fails is replaced with: "ขออภัยค่ะ น้องดีไม่แน่ใจคำตอบนี้…", plus links to the related FAQ entries and the handoff button. In CloudWatch the turn is logged with `"guardrail": "blocked"`, the reasons, and what the model tried to say, so CS can spot gaps in the FAQ.

The second opinion adds one short, cheap call (Haiku) per answer. To turn it off: `sam deploy --parameter-overrides Verify=off`.

## Try it on GitHub Pages

GitHub Pages serves this repo from `main` at **https://kiki057.github.io/oned-nongdee/**:

| Page | What it is |
| --- | --- |
| `/` (`index.html`) | Start page with links |
| `/preview/faq.html` | The new FAQ. "ติดต่อเรา" links go to the preview form, not the live site |
| `/preview/faq-en.html` | The same FAQ page, opening in English |
| `/preview/support.html` | The new support form. It checks the form but sends nothing |

The preview pages are generated from `web/`. After changing anything in `web/`, rebuild them and commit:

```bash
node scripts/build-preview.mjs
```

On the preview, น้องดี runs in **demo mode**: she finds the closest FAQ answer by text matching. No AI, no server, nothing sent anywhere. It shows the chat design and flow only. To switch the preview to the real AI:

1. Add `https://kiki057.github.io` to the stack's `AllowedOrigins` (e.g. `sam deploy --parameter-overrides AllowedOrigins=https://assets.oned.net,https://kiki057.github.io`).
2. Rebuild with the API address: `NONGDEE_ENDPOINT=<ApiUrl> node scripts/build-preview.mjs`, then commit and push.

## Before you start

- An **Anthropic API key** from the Claude Console (console.anthropic.com → API keys). Set a monthly spend limit there too.
- **AWS CLI** and **AWS SAM CLI** installed and logged in to the right account.
- **Node.js 22** (only for running the local tests).
- Access to upload files to the bucket behind `assets.oned.net`.

## 1. Upload the beta FAQ page first

The bot reads its answers from this page, so it must be live before the API is deployed.

```bash
aws s3 cp web/faq-th-beta.html s3://<assets-bucket>/doc/faq-th-beta.html --content-type "text/html; charset=utf-8"
```

Open `https://assets.oned.net/doc/faq-th-beta.html` and check that it loads. There's no chat button yet, which is expected.

## 2. Deploy the API

```bash
sam build
sam deploy --guided
```

Answer the prompts:

| Prompt | Suggested answer |
| --- | --- |
| Stack name | `nongdee-chat` |
| AWS Region | `ap-southeast-1` (Singapore), or the region your team uses |
| Model | `claude-haiku-5-5` to start; switch to `claude-sonnet-5-5` to compare |
| FaqUrl | `https://assets.oned.net/doc/faq-th-beta.html` |
| AllowedOrigins | `https://assets.oned.net` |
| Allow SAM CLI IAM role creation | `Y` |
| ChatFunction has no authentication. Is this okay? | `y` (the FAQ page is public; CORS, throttling and the origin check limit use) |

Note the outputs: **ApiUrl** and **SecretArn**.

## 3. Store the API key

```bash
aws secretsmanager put-secret-value \
  --secret-id <SecretArn> \
  --secret-string 'sk-ant-...'
```

The key only ever lives in Secrets Manager and the Lambda. It is never in the page or the app.

## 4. Check the API

```bash
curl -s -X POST <ApiUrl>/chat \
  -H 'content-type: application/json' \
  -H 'origin: https://assets.oned.net' \
  -d '{"messages":[{"role":"user","content":"แลกโค้ดในแอปได้ไหม"}]}'
```

You should get JSON back with `answer`, `sources` (e.g. `["Activateonetimecode"]`), `status` and a `chatId`. If it fails, check the logs:

```bash
sam logs --stack-name nongdee-chat --tail
```

## 5. Turn on the widget

1. In `web/faq-th-beta.html`, near the end, set `data-endpoint` to the **ApiUrl**:
   ```html
   <script src="nongdee.js" data-endpoint="https://abc123.execute-api.ap-southeast-1.amazonaws.com" defer></script>
   ```
2. Upload both files:
   ```bash
   aws s3 cp web/nongdee.js        s3://<assets-bucket>/doc/nongdee.js        --content-type "application/javascript; charset=utf-8"
   aws s3 cp web/faq-th-beta.html  s3://<assets-bucket>/doc/faq-th-beta.html  --content-type "text/html; charset=utf-8"
   ```
3. If CloudFront sits in front of the bucket, invalidate `/doc/faq-th-beta.html` and `/doc/nongdee.js`.
   Whenever `nongdee.js` changes, also change its address in the page, e.g. `nongdee.js?v=2`, so phones and the app's web view don't keep using an old copy.
4. Open the beta page on your phone and tap **ถามน้องดี**.

To try it inside the oneD app, point a test build's FAQ link at `faq-th-beta.html`.

## 6. Handoff to the support form

น้องดี's "ส่งเรื่องให้ทีมงาน" button opens `support.oned.net/?issue=…&chat=…`. Deploy `web/support-index.html` as the support form's `index.html` (or to a test path first) so the topic gets preselected. The `chat` value is ignored for now. Attaching the transcript to the OCS ticket needs the `/submit` and OCS changes listed in the design doc.

## Day-to-day

| Task | How |
| --- | --- |
| Change น้องดี's rules or voice | Edit `src/prompt.mjs`, run `npm test`, then `sam build && sam deploy` |
| Update an answer | Edit the FAQ page. น้องดี picks it up within 10 minutes |
| Switch model | `sam deploy --parameter-overrides Model=claude-sonnet-5-5` (keep the other parameters) |
| Read conversations | CloudWatch log group in the stack outputs. Each turn is one `chat_turn` line; thumbs are `feedback` lines |
| Find blocked answers | CloudWatch Logs Insights: `filter guardrail = "blocked" \| fields user, blocked_reasons, blocked_answer` |
| Raise limits after the pilot | `ThrottleRatePerSecond` / `ThrottleBurst` parameters |
| Turn the bot off | Remove the `<script src="nongdee.js">` line from the page, or delete the stack |

## Limits and notes

- **Throttling.** API Gateway allows 5 requests/second with bursts of 20 across all users by default. The Lambda also limits each IP to 20 messages per 10 minutes, per warm instance. Add an AWS WAF rate rule if you see abuse.
- **Logs** keep masked chat text, FAQ ids, status, model, latency and token usage for 90 days. Emails, phone numbers and card-like numbers are masked in the browser and again in the Lambda before Claude or the logs see them. No user id is stored.
- **Costs** depend on traffic and model. The FAQ is sent to Claude with prompt caching to keep repeat calls cheap. Watch usage in the Claude Console and set a spend limit there.
- **The FAQ page layout matters.** The parser reads `<details class="q" id="…">` blocks. The old live FAQ page doesn't use them, so keep `FaqUrl` on the new layout.
- **In-app detection.** Logs mark a chat as `app` when the user agent contains "oneD". Adjust in `handler.mjs` if the app's web view uses a different user agent.

## Test locally

```bash
npm install
npm test            # fake Claude API, checks parsing, masking, validation, CORS, rate limit
```

### Test locally with a real key

```bash
ANTHROPIC_API_KEY=sk-ant-... FAQ_URL=https://assets.oned.net/doc/faq-th-beta.html node -e "
import('./src/handler.mjs').then(async ({ handler }) => {
  const r = await handler({ rawPath: '/chat', requestContext: { http: { method: 'POST', sourceIp: '127.0.0.1' } },
    headers: {}, body: JSON.stringify({ messages: [{ role: 'user', content: 'ยกเลิก PREMIUM ยังไง' }] }) });
  console.log(r.statusCode, JSON.parse(r.body));
});"
```
