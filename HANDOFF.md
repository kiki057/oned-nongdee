# Handoff: oneD FAQ, support form and น้องดี

Written 25 Nov 2026 at the end of the design work in Claude (claude.ai), for Claude Code to continue.

## Where things stand

| Piece | Status |
| --- | --- |
| FAQ page (TH + EN, one file) | Done, content v2.0. Not yet deployed to `assets.oned.net` |
| Support form | Redesigned, same `/submit` contract. Not yet deployed to `support.oned.net` |
| น้องดี chat API (AWS) | Built and tested locally (24 tests). **Not deployed** (needs AWS access + Anthropic API key) |
| น้องดี widget | Done (TH/EN, demo mode). Live in demo mode on GitHub Pages |
| Guardrail | Done: evidence quotes, fact checks (links / numbers / quoted names), fixed refusals, second-opinion verifier (fails closed) |
| Design doc | "oneD FAQ Chatbot – Design (v1)" in the user's Claude account: https://claude.ai/artifact/4X23yDBtvKP5kcJGNJ1Qpf |
| Claude prototypes (real AI) | FAQ + น้องดี: https://claude.ai/artifact/TUPWBT7dxjxSJAww8awwfa · Support: https://claude.ai/artifact/UMs7YeRG6dzhUPHSYRYW24 |
| GitHub Pages preview | https://kiki057.github.io/oned-nongdee/ |

## Decisions made (by Tong)

- Bot name **น้องดี** ("Nong Dee" in English), Thai voice **ค่ะ / คะ**.
- Model: **Claude via Anthropic's API** for testing. Compare Claude Haiku 5.5 vs Claude Sonnet 5.5 on a test set; ship the cheapest that passes. Default `claude-haiku-5-5`.
- v1 scope: answer **only from the FAQ** + hand off to the support form. No account lookups, no actions.
- Strict FAQ-only guardrail in code, second-opinion check on by default.
- Hosting: **AWS** (Lambda + API Gateway + Secrets Manager).
- Pages stay **single-page, simplified** (not multi-screen flows); they must work in the oneD app's web view.
- FAQ is **one bilingual page** with a TH | EN switch.
- Thai is the source of truth.

## Open questions (waiting on Tong / the team)

1. **"คืนค่าการสั่งซื้อ" (Restore Purchase)**: v2.0 adds it to "paid but no PREMIUM", but the iOS / Android steps are blank. Where is the button?
2. **Free account on the website**: the app now requires PREMIUM before creating an account, but the top-up code section still says "create a free account" on the website. Still true?
3. **English button names** for the new 2.0 screens are guesses: Account, Personal Information, Save, Settings, Yes, Log Out, Current Package, Subscribe PREMIUM, My Account, Restore Purchase. Confirm against the English app. ("Log In" was standardised from Login / Log In / Log in.)
4. **AIS login on the support form**: the FAQ lists AIS / AIS Fibre login, but `loginType` has no AIS value. Needs a backend change to add.
5. **Email + phone both required** on the support form: keep, or make one optional?
6. **Highlighted text** in the v2.0 document's top-up code section: text unchanged vs the page; does the highlight mean "to be changed"?
7. Chat **retention** (90 days proposed), **who owns the test set / weekly review** (CS or product), **pilot size**, production **model + region + cost ceiling**.
8. `/submit` + OCS: accept a `chatId` so the transcript attaches to the ticket.

## Next: API-based + native apps (what Tong asked for)

Ask Tong first: **what are the apps built with** (Swift / Kotlin, Flutter, React Native; TV: Tizen, webOS, Android TV, tvOS) and **how the oneD API authenticates users** (token we can forward?).

Suggested order:

Answered (25 Nov): the apps are native **Swift and Kotlin**, only the mobile apps are in scope (no TV), and users sign in with **Firebase Auth**. Still needed: the Firebase project id (to verify tokens), and whether guests may use the chat in the apps.

1. **FAQ as data** — done. `src/faq.json` is the source of truth; `scripts/build-faq.mjs` writes it into the page (same HTML, same ids); `GET /faq?lang=th|en` serves it with ETag caching; น้องดี reads the same file (text proven identical to before).
2. **OpenAPI spec** — done for `/faq`, `/chat`, `/feedback` (`openapi.yaml`). Firebase ID token bearer auth is in the spec but marked planned. `/tickets` still to add.
3. **Chat API for apps**
   - Authentication: verify the Firebase ID token (`Authorization: Bearer`) in the Lambda; optionally add App Check. The web version uses the Origin allowlist, which apps don't send, so today the apps get 403 on `/chat`.
   - Optional user context: logged-in user id, so the handoff fills itself in. This is groundwork for phase 2 (read-only Evergent lookups).
   - Streaming answers: the guardrail must still check the whole answer before it's shown, so this needs care.
4. **`POST /tickets`**: native handoff without the web form, using the same fields as `/submit`.
5. **Native UI**
   - Chat screen: SwiftUI view and Jetpack Compose screen matching the web widget (suggested questions, FAQ chips, thumbs, handoff, TH/EN).
   - Native FAQ screen fed by `/faq`, and deep links by question id.
6. **Tests**: API tests in this repo, plus a **test set of ~150 real questions** from OCS tickets with expected FAQ ids or "should hand off". Run it on every FAQ or prompt change.

## Useful facts

- Support hours: Mon–Fri 10:00–19:00 (not weekends / public holidays), support@oned.net. AIS Call Center 1175.
- The 10 support-form issue values are in `src/prompt.mjs` (`ISSUES`).
- Atlassian: one31.atlassian.net, Jira projects O20 (oneD 2.0), PDKB (platform), OCS (customer service).
