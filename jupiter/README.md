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

## Semantic Form Engine v2

The form layer now follows the parts of the HTML standard that decide what a
browser would actually send, because Jupiter was quietly disagreeing with the
browser on real employer pages:

- `<base href>` resolution for form actions and page-script network calls
  (external `<script src>` still resolves against the page URL, because it is
  fetched before the document is parsed, and its same-origin check is tied to
  the page origin on purpose);
- `<fieldset disabled>` propagation, so a switched-off section is neither
  filled, nor submitted, nor counted as a missing required field;
- `<legend>` captured as the section hint of every control inside it;
- `formaction`, `formmethod`, `formenctype` and `formnovalidate` on the pressed
  submit button, which override the form's own attributes;
- `<select multiple>`, which serializes every selected option instead of one;
- browser-style default selection for single `<select>`, and `disabled` options
  that Jupiter will never pick;
- `readonly` controls, which are submitted but never overwritten;
- `type=image` submit buttons, which send the click coordinates;
- constraint attributes: `pattern`, `minlength`, `maxlength`, `min`, `max`,
  `step`.

Submit buttons are ranked by intent, so "Откликнуться" wins over "Сохранить
черновик" in the same form. Document order stays the tie-break.

## Submission safety: evidence and one application per vacancy

Two rules that gate every real submit.

**A click is not a success. HTTP 200 is not a success.** An employer can hand
back the same form with an error and still answer with a 200. `submission.py`
therefore collects weighted `SubmissionEvidence` and confirms only above a
threshold:

| Evidence | Weight | Why |
|---|---|---|
| `APPLICATION_ID` | 0.9 | a number the employer issued |
| `JSON` `accepted/success: true` | 0.85 | an explicit answer from their API |
| `DOM_TEXT` | 0.8 | only when the marker was **absent before** the submit |
| `URL` | 0.75 | redirect to a confirmation address |
| `FORM_GONE` | 0.35 | corroboration only — a login redirect removes the form too |
| `HTTP_RESPONSE` | 0.0 | recorded, never counted |

The score is the strongest piece plus 0.1 per corroborating one, capped at 1.0;
0.8 confirms. The "absent before" condition on `DOM_TEXT` is what stops a site
with "спасибо за отклик" in its footer from confirming everything.

**One application, once.** `ApplicationFingerprint` hashes candidate, employer,
canonical vacancy URL, apply URL and the form signature. Canonicalisation drops
`utm_*`, `gclid`, `yclid`, `fbclid` and friends, so the same vacancy reached
through a campaign link is the same application. The fingerprint is checked
*before* the POST; a known receipt returns `duplicate` with
`DUPLICATE_BLOCKED` and nothing is sent.

**Unknown outcome is its own state.** `EngineTransportError` separates "the
connection dropped" from "the server answered 4xx". A dropped POST may have
landed, so Jupiter records a `submission_unknown` receipt, verifies once with a
GET — which creates nothing and is safe to repeat — and never re-POSTs. A later
run over the same fingerprint stays `submission_unknown` until verification
says otherwise.

Receipts live in `ReceiptStore` (a JSON file via `--receipts`, in memory
otherwise). Without a file the duplicate guard only lasts one run, which is not
enough: the second attempt usually happens a day later.

## SPA pages: reading the state instead of rendering it

On a React/Next/Nuxt page the initial HTML holds an empty root and no link to
the application form — the browser draws it. Jupiter used to call that
`UNSUPPORTED_SCRIPT` and stop, while the address was sitting in the markup in
plain text.

`spa_payload.py` reads the JSON that the page already ships:

- `<script id="__NEXT_DATA__">`;
- `<script type="application/ld+json">` (JobPosting and friends);
- any `<script type="application/json">` data block;
- `window.__NUXT__` / `__INITIAL_STATE__` / `__APOLLO_STATE__` when the value
  is a real JSON object. When Nuxt ships a function there instead, it is
  skipped — executing it is precisely the arbitrary JS Jupiter does not have.

URLs found this way become extra navigation candidates, ranked by the same
apply-intent scoring as ordinary links, with the JSON key path used as the
hint: `applyUrl` shows intent where the address alone shows nothing. A plain
`<a href>` wins ties, because a human can see it too.

**This is not rendering.** If the address is not in the state, the answer is
the same honest dead end as before — but the trajectory now says which payload
kinds were read, so the failure can be told apart from "we never looked".

Two traps this slice had to handle:

- `__NEXT_DATA__` always carries `"page": "/vacancy/[id]"`, a route template,
  not an address. It outscored the real apply link and led to a 404, so values
  holding `[]`, `{}` or `/:param` are rejected.
- a `<script type="application/json">` block was being fed to the script
  interpreter as a program, which marked every Next page as unsupported
  JavaScript. Per the standard only an absent or JavaScript `type` executes.

State is untrusted employer data, never permission: a URL from it passes the
same host allow-list as any other, and a hostile `<base href>` cannot turn a
path into a `file://` address.

## Multi-step form planner

"Next" is not "Submit". Jupiter now classifies every submit-type control by
intent — `apply`, `next`, `back`, `save` — and a `FormFlow` tracks which step
of the form it is on.

What this changes:

- clicking a step button is recorded as `click_next` / `http_step`, never as
  `click_submit` / `http_submit`, so an application is only ever counted once;
- a step is identified by where its form posts and which fields it holds, not
  by the page URL, which the POST itself changes. If the same step comes back,
  Jupiter stops with `STEP_DID_NOT_ADVANCE` instead of resubmitting it;
- in dry-run a multi-step form returns the status `step_ready` with reason code
  `MULTI_STEP_DRY_RUN_LIMIT`, not `ready_to_submit`. Walking further needs a
  real POST, and the read-only engine forbids one. Reporting readiness after
  filling the first screen of three was exactly the false success dry-run
  exists to prevent.

The word lists that separate "Далее" from "Отправить" are deliberately short.
A wide list is dangerous in one specific direction: it would mark a real submit
button as intermediate, and the application would never be sent.

## HTML validation before submit

`validation.py` answers one question: would the browser let this form go?
It implements the standard constraint validation rules — required (including
radio groups), `pattern` anchored to the whole value, length, range, step and
the `email`/`url`/`number` input types — and returns `ValidationIssue`
records instead of a boolean.

This closes the worst kind of failure Jupiter had: reporting
`ready_to_submit` for a form the employer's page would have refused. A form
that fails validation now returns `action_required` with reason code
`VALIDATION_FAILED` and the list of offending fields.

`AgentResult` carries a machine-readable `reason_code` alongside the human
text: `CAPTCHA_REQUIRED`, `MISSING_PROFILE_FIELD`, `VALIDATION_FAILED`,
`DOMAIN_BLOCKED`, `UNSUPPORTED_SCRIPT`, `SUCCESS_NOT_CONFIRMED`,
`NAVIGATION_FAILED`, `SUBMIT_FAILED`, `VACANCY_NOT_FOUND`, `MAX_STEPS`,
`MULTI_STEP_DRY_RUN_LIMIT`, `STEP_DID_NOT_ADVANCE`, `DUPLICATE_BLOCKED`,
`SUBMISSION_UNKNOWN`.
Compatibility statistics must be built on the code, not on the prose.

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
python test_form_semantics.py
python test_spa_payload.py
python test_submission.py
python test_e2e.py
```

`test_form_semantics.py` needs no server: it checks HTML form semantics and
constraint validation directly.

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
18. blocking cross-origin external scripts;
19. no-submit filling on CAPTCHA forms;
20. resume-file alternatives for required resume URLs;
21. server-rendered React/Next form filling without submit;
22. unknown required fields still stop dry-run;
23. hard read-only rejection of direct POST;
24. audited field patterns for VkusVill, Lemana PRO, Teremok, Coffeemania,
    Dodo and MegaFon;
25. controls linked with the HTML form attribute and required radio groups;
26. the apply button winning over a draft button, with its `formaction` used;
27. a relative action resolved through `<base href>`;
28. required fields of a disabled fieldset not blocking the run;
29. a value rejected by `pattern` stopping before submit;
30. `<select multiple>` sending every selected option;
31. a three-step form walked to the end and submitted exactly once;
32. dry-run reporting a step instead of readiness on a multi-step form;
33. a single-step form still reporting `ready_to_submit` in dry-run;
34. a step that returns itself being reported instead of resubmitted;
35. an apply link taken from `__NEXT_DATA__` when the markup has none;
36. embedded state without an application link staying an honest dead end;
37. state being unable to send Jupiter to a host outside the allow-list;
38. a JSON data block not being treated as a program;
39. the same application never being sent twice;
40. a campaign link not defeating the duplicate guard;
41. a receipt surviving between runs through a file;
42. a dropped connection becoming `submission_unknown`, never a retried POST;
43. HTTP 200 with the same form back not counting as a submitted application.

CI runs the same suite on every PR.

## Private lab

The lab is intentionally absent from the normal JobToo UI and is available at:

`https://jobtoo.ru/jupiter/`

It accepts the same phone/password as JobToo and then allows only the existing
JobToo admin account. A successful login creates a short-lived Secure HttpOnly
Jupiter cookie.

The lab includes native HTTP submission, a local DOM-only script submit,
a FormData network submit, a modern same-origin external-script + JSON + CSRF
scenario, and an unknown required question. It also has an admin-only Live
dry-run field for real vacancy/application URLs from the 62 audited employers.
That live path always constructs Jupiter with dry_run=True/read_only=True:
navigation and GET assets are allowed, but form submission and mutating script
requests are blocked by the engine even if planner logic regresses. After a run
the lab displays the semantic page snapshot and the full Jupiter trajectory.

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
