# Xboost AMO submission checklist

Prepared for Xboost 1.8.0. Mozilla signs the extension during submission; you do not need to sign the ZIP first. Nothing has been submitted or published for you.

## Files

- Upload: ../xboost/web-ext-artifacts/xboost-1.8.0.zip
- Name, summary, description and release notes: LISTING.txt
- Privacy policy field: paste PRIVACY-POLICY.txt
- Notes for Reviewers: REVIEWER-NOTES.md, supplemented with private test access
- License: select MIT; full text in ../xboost/LICENSE
- Listing icon: ../xboost/icons/icon128.png
- Optional source package: xboost-1.8.0-source.zip

## Fields to fill

| AMO field | Enter/select |
| --- | --- |
| Distribution | On this site for a public listing; On your own for signed self-distribution |
| Extension file | xboost-1.8.0.zip |
| Platforms | Desktop platforms you have tested; do not claim Android compatibility |
| Separate source required? | No build transformation is used; the upload already contains readable original JS. If requested, supply the optional source archive and build instructions. |
| Name | Xboost |
| Slug | xboost if available; otherwise choose a unique variant, e.g. xboost-conversations |
| Summary | Copy SUMMARY from LISTING.txt |
| Description | Copy DESCRIPTION from LISTING.txt |
| Experimental | Yes for this release; live X composer compatibility still needs confirmation |
| Requires payment/non-free services | Yes: optional AI requires separate Codex access, which may require a paid plan; explain that local scoring does not |
| Categories | Social & Communication; optionally Productivity if offered |
| License | MIT |
| Privacy policy | Check the box and paste PRIVACY-POLICY.txt |
| Support email | Supply an email you monitor and authorize to publish; none has been supplied yet |
| Support website | Your actual support page, if available; do not invent a URL |
| Homepage | Your actual project page, if available |
| Reviewer notes | Copy REVIEWER-NOTES.md and add dedicated reviewer test access privately |
| Version notes | Copy VERSION NOTES from LISTING.txt |

## Owner actions still required before submission

1. Provide a public support contact.
2. Completed: the owner approved public distribution of all four bundled product Markdown documents, including investor/traction sections, and selected MIT licensing.
3. Explain the local-agent architecture using REVIEWER-NOTES.md: WS is intended for a user-managed agent on the same machine or local network, not a public hosted service. Resolve the remaining transport review issue: Mozilla requires encrypted remote transport, and LAN placement or a warning alone does not make plaintext remote WS compliant. Use localhost with SSH forwarding for safe testing. The current code does not restrict WS addresses to local hosts, so this remains a submission risk. Unlisted signing is subject to the same policies.
4. Run the live tests below. Automated tests do not confirm a working logged-in X composer.
5. Arrange isolated reviewer credentials/test access for account-dependent functionality. Do not share your production Codex capability token or personal passwords. The fixed intended accounts make full composer testing a review-access issue to resolve with Mozilla.
6. Review and accept Mozilla's developer agreement yourself, then submit.

## Live acceptance checks

- Fresh Firefox install: permissions/website-data disclosures are visible; AI initially disabled.
- Local scoring and profile searches work without Codex.
- Correct and incorrect capability tokens produce expected connection results.
- AI uses the configured server; toggling off stops new work.
- Each product's drafts remain bound to the correct product/account after profile changes.
- Refresh/load-more preserve existing draft records; existing composers block page actions.
- Correct account + empty composer fills text but never sends.
- Wrong/unknown account and nonempty composer never get overwritten.
- Browser restart leaves AI paused; private browsing is unavailable.

## Screenshots (optional listing enhancement)

Capture real screenshots after live testing: popup/profile selector; highlighted X search with non-sensitive test posts; Settings with token field EMPTY; AI panel with a reviewed non-sensitive draft; assisted reply showing the final manual send step. Do not submit fabricated screenshots or expose account email, capability tokens, private post text, or server addresses. No screenshots were fabricated during preparation.

## Build and upload

From ../xboost:

    npm ci
    npm run check
    npm run validate
    npm run package

Go to https://addons.mozilla.org/developers/ and choose Submit a New Add-on. Upload the package and use the fields above. Address any validator/reviewer findings. For later updates, keep the existing extension ID and upload a higher version under this same listing.

Official references:
- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/

Local tests and lint are not a guarantee of AMO approval.
