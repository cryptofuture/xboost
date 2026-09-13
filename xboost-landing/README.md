# Xboost landing page

Open `index.html` directly or serve this folder with any static web server. All CSS and JavaScript are embedded in the single page; the icon is a local asset. No build step or external dependencies.

Design: editorial minimal concept, Arctic Daylight default and Ocean Signal dark theme. The screenshot dialog uses actual extension screenshots in the configured slide order. AI processing disclosures reflect the extension's Codex/OpenAI workflow.

On phones, navigation remains visible, hero actions and workflow steps use compact two-column grids, and the lower sections stack with larger reading text. The screenshot dialog supports swipe and keyboard navigation, keeps controls below the image on mobile, and locks background scrolling while open. Screenshots load lazily. Reduced-motion preferences are respected. All assets are local; no CDN scripts or styles need integrity attributes.

## Before publishing

1. Set the verified Chrome listing URL in `storeLinks` near the bottom of `index.html` and replace the video placeholder when its URL is available. Firefox is already linked to Mozilla Add-ons. Unconfigured links show an availability dialog.
2. Once the public domain is selected, add an absolute canonical link, `og:url`, and absolute social-image URLs to the head. No invented domain is included.
3. Update the installation availability sentence and `llms.txt` with the verified listing links.
4. Deploy this folder, keeping `/llms.txt` accessible from the website root. Configure HTTPS through your host.

Included metadata: title, description, robots, theme color, Open Graph, Twitter summary card, favicon, and SoftwareApplication JSON-LD. A canonical URL and sitemap require the final domain. Store approval and public listing availability are not claimed.

The separate extension privacy policy is `privacy.html`, covering Chrome and Firefox. Use its final absolute URL in browser-store submissions. A short privacy summary is also on the landing page. Review the website section against the actual host's access-log policy before publishing.

## Mobile review

Checked in headless Chrome at widths of 320, 375, 390, 620, 768, 1024, and 1440 CSS pixels: no horizontal page overflow; hero buttons and navigation have at least 44px touch targets. Browser checks cover screenshot navigation, Escape dismissal, focus return, background scroll unlocking, theme storage, and unavailable-link dialogs. Screenshots were visually reviewed at phone and desktop sizes. Physical iOS/Android devices and Safari have not been tested.
