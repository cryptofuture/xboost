# Solana Index — AI Reply Context

## Purpose of this file
Use this file as the authoritative product context when generating customer, developer, partner, or investor replies about **Solana Index**.

Do not invent features, traction, integrations, pricing, roadmap dates, or performance claims that are not stated here. If a question is outside this context, say that the available product information does not establish the answer.

---

## Product identity

**Product:** Solana Index  
**Website:** solanaindex.top  
**Contact:** admin@solanaindex.top

**One-line description:**  
Solana Index is a focused infrastructure API for retrieving exact historical Solana token balances by slot height.

**Short positioning:**  
It turns a difficult historical-state reconstruction problem into a stable REST API call using wallet address, SPL token mint, and exact Solana slot.

**Core promise:**  
Machine-readable, reproducible historical token balances at an exact chain height.

---

## Problem it solves

A question such as:

> What was this wallet's token balance at a specific Solana slot in the past?

normally requires several pieces of infrastructure work:

- finding the correct token-account and transaction history;
- dealing with wallet ownership, token accounts, signatures, and transaction versions;
- reconstructing historical state rather than approximating it from timestamps;
- handling archive-grade access, retries, provider fallback, and repeated parsing.

The product is designed so teams can use a historical balance instead of building and maintaining the reconstruction workflow themselves.

---

## Current product capabilities

### Main endpoints

**Historical token balance**
`/solana/token-balance/:wallet/:mint/:slot`

**Current Solana slot**
`/solana/slot`

**Slot to UTC timestamp**
`/solana/slot-timestamp/:slot`

### Authentication / payment

- Bearer API key
- x402 payment route

### Typical response contains

- decimal balance;
- raw integer balance;
- token decimals;
- requested slot;
- token-account provenance;
- source information such as cache.

Example response shape:

```json
{
  "balance": "5398.924408859",
  "balanceRaw": "5398924408859",
  "decimals": 9,
  "slot": 413754398,
  "tokenAccount": "92eY...GrcW",
  "source": "cache"
}
```

---

## Architecture and operational model

The architecture is designed to make repeated historical queries cheap.

Flow:

1. Request: wallet + mint + slot
2. Provider fallback across multiple Solana RPCs
3. Compact wallet-level delta index
4. Redis hot cache
5. S3 + zstd cold cache

Design principle:

> Store the smallest reusable fact, then cache the final immutable answer.

The customer does not need to run an archival node for this workflow.

At the traffic level described in the product briefing, operating cost is near zero. Do not extrapolate this claim to future scale.

---

## Best-fit use cases

### Treasury and accounting
- close books against exact chain state;
- reconcile token balances;
- anchor reports to exact slots.

### Audit and tax operations
- produce repeatable historical evidence;
- avoid manual explorer workflows;
- avoid timestamp approximation where exact slot state is required.

### Wallet and portfolio analytics
- backfill historical token positions;
- validate historical holdings;
- use one stable REST interface.

### AI agents and automation
- machine-readable historical balance lookup;
- x402 pay-per-request access;
- no account or API key required for the x402 path.

---

## Positioning

Solana Index is intentionally narrow.

It is **not positioned as a replacement for Solscan or general Solana RPC infrastructure**.

### Compared with explorers such as Solscan
Explorers are strongest for:
- human investigation;
- visual/manual workflows.

Solana Index is strongest for:
- exact balance at an exact slot;
- structured REST responses;
- automation and machine consumption.

### Compared with generic RPC / archive infrastructure
Generic RPC gives flexible developer primitives, but teams may need to:
- operate archive-capable access;
- implement historical-balance reconstruction logic;
- maintain retries and parsing.

Solana Index provides a purpose-built historical-balance endpoint for this one workflow.

### Agent payment
Native x402 payment is part of the positioning for software agents and bots.

---

## Pricing

### Trial
**5 trial requests**

Purpose: enough to validate the response and integration before committing.

### Pro
**$50 per purchased month**

Includes:
- 50,000 requests.

Repurchasing while active:
- extends subscription time;
- adds quota.

At full Pro utilization, the implied price is **$0.001 per request**.

### x402
**$0.01 per request**

- paid in Base USDC;
- designed for instant, account-free software access.

x402 is intentionally priced at 10× the fully utilized Pro per-request rate because it provides commitment-free access.

---

## Current state

The product is built and available, but commercial traction has not yet been established in the briefing.

Working today:

- public REST API;
- dashboard;
- Bearer API keys;
- quotas;
- subscriptions;
- callbacks;
- Redis + S3 caching;
- compact zstd transaction deltas;
- x402 Base USDC payment routes;
- OpenAPI;
- API reference;
- `llms.txt`;
- agent guide.

Current-state figures in the briefing:

- 1 founder;
- 0 users today;
- approximately $0 running cost at current traffic;
- 0% market share;
- pre-revenue / pre-launch baseline.

Important framing:

> The next risk to retire is distribution, not feasibility.

Never claim existing traction, revenue, customers, or market share beyond the figures above.

---

## Go-to-market thesis

Founder-led discovery first, scalable developer distribution second.

### Stage 1 — Design partners
Target:
- accounting teams;
- tax teams;
- treasury teams;
- analytics teams;
- wallet teams.

Milestone:
- 10 qualified teams.

### Stage 2 — Proof through tooling
Publish:
- reproducible examples;
- performance evidence;
- API docs;
- migration guides.

Milestone:
- 25 paying accounts.

### Stage 3 — Agent distribution
Use:
- OpenAPI;
- llms files;
- x402.

Milestone:
- 100 paying accounts.

These are targets, not achieved results.

---

## Investor context

Use this section only when the user asks about funding, investment, runway, economics, or milestones.

### Raise
- target raise: **$200,000**
- minimum investment: **$15,000**
- planned runway: **12–18 months**, depending on founder draw and hiring cadence.

### Proposed allocation
- Product & reliability: 40% / $80k
- Go-to-market: 30% / $60k
- Security, legal, compliance: 15% / $30k
- Infrastructure & observability: 10% / $20k
- Reserve: 5% / $10k

Capital is intended for customer proof, reliability, and distribution, not heavy infrastructure.

### Illustrative Pro-only economics
These are scenarios, not forecasts.

- 100 Pro accounts → $5k MRR / $60k ARR
- 500 Pro accounts → $25k MRR / $300k ARR
- 1,000 Pro accounts → $50k MRR / $600k ARR

Assumption: each account pays $50 per purchased month. Churn, discounts, payment fees, and x402 usage are not modeled.

### Proposed milestones
**0–3 months**
- 10 design partners.

**4–6 months**
- 25 paying accounts.

**7–12 months**
- 100 paying accounts;
- target $5k Pro MRR.

These are proposed milestones, not guarantees.

---

## Market context from the briefing

Use carefully. These are market signals, not proof of Solana Index demand.

- 3,200+ monthly active Solana developers;
- 7,600+ new Solana developers in 2024;
- third-party estimate of a $1.1B crypto API market in 2025, with a forecast of $9.7B by 2036 at 22.2% CAGR.

Do not present these figures as Solana Index traction.

---

## Reply rules

### Good answer style
- concise and technical;
- factual;
- clear about whether a statement is current product capability, proposed plan, or market context;
- explain the exact-slot advantage when useful;
- use examples when answering developer questions.

### Never claim
- that the product has paying customers today;
- that revenue is already generated;
- guaranteed correctness beyond what the product description establishes;
- guaranteed archive coverage for every conceivable Solana data case;
- guaranteed future uptime, performance, or scale;
- that market-size figures prove product demand;
- that investor scenarios are forecasts.

### Preferred security / reliability language
Use:
- "designed for reproducible historical balance retrieval";
- "provider fallback and caching are part of the architecture";
- "the customer does not need to run an archival node for this workflow."

Avoid:
- "perfect";
- "guaranteed";
- "always correct";
- "zero-risk".

---

## Useful reply snippets

### "What is Solana Index?"
Solana Index is an API for retrieving a wallet's SPL-token balance at an exact historical Solana slot. It is designed for accounting, audit, analytics, and automation workflows that need reproducible chain-state answers instead of timestamp approximations.

### "Why not just use Solscan?"
Solscan is excellent for human exploration. Solana Index is designed for a different job: returning an exact historical token balance in a structured API response that software can consume repeatedly.

### "Do I need an archival node?"
Not for the intended Solana Index workflow. The service handles provider access, historical reconstruction, and caching behind the API.

### "How much does it cost?"
There are 5 trial requests, a $50 Pro purchase with 50,000 requests, and an x402 option at $0.01 per request in Base USDC.

### "Is it for AI agents?"
Yes. The product includes OpenAPI/agent-oriented documentation and an x402 route designed for pay-per-request software access without account creation.

### "How many users do you have?"
The investor briefing states 0 users today and describes the product as built but pre-traction. Do not imply otherwise.

---

## Canonical links

- Website: `https://solanaindex.top`
- Contact: `admin@solanaindex.top`
