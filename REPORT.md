# Computer-Use Automation: Engineering Report

## 1. Architecture
The system enforces a strict boundary between probabilistic discovery and deterministic execution. Vision-based LLMs are non-deterministic, high-latency, and cost-prohibitive for high-volume banking transactions. Conversely, traditional RPA scripts break easily when selectors shift. 
My architecture solves this by using the LLM strictly as an **exploratory compiler** to discover UI pathways once and synthesize that discovery into a versioned, typed JSON Capability Artifact. All subsequent production runs are executed via a fast, zero-LLM deterministic replay engine (`src/engine/`). 

## 2. Artifact Schema
The artifact (`src/schema/`) acts as the strict contract between the calling AI agent and the target UI. 
* **Dynamic Parameterization:** Inputs like `memberId` are mapped to template variables, decoupling discovery values from execution values and turning a single run into a reusable function.
* **Hierarchical Locators:** Because legacy software rarely uses clean IDs, the schema requires a multi-strategy fallback array (Name attributes -> Positional XPath -> Text heuristics) for every target.
* **Checkpoints:** The schema mandates explicit post-action state assertions (e.g., waiting for a specific destination heading). The engine never assumes an action succeeded simply because a click event fired, effectively eliminating race conditions.

## 3. Determinism & Error Handling
Conflating an application error with an automation failure is a fatal flaw in enterprise automation. My deterministic replay engine strictly classifies every outcome into a 3-Tier Error Taxonomy:
1. **Business Outcomes:** The automation worked, but the core returned a valid denial (e.g., "Member not found"). Returns a structured `business_failure` without crashing.
2. **Recoverable Conditions:** Transient network delays or non-blocking modals. The engine engages fallback locators or retry intervals.
3. **Hard Failures:** Critical DOM changes where all locators fail, or guardrail blocks. The engine halts, captures evidence, and routes to the Human-in-the-Loop (HITL) system.

## 4. Heterogeneity & Multi-Tenant
To prove the system handles heterogeneous legacy environments, I built a local Express server mimicking a hostile 2000s-era banking portal using deeply nested `<table>` layouts, no semantic landmarks, and no `data-testid`s. 
For multi-tenant scale (where multiple credit unions run the same core software with different branding), the core capability step graph remains identical. Tenant-specific variations (base URLs, color schemes, slight selector differences) are abstracted into tenant-level parameter overrides that the engine merges with the base artifact at runtime, preventing the need to re-record flows for every single institution.

## 5. Escalation & Handoff
When a Hard Failure occurs (e.g., a completely broken locator due to UI drift), the system does not crash. It triggers `requestHumanIntervention()`.
* **Detect:** The automation loop is paused.
* **Route:** A structured diagnostic payload (capability, step ID, screenshot path, and reason) is logged.
* **Handoff:** Using Node's `readline`, an interactive CLI prompt is exposed to the operator. The live Playwright browser session remains active, allowing the human to manually bypass the blocker (e.g., clicking a changed button).
* **Resume:** The operator signals resumption (`Resume`, `Skip`, or `Abort`), and the engine logs the intervention and seamlessly continues the remaining automation steps.

## 6. Safety
Safety and policy guardrails (`src/safety/`) are enforced at the engine's serialization and execution layers. 
* **Domain Allowlists:** Navigation is strictly restricted to permitted origins (e.g., `localhost`).
* **Action Blacklisting:** Keywords like `DELETE` or `WIRE_TRANSFER` are blocked from execution.
* **PII Redaction:** A regex-based masking engine intercepts all loggers and evidence traces, stripping credentials, session tokens, SSNs, and credit card numbers before anything is written to disk or `stdout`.

## 7. Cuts & Next Steps
**What was cut:** I mocked the HITL operator console using a CLI `readline` prompt rather than building a full real-time co-browsing web socket UI. I also utilized a local mock legacy server rather than a public production site to avoid rate limits and guarantee no real customer PII was exposed.
**What I would build next:** I would implement the "Assisted Fallback" stretch goal. If the deterministic replay hits a hard failure, before immediately escalating to a human, I would allow a bounded, single-step LLM call to attempt to self-heal the broken locator using the current page context, recording the healed locator for future runs.
