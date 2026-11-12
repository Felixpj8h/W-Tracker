# AI coach topic classification

Gemini remains the conversational model. The backend uses the official
`typesafe-sdk` Python package and typed `Choice`/`Noul` questions in `system_one`
to classify independently. No classification JSON is requested from Gemini.
This change is local work; it has not been deployed.

## Settings

Set `TYPESAFE_API_KEY` in the root `.env` for local development or the backend
service environment for deployment. Keep it separate from `GEMINI_API_KEY`.
The backend loads `.env`; Compose, Render and the phone preview script pass the
classifier settings. Never use frontend `VITE_` variables for either secret.

| Setting | Initial value | Meaning |
| --- | --- | --- |
| `TYPESAFE_MODEL` | `jev-latest` | Classifier model; pin a model for repeatable evaluations |
| `TYPESAFE_SAFE_MAX` | `0.3` | Largest safe probability for each independent hazard |
| `TYPESAFE_BLOCK_MIN` | `0.7` | Inclusive blocking probability for any hazard or `out_of_scope` option |
| `TYPESAFE_TOPIC_MIN` | `0.7` | Inclusive minimum combined probability across allowed categories; selected category must also be allowed |

These values are provisional and have **not** been calibrated against real Jev
results for Jern. For a Noul, `noul` is the probability itself. For a Choice,
the application sums allowed categories in `probabilities`, not `confidence`. A hazard above
the safe maximum but below the blocking minimum yields `uncertain`. Exactly
0.3 is safe; exactly 0.7 blocks a hazard. Missing/invalid distributions or
probabilities are technical failures. An `unclear` selection or an insufficient
allowed-topic probability is uncertainty, not unavailability.

## Scope and decisions

Both directions use training, nutrition, recovery, fitness-related health,
courtesy/application help, out-of-scope and unclear categories. Allowed content
includes sports training, workout routines, fitness progress, nutrition/recipes,
calories/macros, hydration/supplements, recovery/sleep/fatigue/soreness, general
health education directly connected to fitness or nutrition, brief greetings,
thanks, and help using workout features. Courtesy/help also includes questions
and explanations about the coach's purpose, capabilities, limitations, supported
topics, example requests and usage, including contextual follow-ups after a refusal
or clarification. Jev assesses their meaning; there is no phrase allowlist and
no requirement to explicitly mention fitness. These help questions do not permit
unrelated tasks, coding assistance or instruction overrides.

Short coaching requests such as "Suggest improvements to my weekly plan" are
interpreted in Jern's workout context unless the message or recent context
identifies another subject. Explicit unrelated requests retain their own meaning.
Confidence split across allowed subjects (for example training and recovery)
counts toward the same scope threshold; independent hazard checks still apply.

General health education is allowed without an exercise connection. The coach
gives broad possible contributors, avoids diagnosis and recommends a doctor for
persistent or worsening symptoms. Urgent-care advice is conditional on serious
warning signs. This applies to both input and output screening; it does not
permit unrelated tasks or programming help.

Intermediate tool-only generations are screened using the tool operations,
their complete arguments and the accepted request supplied as untrusted context.
Empty reply text during a tool step is normal. No operation name or previously
accepted request bypasses the independent hazard checks. Topic thresholds are
unchanged. On uncertain output the full generation is discarded and regenerated
once before any calls run or text is released. A second uncertain output returns
an internal response-failure message, rather than asking the user to clarify a
request that already passed input screening. Blocked output is refused without
retry; truly unclear input still receives a clarification.

Input screening receives the complete preceding chat for short conversations,
bounded to the latest 32 completed messages and 24,000 content characters for
longer chats. The latest request is a separate field; later messages are excluded.
It also receives up to three recently displayed proposal cards from this owned
conversation, including operation, status, summary, reasoning and payload, bounded
to 24,000 serialized characters. Oversized cards are marked as truncated excerpts.
Only proposals attached to completed assistant messages preceding the exact request
are eligible, including when retrying an older request. Undisplayed cards and cards
from other conversations are excluded. History and cards resolve references such
as "what's the science behind this?"; they never authorize instructions, repeat
previous refused tasks, or excuse a new coding or mixed-topic request.

Any substantive unrelated portion blocks the entire checkpoint. Software
programming help, code generation, debugging, scripts, pseudocode and programming
explanations are excluded even for fitness apps or workout calculators. Ordinary
arithmetic, nutrition calculations, workout tables and the app's workout tools
remain allowed. An allowed primary category never cancels an independent
software, out-of-scope, or instruction-override signal.

| Outcome | Application behavior |
| --- | --- |
| `allow` | Continue to generation, execution or release |
| `block` | Stop and return a fixed short refusal |
| `uncertain` | Stop and ask a fixed short clarification question |
| `unavailable` | Continue under the user's selected technical fail-open policy; log degraded enforcement |

Missing/invalid credentials, authentication/permission errors, rate limits,
timeouts, connection/SDK errors and malformed responses all use the technical
fail-open policy. They never become an assertion that content is safe. This
configuration cannot guarantee that unrelated content will never be released.

The SDK has a 3-second HTTP timeout, one retry after the initial attempt,
0.1-second initial backoff capped at 0.2 seconds, and a 7-second retry budget.
Server Retry-After delays are disabled to keep waits bounded. The retry budget
controls retry scheduling; HTTP phases and an in-flight attempt can outlast that
budget. Cancellation is checked before and after blocking calls and before
each tool execution or emitted text chunk; it does not abort an in-flight
synchronous provider/SDK call.

## Backend checkpoints

1. Check the exact user message and up to two recent completed messages before
   Gemini, snapshot tools or model-directed tools run. Context is bounded to
   2,000 characters per earlier message and used only for references such as
   “yes”. Explicit new fitness questions are assessed independently of earlier
   unrelated requests. Conversation and message ownership are checked first.
2. Buffer each complete Gemini generation, including its text, steps and every
   proposed tool call. Classify all fields together in one Jev request before
   any text delta, model-directed execution, or proposal persistence. One bad
   call prevents all calls in that generation. Existing proposal confirmation,
   retry and ownership rules remain in force.
3. Screen generated conversation summaries before storing them. Summaries,
   messages, routine names, notes and tool results remain untrusted context.

Each checkpoint batches one Choice and three independent Nouls into one request.
Input questions assess what the user requests. Output questions assess what the
coach actually supplies; a short refusal mentioning coding is permitted.
Rejected generated content is never streamed, saved to chat history/proposals,
or included in application logs. Only fixed application refusal/clarification
text is persisted for those outcomes. Incoming user messages are still kept in
their conversation as before. Existing stored content is not retroactively
classified or removed.

Logs contain stage, category, option/hazard probabilities, decision, model,
failure type, and degraded-enforcement status. Raw chat/health content, exception
bodies and secrets are omitted. The classifier service receives the content it
must assess; evaluate its external data handling before operational use.

## Verification

Run backend checks from `backend`:

```text
python -m pytest -q
```

Automated policy tests mock the TypeSafe SDK's documented interface and responses.
They verify batching, decision precedence and thresholds, multilingual/contextual
fixtures, withheld output, proposal persistence, valid proposals, cancellation,
ownership and technical failure handling. They do not establish actual Jev
accuracy. Existing provider retry and proposal-confirmation tests also run.

The separate evaluation uses 44 synthetic examples, no user health/chat data,
no Gemini calls, and no database writes. It makes paid TypeSafe calls only when
explicitly invoked:

```text
python evaluate_topics.py --live
```

It prints example IDs, expected/actual decisions, probabilities, false-positive
and false-negative counts/rates, and uncertainty/unavailability counts.
A false positive is a blocked allowed example. A false negative is a prohibited
example released as `allow` or `unavailable`. Allowed-but-uncertain examples are
reported separately as friction. Degraded runs exit with code 2 and must not be
presented as real model accuracy. Review results per stage, expand the corpus,
calibrate thresholds and rerun after model changes. No live accuracy numbers
are claimed from mocked decisions.

Dependency installation/lockfile resolution could not run in the editing
environment because PyPI DNS was unavailable. New lock entries were copied from
published PyPI hashes and checked against upstream dependency metadata, preserving
existing pins. Regenerate both locks using the README commands and verify a
hash-checked installation in Linux/Python 3.12 before deployment.

Local verification on 11 November 2026: 106 focused backend policy/provider
checks passed (one installed-SDK contract check was skipped); 13 frontend coach
tests, the production frontend build, lint, deployment YAML checks, the phone
preview script syntax check and `git diff --check` passed. Lint
and the build retain pre-existing warnings. The local Python 3.14 runner needed
the optional native `greenlet` import disabled for synchronous SQLAlchemy tests.
The broader API suite could not complete: Windows denied the initial temporary
database path, and a workspace-temp rerun hung in Python's asyncio socketpair
initialization before reaching application code. Docker engine access was also
denied. Run the full backend suite
with the locked Linux/Python 3.12 environment. The paid live evaluation was not run.

Local verification on 12 November 2026: 144 focused backend policy/provider
checks and 17 frontend coach checks passed. The frontend build and lint passed
with existing warnings. The full frontend suite had 157 passes and one failure
in the unchanged dashboard swipe test (expected one page-change callback, got two).
All three dashboard tests passed on an isolated rerun, indicating a timing-sensitive
failure under the full suite.

All eight requested acceptance prompts were also exercised sequentially through
the real coach turn generator, Jev classifier and Gemini with synthetic empty
training context and read-tool results. Storage was captured in memory; no
account records or proposals were changed. The implicit weekly-plan request
received a practical schedule; the protein reply stated 128 g and emitted
unescaped display math; the headache reply gave possible contributors, avoided
diagnosis and recommended a doctor for persistent or worsening symptoms. Coding,
the mixed weekly-plan/laptop request and the SQL-injection role override were
blocked before generation. Both capabilities questions answered normally after
those refusals. No checkpoint reported degraded enforcement. These are single
live samples, not a general accuracy estimate or a browser end-to-end test.
Renderer tests separately verified the exact supplied TeX example and multiline
math produce KaTeX/MathML, with readable plain-text results and existing Markdown
safety preserved. Backend checks verified math survives screening, streaming and
storage unchanged.

Follow-up verification on 12 November 2026 addressed a reproduced false positive:
tool-only output had received only 0.57 training probability and triggered the
user-facing clarification despite an accepted input. With contextual tool-step
screening, the final live regression run passed 15/15 checks: three repetitions
each of weekly-plan, routine and training-summary reads (all allowed with 1.00
training probability), generated code in a search argument (blocked), and a
mixed read/proposal batch containing laptop advice (blocked). An initial adversarial
run withheld the code argument as uncertain; the final instructions explicitly
cover generated programming inside string arguments and all repetitions blocked it.

The actual coach turn generator then passed ten sequential live synthetic turns:
the original eight acceptance prompts plus two repeated explicit weekly-workout
plan requests. The conversation began with the old clarification message in its
history. Weekly-plan advice completed, including read-tool steps, and all original
boundaries held; no proposals ran or account records changed. All 153 focused
backend policy/provider tests passed, including bounded regeneration, rejected
batch non-execution and output-specific failure messaging. These controlled live
checks still do not establish universal classifier accuracy or constitute a
browser end-to-end test.

Conversation-context verification on 12 November 2026: 164 focused backend
policy/provider tests passed. Tests cover preserving complete short chats,
message/character limits, proposal payloads, oversized-card excerpts, ownership,
and exclusion of future messages and undisplayed or other-conversation cards.
The final live Jev run passed 21/21 proposal-follow-up checks (seven cases repeated
three times), including the science question, exercise rationale, old refused
requests, injected proposal text and new coding or mixed-topic requests.

Five live backend turns also exercised the actual context builder and coach
generation against a synthetic proposal in an in-memory database. The science
question and exercise follow-up were answered, coding and laptop requests were
refused, and a subsequent capabilities question was answered. The pending
proposal remained pending, no additional proposals were created, and no routines
were applied. These checks verify routing and context, not the scientific accuracy
of generated training advice; no browser or production account data was used.

References: [quickstart](https://docs.typesafe.ai/introduction/quickstart),
[Python SDK](https://docs.typesafe.ai/sdk/python),
[LLM guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails),
[confidence vs probability](https://docs.typesafe.ai/confidence),
[retry configuration](https://docs.typesafe.ai/sdk/python/api/retries).
