# Jupiter Web Engine

Jupiter is JobToo's own application agent for external job applications.

The current runtime has no Chromium, Playwright, Selenium, external AI service,
or ATS integration. The HTTP client, cookie jar, HTML/form parser, field
mapping, multipart upload, navigation policy, submit flow and success
verification live in this repository.

## What Jupiter Web Engine v1 does

- opens HTTP/HTTPS pages with a strict host allow-list;
- validates every redirect against the same allow-list;
- stores and replays cookies;
- parses HTML forms, labels, inputs, textareas, selects and buttons;
- builds a machine-oriented semantic page state instead of relying on pixels;
- maps fields to the structured JobToo candidate profile;
- uploads a resume with native multipart/form-data encoding;
- submits GET/POST forms directly;
- follows multi-step HTML forms;
- refuses to invent required candidate data;
- stops on CAPTCHA;
- requires an explicit success marker after submission;
- records the complete action trajectory.

## Jupiter Script Runtime v1

The engine now includes a JobToo-owned, deterministic DOM scripting layer. It
does not embed a general-purpose browser or JavaScript VM.

The supported subset covers:
- document.getElementById and #id querySelector bindings;
- innerHTML, textContent/innerText, value and hidden mutations;
- insertAdjacentHTML("beforeend", ...);
- setAttribute/removeAttribute;
- submit addEventListener callbacks;
- preventDefault.

This is enough for simple script-rendered forms and submit handlers. Unsupported
or network-capable page APIs such as eval, timers, fetch/XHR, WebSocket,
storage, window navigation and external script bundles are never executed.
When they are required and no safe HTML form is available, Jupiter returns
action_required instead of silently falling back to Chromium.

## Runtime dependencies

The agent code uses only Python's standard library. requirements.txt is kept as
an explicit declaration and is intentionally empty of third-party packages.

The container uses a plain Python image and runs:

`python test_server.py`

There is no browser installation step.

## Safety

Each Jupiter run gets an explicit host allow-list. Redirects and form actions
cannot escape it. URLs with embedded credentials are rejected.

CAPTCHA solving/bypass is intentionally absent. Unknown required questions
return action_required and are never fabricated.

The private lab keeps its synthetic employer pages reachable only from
loopback, so the lab cannot submit to a real employer.

## Tests

Run locally with only Python:

```bash
cd jupiter
python test_e2e.py
```

The E2E suite starts a local synthetic employer server and verifies:

1. cookie handling;
2. semantic HTML/form parsing;
3. candidate field mapping;
4. multipart resume upload;
5. real HTTP form submission;
6. explicit success verification;
7. stop-before-submit on an unknown required visa question;
8. a form rendered by Jupiter Script Runtime and then submitted normally;
9. a submit handler intercepted by Jupiter Script Runtime with preventDefault;
10. explicit handoff on unsupported JavaScript;
11. redirect blocking when navigation tries to escape the allow-list.

CI runs the same suite on every PR.

## Private lab

The lab is intentionally absent from the normal JobToo UI and is available at:

`https://jobtoo.ru/jupiter/`

It accepts the same phone/password as JobToo and then allows only the existing
JobToo admin account. A successful login creates a short-lived Secure HttpOnly
Jupiter cookie.

The lab shows three synthetic scenarios: native HTTP form submission, a
JavaScript submit handler executed by Jupiter Script Runtime, and an unknown
required question. After a run it displays the semantic page snapshot and the
full Jupiter trajectory.

The lab service binds only to 127.0.0.1 on the host, nginx sends
noindex/nofollow/noarchive, and the Jupiter engine inside the lab is allowed to
visit only 127.0.0.1.

## Next slice

After v1 is stable, the engine can grow its own controlled JavaScript/DOM
execution layer and site-specific compatibility skills. The agent API does not
need to change: Planner and policy operate on Jupiter's semantic page model,
not on a Chromium-specific API.
