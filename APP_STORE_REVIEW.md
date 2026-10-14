# SphereMessage website handoff

The homepage retains the existing static HTML, Tailwind styling, logo, radar animations, parallax, analytics, and Appwrite waitlist. Feature descriptions use the six implemented features supplied in the task; the iOS binary is not in this repository and has not been independently tested.

## Before resubmission

- Six owner-supplied iPhone screenshots are now included unchanged in images/ios/ and displayed in the homepage gallery. Confirm these captures match the exact submitted build.
- Confirm Feed, Hangouts, Sphere Radar, Moments, Private Messaging, and Profiles match the exact submitted build.
- Deploy this checkout through the existing Vercel project and verify the production homepage and /hangout/<id>. No deployment was performed or verified in this session; no linked Vercel project configuration was available locally.
- Visually check desktop and phone widths. The browser tool timed out, so rendered layout was not verified.
- Verify waitlist submission using an authorized test record and support email delivery. No real signup or email was sent.

## When iOS becomes publicly available

Set APP_STORE_URL in src/platform.js only after verifying the actual public HTTPS apps.apple.com listing. The homepage download controls and availability copy will update and the waitlist will hide. Update the separate invitation and legacy pages' review-status wording at the same time. Do not use a placeholder listing.

## Screenshot integration

The six supplied 1179 × 2556 PNGs appear in a responsive one-, two-, or three-column gallery with descriptive alt text, captions, native lazy loading, and full-size links. The gallery uses static HTML so it works without JavaScript. Image dimensions reserve layout space; the original pixels and aspect ratios are preserved.

## Validation

- Existing Google Play listing verified: https://play.google.com/store/apps/details?id=com.sphereandroid.app
- Published privacy page reachable: https://getspheremessage.com/privacy
- Homepage local links, fragment targets, and assets checked (25 references, no missing targets).
- Inline JavaScript syntax and JSON-LD parsed across HTML pages (22 blocks, no failures).
- Platform URL behavior checked for empty, unsafe, unrelated-host, and App Store URLs.
- Tailwind CSS compilation passed with the installed CLI. Generated output was restored because the homepage uses its existing CDN stylesheet and no generated CSS change is required.
- package.json has no build or lint scripts. No lint command is configured.

Apple guideline reference: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
These website changes do not establish App Store approval.
