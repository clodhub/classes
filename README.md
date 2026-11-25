# Component classes

The 39 `<slot>-class/` directories own independent `class.json` contracts, interface documents and shared checks. Both theme providers implement `clodhub/theme-class` with identical class bytes.

- `python3.12 -B classes/generate.py` refreshes inventory hashes, embeds descriptors in all 40 component manifests, bundles the authoritative classes in the recipe, writes exact slot references and updates authoring metadata.
- `categories.json` is the category tree (`{format, categories: [{id, title, parent}]}`); each `class.json` names one of its categories, and `generate.py` refuses a category that is not in it.
- `python3.12 -B classes/render_images.py [COMPONENT ...]` renders each visual component's example images from its `examples/images.ts` in headless Chrome into `images/`, and lists them in the manifest's `images`.
- `python3.12 -B classes/check_local.py` exercises source checkouts for authoring feedback. Package review runs the same scripts through aepm's trusted runner in fresh staged candidates.
- `python3.12 -B classes/prove_defect.py` checks declared fit with an independent provider document, then proves that a colour-override defect fails the shared theme suite and prevents guardian signing.

Checks import public modules through `AEPM_MODULE_MAP`. Browser stylesheets are omitted from Node imports; stylesheet declarations and full application rendering have separate checks. Class inventories bind every shared script and interface file.

## Behaviour checked

| Class | Shared behaviour |
|---|---|
| android-host | Deterministic project rendering, package identity, minimum operating-system level, complete lock/checksum delivery, rejection before writes for missing or mismatched inputs, invalid settings and language selection |
| apple-host | Target selection, deterministic project rendering, iOS destinations, excluded television resources and invalid identifiers |
| card-deck | Card uniqueness, dealing conservation, input immutability, exhaustion, jokers, card names and client facts |
| card-graphics | Face and back models, colour, pip counts, invalid cards, flip endpoints, sizing and deal timing |
| chip-graphics | Amount conservation, denominations, colour overrides, flight endpoints, interpolation and unchanged bets |
| chip-ledger | Wager and settlement conservation, side pots, folded eligibility, immutable inputs, odd chips, invalid amounts, export/import and tamper detection |
| computer-players | Mode-derived behaviour, filling seats, stable identities, absent-player decisions, deadlines, isolated strategy memory and invalid settings |
| controls | Accessible names, disabled buttons, toggles, dialog Escape/close lifecycle, formatting and help-section normalization |
| display-mode | Capture/action/private-view restrictions, mode state and emitted event |
| fair-shuffle | Seeded determinism, bounded random values, permutation conservation, input immutability and invalid inputs |
| game-clock | Selective clocks, backward time, freezing, decision deadlines, timeout actions and client countdown formatting |
| guest-identity | Name ownership, token replacement, authentication, immutable input, invalid names and portable records |
| guided-tour | Lesson queue, translated text, held state, completion, saved progress, reset and invisible anchors |
| holdem-rules | Blind posting, turn restrictions, private cards, uncontested settlement, chip conservation, immutable hands, client bet bounds and all-in decisions |
| invitations | Link round-trip, code normalization, invalid addresses/codes, clipboard delivery and unavailable sharing |
| level-schedule | Time boundaries, extension, stopping, remaining time, invalid schedules and immutable input |
| ourapps-release | Target selection, secret-reference names, deterministic workflow selection and unset store credentials |
| poker-hand-ranking | Categories, ace-low straight order, suit-independent ties, shared winners and invalid hand size |
| poker-odds | Starting scores, exact one-card probability, river certainty, row caching and incomplete-hand results with class-owned card facts and a fixed ranking oracle |
| poker-strategy | Strong-hand calls, weak-hand folds, unusable observations, fresh memory, counted calls/folds and invalid aggression |
| preferences | Persistence, subscriptions, unsubscribe, defaults, reset, portable choices and missing devices |
| presence | Connection loss/return, missed turns, manual pause, invalid timeouts and immutable state |
| private-views | Owner visibility, public card indexes, concealed notes, input immutability, stale views and mode separation |
| realtime-rooms | Connection idempotence, protocol address, greeting, parsed messages, invalid messages, send and deliberate close with class-owned socket doubles |
| room-directory | Immutable insertion/removal, code lookup, entry capacity and portable room records |
| round-history | Bounded records, order, totals, immutable input, invalid sequence, export/import and tamper detection |
| rules-settings | Value types, bounds, closed objects, parse failures, frozen results and nested lookups |
| seating | Capacity, duplicate names, start eligibility, removal, immutable input and portable seats |
| server-host | Origin policy, normalization, invalid providers, request forwarding and accepted-origin propagation |
| sound-cues | Event order/delay, unknown events, invalid manifests, path traversal rejection and mute preference precedence |
| store-update | Version ordering, unavailable updates and invitation address parsing |
| table-layout | Seat bounds, screen orientation, relative positions and deterministic geometry |
| theme | Token shape, named/unknown theme selection, immutable colour overrides, invalid colours, deterministic rendering, applied variables, compiled Swift colour parity, fallback and overrides |
| tournament | Entry stacks, rebuy deadlines, held clocks, chip issuance, elimination, winner/places, portable state and result presentation |
| translations | Regional language fallback, missing text, language order and invalid/duplicate languages |
| turn-engine | Lobby creation/joining, presence registration, capacity/refusal propagation, immutable state, state validation, timing and disabled-computer behaviour |
| video-calls | Signed grants, identity, room prefix, publish restrictions, lifetime and missing credentials |
| web-host | Deterministic manifest rendering, supplied colours, application identity, invalid settings and installable head tags |
| windows-desktop | Trusted pages, external origins, sandbox flags, player-only capture and required interaction |

These are behavioural checks of the listed operations. Complete betting/showdown combinations and full turn-engine round cycles belong to the recipe and provider tests. The shared theme suite compiles and executes Swift values for both providers. Native drawing, browser pixels, operating-system permissions, live video and Windows execution are outside the class suites. No class has an export-count-only suite.

## Source declarations

`upstream/` retains supplied upstream documents and exact dependency identities used by the metadata generator. npm uses package-lock version 3 package paths and integrity; Swift uses format-3 resolved source revisions; Gradle uses configuration locks and artifact checksums. Original licence documents and licence declarations remain distinct from wrapper notices. `PROVENANCE.md` in each package describes its supplied evidence.

Stylesheet namespaces identify actual selectors and properties, plus global keyframe names. Themes intentionally assign page-wide variables; the recipe reads those variables rather than assigning the same token properties.
