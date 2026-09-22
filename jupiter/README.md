# Jupiter MVP

Jupiter is JobToo's own browser agent for external job applications.

The first MVP intentionally has **no GPT/Yandex/GigaChat integration**. The browser, field understanding, decisions, safety boundary and trajectory logging are all owned by JobToo.

## What it does

- opens a career page in Chromium;
- observes `input`, `textarea`, `select` and `button` controls plus labels/ARIA/name attributes;
- maps fields to a structured candidate profile using Jupiter's semantic rules;
- fills text/select fields and uploads a resume;
- refuses to invent required data: an unknown required question returns `action_required`;
- submits only after required fields are satisfied;
- recognizes explicit success markers after submit;
- records the full action trajectory for debugging and later training data.

## Safety

Jupiter will not visit arbitrary hosts. Each run receives an explicit host allow-list. CAPTCHA solving/bypass is intentionally absent.

## Test

Install:

```bash
python -m pip install -r jupiter/requirements.txt
python -m playwright install chromium
```

Run:

```bash
cd jupiter
python test_e2e.py
```

The E2E suite uses `test_site.html` as a synthetic careers page and verifies two cases:

1. Jupiter fills the form, uploads a resume, submits it and detects `Application received`.
2. A required question not present in the candidate profile (visa sponsorship) stops the agent with `action_required` and **does not submit**.

The tests use `page.set_content()` so they also run in locked-down CI environments that block localhost navigation. Production `JupiterAgent.run()` navigates to a real URL through Playwright.

## Next slice

Wire the agent into JobToo's application queue with:

`queued -> running -> action_required | submitted | failed`

Then persist the trajectory, screenshots and confirmation metadata. The planner is deliberately isolated so a future self-hosted model can be added only for pages the deterministic rules cannot resolve.
