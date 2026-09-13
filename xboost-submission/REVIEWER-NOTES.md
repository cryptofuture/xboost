# Xboost reviewer notes

## Submission status

This is an experimental desktop extension. Local automated tests and web-ext validation pass; live authenticated Firefox/X testing is not represented as completed. A plaintext remote WS transport risk remains intentionally enabled at the author's request. Please do not treat this note as an exemption request.

## Source and build

All executable extension code is readable JavaScript included directly in the uploaded ZIP. No transpilation, minification, bundling, remote executable code, eval, or runtime JS dependencies are used. StandardJS and web-ext are development tools only. The upload contains LICENSE and privacy.html. The original reference extension is not packaged. Xboost connects directly to the user's Codex App Server over authenticated WebSockets.

The publisher has approved public distribution of all four bundled product-context Markdown documents. The extension is licensed under MIT.

Build with Node.js and npm from xboost/: npm ci; npm run check; npm run validate; npm run package.
The included source archive preserves the sibling legacy bridge test files because npm run check references them. Do not run its Docker service for this release; the extension connects directly to Codex WebSockets.

## Basic test

1. Install in Firefox desktop 142 or later. Review the declared data categories.
2. Open the toolbar popup, choose a profile and use Search X. Sign into a dedicated X testing account if required.
3. Observe highlighted rendered posts, change keywords/thresholds in Settings and switch profiles. These operations do not need Codex.
4. Open AI replies / automode. New profile search opens the active profile's Latest search. Refresh/load-more affect only the selected search/Home tab, and block on detected composer text or dialogs.

## AI testing

The publisher must provide private reviewer-only test access for account-dependent features. Do not use production accounts or post tokens on the public listing. Reviewer credentials and a reachable test server have not been provisioned by the preparation agent. The publisher must supplement these notes before submitting.

With an isolated Codex App Server accessible locally or by SSH forwarding:

    codex app-server --listen ws://127.0.0.1:4500 --ws-auth capability-token --ws-token-file /absolute/path/to/test-token

In Settings, use ws://127.0.0.1:4500 and the contents of the test capability token. Existing Codex sign-in is used or the Settings sign-in button starts device-code login. Use a dedicated account/server, never a reviewer's production token. The requested model is gpt-5.6-luna with low reasoning. No automatic model fallback occurs.

Enable AI with the AI panel open. Qualifying posts from open X tabs are deduplicated and drafted sequentially. The full corresponding products/*.md file is passed to Codex. Founder uses identity-only context. Model/server errors pause drafting. Disable AI or close the last AI panel to pause and request turn interruption. Browser restart does not auto-resume.

For a ready draft, edit/copy or click Prepare reply on X. The handoff opens its source post, displays the intended account and provides an explicit Check account & fill reply control. It refuses unknown/wrong visible accounts and nonempty composers. The extension does not click the final send button. Account checks depend on visible X sidebar markup; copy/paste is the fallback. Since intended accounts are fixed to five publisher accounts, full successful composer-fill testing needs access to an intended account; another test account should demonstrate the mismatch safeguard. Do not expose production credentials for this purpose; arrange safe test access with the reviewer.

## Permissions and security

- storage: local settings, credentials, source posts, drafts and deduplication records.
- scripting: activate the local content scripts in existing X tabs on initial install.
- clipboardWrite: user-requested copying of reviewed drafts.
- X/Twitter host permissions: read/render scoring, user-requested source navigation and composer preparation.
- Optional ws/wss host permission: requested when connecting to a user-selected server.
- webRequest and webRequestBlocking: add Authorization only to an extension-origin WebSocket handshake whose exact URL matches the configured endpoint. Remove Origin only on that same request for Codex App Server compatibility. No website CSP or other page security headers are changed.
- Incognito is not allowed, preventing persistence of private-session post data.
- No external JavaScript is loaded. AI output is treated as text, not executable code.

Data categories: websiteContent and personalCommunications for source text; browsingActivity for post URLs; searchTerms for profile queries navigated to X; authenticationInfo for capability tokens and account-related data. No extension analytics are collected.

## Known transport review issue

WS is retained to connect directly to a user-managed Codex agent on the same machine or the user's local network, including Docker deployments. It is not intended as a public internet transport or a connection to a developer-operated hosted service. The user explicitly configures the address and capability token. The agent's subsequent connection to OpenAI is separate; AI inference is not claimed to run locally.

Capability-token authentication restricts server access but does not encrypt WS traffic. Local-network placement alone does not provide confidentiality. WSS and localhost with an encrypted SSH tunnel are supported alternatives, and the UI/privacy policy warn about plaintext traffic.

This describes intended deployment, not an enforced address restriction: the current code also accepts non-local WS hostnames/IPs. We do not claim that LAN use creates an exemption from Mozilla's encrypted-remote-transport requirement. Review of this transport design remains necessary before the build can be called policy-ready.
