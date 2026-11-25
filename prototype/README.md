# Claude artifact prototype (reference only)

`nongdee-claude-prototype.html` is the chat widget used in the Claude prototype
(https://claude.ai/artifact/TUPWBT7dxjxSJAww8awwfa). It is injected into the FAQ page and calls Claude
through the Claude artifact runtime (`claude.use('sample')`), which only exists inside Claude.

It mirrors the production rules: the same prompt, the same FAQ-only guardrail (ported from
`src/grounding.mjs`) and the same second-opinion check. **Production code is `src/` + `web/nongdee.js`.**
Keep this file only as a reference when changing the rules.
