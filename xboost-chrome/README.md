# Xboost for Chrome

Xboost opens relevant X searches on request and locally scores rendered posts. It highlights strong reply opportunities and leaves other posts fully readable by default. Optional auto-drafting sends selected posts and authoritative product context directly to your Codex App Server and OpenAI. It does not publish, like, follow or send telemetry. Clicking Search X sends the selected keyword query to X through normal browser navigation.

Extension pages use the Arctic Daylight light theme by default. Settings provides a global Dark theme switch for the Ocean Signal palette. The preference is stored locally and updates open extension pages without changing product profiles or scoring.

Confirmations use the same themed dialog design throughout Profile editor and AI replies. Destructive profile deletion uses a distinct danger action. The post-selection dialog inside X follows the saved Arctic Daylight or Ocean Signal palette as well. Chrome still owns the standard warning shown when closing a page with unsaved edits.

The popup's yellow **About Xboost** button is the last popup action. It opens the installed version, MIT license notice, links to all five bundled X profiles, and logo cards with short descriptions for the four documented product websites. Its optional support note asks users to follow, like only posts they genuinely find useful, or try the software; Xboost never performs those actions. Settings can hide the button only after the user checks **Yes, I have supported the author** in the confirmation dialog, and can restore it at any time.

## Optional AI replies

Project-sharing invitations (for example, "drop what you're building" or "share your URL") are treated as discovery opportunities, with at least a one-match relevance signal even without a literal keyword. Other filters still apply; giveaways and coercive engagement remain excluded. This is a wording heuristic, not proof that a promotion is appropriate.

Founder drafts receive the full contexts of all four product slots, using saved custom contexts where present, and choose one relevant product by topic. Open-ended showcases may feature one suitable product. Product introductions should include a documented website when URLs are invited, or a documented GitHub repository for relevant source-code discussions. No repository or open-source status is inferred merely from the existence of a website. Ordinary conversational replies still need not promote anything. Draft punctuation is normalized to hyphens, straight apostrophes and straight double quotation marks.

Configure **Connect Codex App Server** in the main **Settings** page. Then open **AI replies** in the popup: its single enable/disable toggle starts drafting immediately when enabled. Connection and sign-in controls live only in Settings. Xboost connects directly to Codex App Server over WebSockets.

Start your server with:

```sh
openssl rand -hex 32 > ./xboost-token
codex app-server --listen ws://0.0.0.0:4500 \
  --ws-auth capability-token \
  --ws-token-file ./xboost-token
```

On Windows PowerShell with OpenSSL installed:

```powershell
openssl rand -hex 32 | Set-Content -NoNewline .\xboost-token
codex app-server --listen ws://0.0.0.0:4500 --ws-auth capability-token --ws-token-file .\xboost-token
```

Enter `ws://YOUR-SERVER-LAN-IP:4500` in Settings (not `0.0.0.0`, which is a bind address), paste the **contents** of the token file, and click **Save & connect**. If Chrome and Codex run on the same machine, use `ws://127.0.0.1:4500`. For Docker, publish port 4500 and persist the Codex authentication directory. No ChatGPT browser cookies are read: use the server's existing Codex login or Settings' device-code sign-in.

Plain WebSockets expose the token and messages to network observers. Prefer localhost/SSH forwarding, or `wss://` behind a TLS proxy for LAN/remote use. Never expose this server publicly without appropriate protection: its capability token grants access to App Server, not just Xboost drafting.

Keep the AI panel open while auto-drafting. Closing the last panel pauses collection and requests cancellation. Disconnects, generation failures and subscription-limit errors pause work; restart does not automatically resume. Small preferences and discovery state use extension-local storage; draft bodies, source posts, profile revisions and reply history use extension-owned IndexedDB.

Auto-drafting excludes every configured profile account and attaches each draft to its originating product/handle. Review/edit/copy drafts and publish manually from the correct X account. No automatic likes, follows, account switching or publishing is enabled in this release.

**Assisted replies:** click **Prepare reply on X** on a ready draft to open its source post with your edited text in an Xboost panel. Use X's account switcher yourself if needed, then click **Check account & fill reply**. Xboost verifies the visible account handle, opens the source post's reply composer, and fills it only if empty. Review the target, account and text in X and click Reply yourself. It never clicks Send, Like or Follow. If account detection or editor insertion fails, use Copy draft. Account detection depends on X's current sidebar markup and may be unavailable on narrow layouts. Handoffs expire after 30 minutes and are cleared on background restart; reopen from the AI panel if necessary.

Drafts may contribute useful topical conversation without mentioning a product or requiring the source post to ask a question. Product claims still follow the full authoritative context. Skips request a specific reason, displayed in the draft card. Retry is available for skipped, failed and interrupted drafts; when AI is disabled, retries wait in the queue until enabled. Older skipped drafts remain visible and can be retried for a reason.

The implementation follows the [official Codex App Server protocol](https://learn.chatgpt.com/docs/app-server): authenticated WebSocket handshake, initialize, ephemeral thread, turn and streamed completion. The WebSocket transport is experimental; compatibility was developed against Codex 0.153.4.

Requires Chrome 116 or newer. Worker restarts restore drafting paused.

There are no licences, plans, counters, daily quotas or usage caps. Every visible post is scored as you scroll.

## Install for development

1. Open chrome://extensions in Chrome.
2. Enable Developer mode.
3. Click Load unpacked and select the xboost-chrome folder.
4. Reload your X tabs.

For a packaged build:

```sh
npm install
npm run check
npm run validate
npm run package
```

The Chrome upload ZIP is written to web-ext-artifacts/. For local installation, use Load unpacked with the extracted folder.

## Switching profiles

The Welcome page first explains the manual workflow, then lists every saved profile. It can open the new-profile wizard directly. A profile created from Welcome becomes the active Xboost profile, then the editor returns to Welcome with that profile highlighted so selecting it opens its X search. Profile editor also has a permanent **Back to Welcome** action.

**Profile editor** in the popup opens a dedicated page, separate from Settings and AI replies. Profiles can be created, copied, edited and deleted. Copying clones the form's identity, authoritative context, targeting, filters and appearance into a separate profile named with a `copy` suffix; the original remains unchanged. Both `@name` and full X profile URLs are accepted. The three-step creation wizard uses Solana Index only as a structure example and rejects the unchanged example context. It also provides a copyable prompt for asking an AI assistant to prepare authoritative product context without inventing facts. Deleting a profile removes its settings but preserves existing drafts and reply history. Saved custom context overrides bundled documents without modifying those files. Concurrent changes are rejected until reload. New queued posts capture the account/context definition when selected; existing drafts retain their original identity. Every currently configured account handle is excluded from candidate collection.

Active-profile changes rescore visible posts. Posts appended during scrolling and recycled article elements are evaluated with the latest targeting. This updates local scoring, not the query X is already searching; open a new search when you want X to retrieve results for new terms.

With Xboost scoring enabled, each text post offers **Select for AI**. The dialog captures the current profile, displays local keyword/phrase/hashtag suggestions (unchecked), and accepts custom phrases. Confirm to save the source post to that profile's persistent AI queue and merge only chosen keywords without replacing existing targeting. Selection works while AI is off, bypasses automatic score filters, excludes owned accounts and deduplicates against existing jobs. Enable Auto-draft replies in the AI panel to process saved selections; if already enabled, they may begin immediately. Saved terms affect subsequent scoring and new profile searches, not the query of an already-open search. Suggestions are literal heuristics, not semantic AI analysis. Broad terms can produce noisy results. Existing drafts are not sent automatically.

The AI replies panel also provides **New profile search**, **Refresh page**, and **Load more posts**. Choose an X search/Home tab for refresh or load-more. Refresh reloads that page; load-more scrolls one viewport and focuses the tab so X can load additional results. Open dialogs or nonempty composers block these actions. New profile search uses the active profile's keywords and Latest ordering. Keep AI enabled to draft newly highlighted candidates. Existing drafts and deduplication records survive refresh; replies still require your final click. Availability of additional results depends on X.

The default discovery flow is **profile → search mode → Search X → highlighted opportunities**. The popup offers product conversations or people asking for help, using the active profile's saved keywords. Searches open a new X tab with Latest selected. X controls search availability and results. The welcome screen also opens a conversation search after profile selection. Search ordering follows [X's Latest search behavior](https://help.x.com/en/resources/recommender-systems/search-recommendations).

Discovery defaults use a 24-hour age window, include replies, use smooth reply headroom without a reply cutoff, and leave non-matching posts readable. The popup reports counts and filtering reasons for currently rendered, evaluated posts (not the entire search result set). Enable “Dim other posts” in settings to restore dimming.

Upgrading existing profiles applies highlight-only styling, includes replies and enables the optional help bonus. Old default age/reply values (60 minutes / 15 replies) become 1440 / 0; customized numeric values remain. A backup is stored at `xboost:pre-discovery-profiles`. Migration runs once so subsequent edits stick.

Use the toolbar's **Active profile** selector to switch instantly between Bitcoin Monitor Widget, Solana Index, Outruna, Founder X account and Intent AI Ops. The choice applies across all open X tabs and persists after restarting Chrome. This changes targeting, not the signed-in X account.

Each profile saves its own keywords, blacklist, filters, weights and appearance settings. Pause/resume is global. Settings-page profile cards also switch immediately, saving the outgoing draft first. Save applies edits to the profile they were made in, even if another window switched profiles meanwhile. Reset form restores only that profile's defaults; Save commits the reset.

On upgrading from the old single-profile setup, the old settings are retained under `xboost:legacy-settings` in local extension storage. The five new profiles start with the supplied product keyword lists, with Bitcoin Monitor Widget active by default.

## How scoring works

New profile defaults combine freshness (35%), conversation headroom (20%) and keyword relevance (45%), with a highlight threshold of 55. Unknown signals are removed and the remaining weights are renormalized. With no keywords, relevance is skipped.

Freshness declines smoothly with a three-hour half-life after the first 15 minutes. Relevant questions or help/recommendation wording receive an optional 10-point bonus, capped at a total score of 100. This is a literal wording heuristic, not proof of buying intent, and is configurable per profile.

Relevance uses distinct matches, independent of list length: zero matches = 0%, one = 55%, two = 85%, three or more = 100%. Repetition and case variants give no extra credit. If a matched term is contained in another matched term, only the longer term counts (for example, `AI agent` / `AI agents`, or `Solana` / `Solana RPC`). This conservative rule avoids inflated evidence from overlapping targeting terms. Matching remains literal and case-insensitive, with word boundaries for simple words and substring matching for phrases. No semantic inference is performed.

New profiles enable **Require a keyword match**, preventing unrelated fresh posts from highlighting. You can disable it per profile. If keywords are empty, this requirement is skipped. The three-match saturation is a score normalization, not a usage or keyword-list limit.

Before scoring, optional filters can exclude replies, promoted posts, engagement bait, blacklisted authors, old posts and posts below a view floor. Solana Index also rejects obvious meme-token promotions while retaining technical discussions that merely mention meme coins. Set the age, minimum views or maximum replies field to `0` to disable that cutoff. All weights and thresholds are editable.

All selectors for X's frequently changing markup are grouped at the top of `content.js`.

## User-driven single-profile discovery

In **AI replies**, choose one profile and use **Start profile discovery**, then **Open next deep search**. A session works only toward that profile's target, matching the manual X-account workflow. Each click advances to a focused search and reuses one extension-owned tab. Adjacent saved terms are combined in groups of up to three with `OR`, reducing the number of search navigations while preserving their configured order. Search slices alternate Latest and Top and exclude replies. The generated URL has no Xboost fragment, date operator or native-repost filter. If X shows "Something went wrong", **Current search failed: open simple fallback** retries one term from that group in Latest without operators. Local freshness and quality rules still apply to fallback results.

The default target is **100 ready drafts for the selected profile**. Target, maximum post age (24 hours), pending drafts (20), and candidates per author/session (3) are configurable before starting. Stricter profile age filters remain in effect. The target is not a guarantee of supply or a hard usage cap. Generating 100 drafts consumes Codex capacity through the existing configured model; there is no model fallback. Stop the session, manually switch the signed-in X account, and start another profile when ready.

- Search variants combine up to three adjacent saved keywords or literal context topics with separate recommendation, tool-search, alternative, problem, help, building, open-source and project-sharing intents. Founder context includes its current four-product portfolio. These local variants do not modify saved targeting and do not add AI assessment calls. Grouping reduces navigation pressure but does not guarantee that X will not rate-limit browsing. Older multi-profile sessions are stopped on upgrade with all drafts preserved; start a new single-profile session.
- Ready counts require nonempty draft text, a compatible profile revision and a known, fresh source timestamp. Existing compatible drafts top up the target. Queued/running, skipped, dismissed, replied, stale and incompatible drafts do not count. Legacy drafts without timestamp/revision metadata stay available, labelled as not counted.
- The owned search tab sends loaded candidates only to the selected profile. Local scoring, owned-account exclusion, author diversity, duplicate source/text checks and queue backpressure run before AI. Replies without verified parent context are conservatively excluded. No cross-profile fit checks are performed.
- Scrolling Home, Search or another X page can also supply highlighted posts while the active Xboost profile matches the session profile. Those posts enter the same session target, deduplication, quality checks and backlog. As drafting frees pending capacity, Xboost rechecks already-loaded posts across open X tabs without refreshing, scrolling or navigating, so candidates deferred by backpressure can be reconsidered. A different active profile cannot feed the session. Manual selections outside session tabs remain available but wait until the session is stopped/complete before normal drafting resumes.
- **Pause**, **Resume** and **Stop** preserve progress and existing drafts. **Force stop and start over** asks for confirmation, interrupts unfinished jobs, resets inspected/search progress, and starts a fresh session while preserving ready drafts and reply history. Closing the last AI panel pauses work. Restart restores unfinished discovery paused, with no automatic navigation. A profile edit blocks that profile until **Accept current profile settings** is clicked; old tab bindings and old-revision jobs cannot silently use the new identity/context. Open another search for the updated profile.
- All variants visited means only that the user opened each search, not that X has no more posts. The UI reports the shortfall and permits explicit revisits after a 15-minute local cooldown. There are no automatic retries or freshness/quality relaxations.
- Use **X shows a limit / challenge** if X displays an access restriction. This pauses discovery and requires an explicit resume after a local cooldown; honor any longer wait displayed by X. Known sign-in/access redirects also pause the session. Other X error markup is not reliably detected. The cooldown is not a claim about X's permitted request rate.
- The selected profile shows ready/target, existing/new ready, inspected, pending, skipped/failed, rejected, stale/incompatible counts, current search, rejection reasons, contextual guidance and revisit time. For example, a high reply-without-context rejection count recommends the new direct-post searches. A completed session does not replenish permanently; explicitly start a new one when desired.

Deterministic mocked tests cover 100 successful drafts for a selected profile, search-tab reuse, simplified fallback, top-ups, backpressure, ownership/deduplication, pauses, restart, profile changes, error handling, and queue edit/scroll preservation. This does not establish that live X will expose 100 suitable fresh conversations or that an account has sufficient Codex capacity. Browser markup and navigation need live Chrome verification. Publishing, following, liking and X account switching remain manual.

### Follow-back and reply history

Click **Follow-back on X** in the popup to open X Notifications directly. Review likes and followers, switch accounts and follow people using X itself. There is no separate import workflow or automatic following. Previously imported local records are left untouched but no longer displayed or updated.

AI drafts use the selected profile. Cross-profile fit checks and their queueing buttons have been removed; old pending assessments will not run. Existing drafts and reply history remain intact. Prior confirmed replies are included in drafting context to discourage repeated promotion. Account switching and publishing remain manual.

After publishing on X, click **Mark replied** on the draft. This records the account, edited draft and timestamp locally, with an undo option; it is your confirmation, not automatic verification by X. Every card for the same post shows its reply history. Drafts are grouped by profile and fetched 25 per page. First, previous, direct-page, next and last navigation share a stable browsing snapshot. Incoming jobs show as a compact notification and do not move page 3 to page 4 until you choose to merge them. Top/bottom actions apply only to the current page. Page and scroll state are remembered per queue profile filter during the panel session. The filter never switches the active Xboost or X account. Long URLs wrap inside their cards. Draft edits are saved locally after a short debounce and survive paging; a concurrent edit from another panel is rejected with a visible conflict instead of silently overwriting it. Preparing or copying a draft does not count as publishing.

To keep open-tab state bounded, each X tab remembers at most 1,000 recently submitted post IDs and a discovery session persists at most 4,000 recent inspected IDs while retaining its cumulative inspected count and durable job deduplication. Repeated profile contexts are stored once per revision instead of once per job. Draft, failure, retry and reply records are no longer reduced or deleted by automatic memory cleanup. Queue views retain at most three loaded pages; evicted history stays accessible in IndexedDB.

Upgrading migrates the earlier whole-array draft store to IndexedDB in resumable 500-record transactions. The migration is idempotent, validates the transferred record count and keeps the legacy copy until validation completes. Status reads do not rewrite unchanged state, one job transition does not rewrite unrelated bodies, and viewing local queue pages does not contact Codex. See [PERFORMANCE.md](PERFORMANCE.md) for the reproducible fixtures, measured Chrome results and limitations.

## Privacy and permissions

- `storage`: saves settings and the appearance theme locally in Chrome.
- `scripting` plus the four X/Twitter host patterns: activates Xboost in a matching tab that was already open when the extension was installed.
- Optional host permission: granted for the selected WebSocket host when connecting; its token is stored in extension-local storage, not synced.
- declarativeNetRequestWithHostAccess: attaches bearer authentication and removes Origin only for WebSocket requests from this extension to the exact configured endpoint. The session rule holds the token until Chrome exits or the endpoint is replaced.
- `clipboardWrite`: copies reviewed draft text when requested.
- Opt-in AI sends website content to your Codex server and OpenAI. Chrome Web Store disclosures must describe this processing. Local scoring stays offline.
