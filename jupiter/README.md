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
- maps fields to the structured JobToo candidate profile, including names,
  patronymic, birth date, phone/email, city, citizenship, education, desired
  role, employment, resume/link, cover letter, car ownership and explicit
  consent flags;
- uploads a resume with native multipart/form-data encoding;
- submits GET/POST forms directly;
- follows multi-step HTML forms;
- refuses to invent required candidate data;
- stops on CAPTCHA;
- requires an explicit success marker after submission;
- records the complete action trajectory;
- supports a hard no-submit dry-run mode that fills and uploads but never sends
  an application.

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

This is enough for simple script-rendered forms and submit handlers. Jupiter can
also load same-origin external script files through the engine's allow-list,
content-type checks and 256 KiB script limit. Arbitrary code execution, timers,
WebSocket, storage and window navigation remain unsupported. When unsupported
behavior is required, Jupiter returns action_required instead of silently
falling back to Chromium.

## Jupiter Network Runtime v1

Network access from page scripts is a narrow capability owned by Jupiter, not
general browser networking. The supported subset is:

- literal-URL fetch with GET/POST;
- FormData(form), URLSearchParams(new FormData(form)) and controlled
  JSON.stringify(Object.fromEntries(new FormData(form))) bodies;
- literal safe headers plus CSRF/XSRF values read from same-page meta tags;
- response.ok and response.json() boolean-field success branches;
- XMLHttpRequest open/send with literal GET/POST URLs and FormData;
- the same JobToo cookie jar used by the native HTTP engine.

Every script request is resolved relative to the current page and passes through
the engine host allow-list and redirect policy. Computed URLs, arbitrary request
bodies, unknown HTTP methods and unsupported network programs stop safely.
Responses are capped in size and do not become navigation automatically.
Script-request headers are restricted to Accept, Content-Type, X-CSRF-Token,
X-XSRF-Token and X-Requested-With; Host, Cookie and authorization headers cannot
be injected by page code.

## Runtime dependencies

The agent code uses only Python's standard library. requirements.txt is kept as
an explicit declaration and is intentionally empty of third-party packages.

The container uses a plain Python image and runs:

`python test_server.py`

There is no browser installation step.

## Safety

Each Jupiter run gets an explicit host allow-list. Redirects and form actions
cannot escape it. URLs with embedded credentials are rejected.

CAPTCHA solving/bypass is intentionally absent. In normal mode a CAPTCHA stops
before submission. In --dry-run mode Jupiter is allowed to fill the rest of the
form first, then reports the CAPTCHA as a remaining human step. Unknown required
questions return action_required and are never fabricated.

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
11. allow-listed fetch + FormData with shared cookies;
12. XMLHttpRequest + FormData;
13. blocking script fetch when it tries to escape the allow-list;
14. redirect blocking when navigation tries to escape the allow-list;
15. same-origin external script loading;
16. JSON form submission with CSRF meta token;
17. response.json() gating before DOM success;
18. blocking cross-origin external scripts.

CI runs the same suite on every PR.

## Private lab

The lab is intentionally absent from the normal JobToo UI and is available at:

`https://jobtoo.ru/jupiter/`

It accepts the same phone/password as JobToo and then allows only the existing
JobToo admin account. A successful login creates a short-lived Secure HttpOnly
Jupiter cookie.

The lab includes native HTTP submission, a local DOM-only script submit,
a FormData network submit, a modern same-origin external-script + JSON + CSRF
scenario, and an unknown required question. After a run it displays the semantic page snapshot and the
full Jupiter trajectory.

The lab service binds only to 127.0.0.1 on the host, nginx sends
noindex/nofollow/noarchive, and the Jupiter engine inside the lab is allowed to
visit only 127.0.0.1.

## Next slice

After these v1 runtimes are stable, the next compatibility work is controlled
JSON field projections, CSRF hidden-input skills, multi-step SPA state machines,
and site-specific skills. The agent API does not
need to change: Planner and policy operate on Jupiter's semantic page model,
not on a Chromium-specific API.


## Employer compatibility registry

`site_compat.py` contains the 62 employer sources from the JobToo audit. The
registry does not integrate with employer ATS APIs. It only gives Jupiter
browser-navigation policy for explicitly observed apply hosts and semantic
overrides for non-standard field names such as `JOB_POLICY_AGREE`,
`agreedPersonalData`, `resumeFiles`, `brief` and similar controls.

Known third-party apply destinations are allow-listed only per originating
employer. Arbitrary cross-domain navigation remains blocked.

## No-submit verification

Use:

`python agent.py --url <vacancy-or-apply-url> --profile profile.json --dry-run`

A successful verification returns `ready_to_submit`. The trajectory must
contain `ready_to_submit` and must not contain `click_submit`,
`http_submit`, `script_submit` or `script_network_submit`.
