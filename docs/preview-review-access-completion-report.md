# Preview Review Access Completion Report

Date: July 29, 2026

Remote repository updated: No

## Outcome

The unreleased LLM Training Laboratory now has a legitimate, low-prominence
public review path without appearing in the main navigation, homepage
promotions, or Demo Lab card directory.

The exact route chain is:

```text
Homepage footer
  -> /preview-review.html
  -> /demo-lab/llm-training-simulation.html
```

The footer and review-page links are ordinary, visible HTML anchors. They do
not use hidden text, off-screen positioning, zero dimensions, transparency,
`aria-hidden`, or other deceptive discovery techniques.

## Files created

```text
frontend/preview-review.html
frontend/preview-review.css
scripts/verify-preview-review.ps1
tests/preview-review-access.test.js
docs/preview-review-access-completion-report.md
```

## Files modified

```text
backend/app.py
frontend/index.html
frontend/styles.css
frontend/sitemap.xml
frontend/demo-lab/llm-inference-capabilities.html
frontend/demo-lab/llm-training-simulation.html
frontend/llm-training-lab.css
frontend/llm-training-lab.html
tests/cyber-lab-integration.test.js
tests/llm-integrated-v1.test.js
tests/llm-response-ranking.test.js
tests/llm-training-lab.test.js
```

## Indexing protections

Both review routes contain:

```html
<meta name="robots" content="noindex, nofollow, noarchive">
```

The existing Quart website server adds this exact response header for both
routes:

```text
X-Robots-Tag: noindex, nofollow, noarchive
```

Neither route is blocked by `frontend/robots.txt`, allowing external review
systems to retrieve the actual HTML and observe the noindex instructions.

The simulator and review index are absent from `frontend/sitemap.xml`.
The simulator remains absent from the Demo Lab directory, primary navigation,
homepage promotional sections, structured-data lists, and feeds. Direct
simulator links were removed from the inference-capability page and the legacy
compatibility redirect, leaving the review index as the sole ordinary HTML
anchor to the simulator.

## Static HTML availability

`frontend/preview-review.html` is meaningful without JavaScript and includes:

- the requested document title and H1;
- an explanation of the incomplete, unreleased review status;
- a standard link to the private-preview simulator;
- an ordinary homepage link; and
- responsive dark/light styling, including a no-JavaScript
  `prefers-color-scheme` fallback.

The simulator's initial HTML already contains its title, H1, introduction, six
workflow labels, and homepage navigation. It now also includes canonical
metadata and the static breadcrumb:

```text
Preview Review Access -> LLM Training Laboratory
```

Authentication, cookies, JavaScript execution, referrer headers, special user
agents, query parameters, CAPTCHA completion, and browser-local state are not
required to retrieve either HTML document.

## Automated verification

Targeted review-access and integration tests:

```text
node --test tests/preview-review-access.test.js tests/llm-training-lab.test.js tests/llm-integrated-v1.test.js tests/llm-response-ranking.test.js tests/cyber-lab-integration.test.js
60 passed
0 failed
```

Complete frontend regression suite:

```text
node --test tests/*.test.js
134 passed
0 failed
```

Coverage includes visible-link requirements, prohibited hiding techniques,
the exact inbound route chain, metadata, robots behavior, sitemap and
directory exclusion, structured data, static content, local assets, duplicate
IDs, Quart header configuration, and all existing frontend regressions.

## Production verification commands

After deployment, run:

```bash
curl -I https://www.microcompit.com/preview-review.html
curl -I https://www.microcompit.com/demo-lab/llm-training-simulation.html

curl -L https://www.microcompit.com/preview-review.html
curl -L https://www.microcompit.com/demo-lab/llm-training-simulation.html
```

On Windows PowerShell, the repository also provides:

```powershell
.\scripts\verify-preview-review.ps1
```

Expected production behavior:

- final HTTP status `200`;
- `Content-Type: text/html`;
- no authentication challenge;
- no CAPTCHA;
- no redirect to an unrelated route;
- meaningful title, H1, and explanatory HTML in each response body; and
- `X-Robots-Tag: noindex, nofollow, noarchive` when served by the Quart
  website application.

## Hosting limitation

Route-specific headers are implemented in the repository's Quart website
application. If production serves `frontend/` directly from a separate static
host or CDN that bypasses `backend/app.py`, the HTML meta directives remain
effective, but that host must be configured separately to emit the
`X-Robots-Tag` header. The post-deployment commands above must be used to
confirm which path production uses.

## Security and publication status

No cloud authentication, API key handling, bearer-token behavior, CORS policy,
administrative route, or existing security header was weakened.

No remote push was performed.
