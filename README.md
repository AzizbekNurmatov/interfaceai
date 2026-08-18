# interface.ai — Computer-Use Automation

Deterministic automation for legacy banking applications that have no API.

Phase 1: project scaffolding, safety guardrails, and a local mock of a 2000s core-banking portal.

## Layout

- src/agent — LLM discovery loop (observe → decide → act)
- src/engine — Deterministic replay engine
- src/schema — Zod capability schema and error taxonomy
- src/safety — Domain, keyword, and PII masking guardrails
- src/server — Express mock (MemberCore 7.4)
- src/utils — Logger and evidence screenshots
- capabilities/ — Saved JSON artifacts
- evidence/ — Run screenshots

Discovery (src/agent) is the only place an LLM may be used. Replay (src/engine) never calls a model.

Live discovery needs ANTHROPIC_API_KEY. Runs write evidence/discovery-run.log and evidence/discovery-final.png, then capabilities/discovered-member-inquiry.json for Replay.

## Mock portal (MemberCore 7.4)

Hostile UI: nested tables, name attributes, no data-testid, no semantic landmarks.

- GET /login — Teller logon (TELLER01 / PASSWORD)
- GET /dashboard — Links to Member Search and Account Servicing
- GET /members/lookup — memID=12345 balances; 99999 not found; LOCKED compliance lock. ~500ms delay.

    npm run mock:server

Open http://127.0.0.1:3000/login

## Safety

src/safety/guardrails.config.json restricts navigation to localhost:3000 / 127.0.0.1:3000, blocks keywords such as WIRE_TRANSFER and DELETE, and redacts SSNs, card numbers, and password fields from logs.

## Commands

    npm install
    npx playwright install chromium
    npm run test:setup
    npm test
    npm run mock:server
    npm run discover -- --goal "Log in as TELLER01 and lookup member 12345 savings balance" --url http://127.0.0.1:3000/login
    npm run replay -- --capability capabilities/discovered-member-inquiry.json --param password=PASSWORD --param memberId=12345 --headless --no-hitl
    npm run replay -- --capability capabilities/member-balance-inquiry.json --param password=PASSWORD --param memberId=12345 --headless --no-hitl
