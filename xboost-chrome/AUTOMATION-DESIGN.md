# AI reply integration: direct Codex WebSockets

The direct WebSocket client is implemented in `codex-client.js`, with Chrome authentication and local queue management in `ai-background.js`. The extension connects directly to Codex App Server. The AI replies panel enables automatic drafting explicitly. `reply-context.js` prepares prompts and binds the requested account to its source context. Publishing, liking, following and browser account switching remain unimplemented pending an appropriate authorized X workflow.

## Account routing

| Profile | Expected account | Authoritative context |
| --- | --- | --- |
| Bitcoin Monitor Widget | @BitcoinWidget | products/bitcoin-monitor-widget-ai-context.md |
| Solana Index | @index_solana | products/solana-index-ai-context.md |
| Outruna | @outruna_wallet | products/outruna-ai-context.md |
| Intent AI Ops | @IntentAIOps | products/intent-ai-ops-ai-context.md |
| Eugene Gusev | @quellemor | Identity only; no biography or personal experience invented |

The full selected file is passed to the model without summarizing away qualifications. Source-post text is separately encoded as untrusted data. Prompt instructions are not a guarantee of factual accuracy; generated drafts require review.

## AI connection

Codex App Server runs directly or inside Docker on a machine reachable by Chrome. Xboost attaches the capability token during its own WebSocket handshake using Chrome's declarativeNetRequest session rules. The endpoint and extension initiator must both match before any credential is attached. A custom extension CSP permits ws/wss without upgrading ws implicitly. Prefer TLS or SSH forwarding; plain ws is unencrypted. The underlying App Server token is powerful and must be protected.

The background owns a persistent, deduplicated queue and generates one draft at a time. Closing the last AI panel, disconnects and failures pause work. Pausing requests turn interruption; if connectivity is lost, remote cancellation cannot be confirmed. Interrupted jobs are not automatically retried. Threads are ephemeral, read-only, with approval policy never and shell/apps/web search disabled by per-thread configuration. Model-initiated client tool requests are denied. This is not an isolation guarantee against a server's custom configuration; run a dedicated minimally configured Codex instance for Xboost.

Device-code ChatGPT sign-in avoids a browser redirect to the container's localhost. Subscription availability and limits depend on the authenticated account. No browser cookies are extracted.

An OpenAI API service is a separate option requiring API credentials and billing, not implicitly authorized by subscription access.

Sources: [OpenAI authentication](https://learn.chatgpt.com/docs/auth), [Codex app server](https://learn.chatgpt.com/docs/app-server).

## Drafting flow

Enable auto-drafting explicitly → collect relevant candidates → bind profile/account/context → deduplicate candidates → generate one draft at a time → inspect/edit/skip draft → manually publish from the correct X account.

Stop requests cancellation of active work and leaves queued jobs paused. A profile switch does not relabel existing drafts: each keeps its originating profile, intended handle and source-post ID. Repeated appearances do not trigger repeated generation. Product context is read from the installed extension when generating. Model errors pause work and display the reason; a timer is not a promise of unlimited subscription use.

## Publishing and account switching constraints

X prohibits website scripting for automated posting and automated replies based solely on keyword searches. AI reply bots require prior written approval from X. Hence the proposed search-discovery feature prepares drafts for manual review/posting rather than turning keyword matches into unattended replies.

For a separately authorized API publishing workflow, connect each account through OAuth and verify its stable user ID and handle. Route requests using the bound account token, without clicking X's browser account switcher. Eligible reply interactions and any X approval requirements must be established before enabling this workflow. Browser login alone does not supply OAuth grants.

Source: [X automation rules](https://help.x.com/en/rules-and-policies/x-automation?lang=browser).

## Rate-limit design for future API publishing

- Track endpoint/user and app-level budgets independently; changing accounts must not bypass shared app limits.
- Use actual x-rate-limit-limit, x-rate-limit-remaining and x-rate-limit-reset headers, plus applicable Retry-After guidance; verify plan constraints in the developer console rather than hardcoding a universal posts-per-hour number.
- Persist cooldowns across restarts. On HTTP 429, pause affected queues until reset; do not spin or rotate accounts to evade the limit.
- On revoked credentials, permissions failures or unsupported reply eligibility, stop that account's work and surface the cause.
- Persist a publish ledger. Treat timeouts after submission as unknown outcomes; reconcile before retrying to prevent duplicate posts.
- Deduplicate replies across these related accounts, keeping their distinct product purposes.

Source: [X API rate limits](https://docs.x.com/x-api/fundamentals/rate-limits).
