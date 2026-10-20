# Writing content

Everything a player reads lives in this folder, in YAML: one file per Venture in `ventures/`,
the Editor's two dictionaries in `glossary.yaml`, the Origins in `origins.yaml`, and the run's
numbers (Upkeep, lodging, the turn, the start date) in `settings.yaml`. The engine never needs touching to change
a word, a price or a consequence.

You can edit any file directly on github.com (open it and press the pencil). Claude builds and
checks the pages afterwards. If you edit in VS Code with the YAML extension, the schema in
`schema/` gives you autocompletion and underlines mistakes as you type.

## The shape of a Venture

```yaml
id: heath                      # the file name, without .yaml
title: The Heath by Moonlight
runhead: …                     # the running head: the title of the hero's memoir
sub: Being a Night upon …      # the subtitle
prospectus: …                  # the paragraph under the title
year: 1724
week: 42                       # calendar week, 1–52, counted from 1 January
loot_flag: robbed              # a flag set whenever a 'loot' effect runs
persona: Capt. O’Rourke        # shown beside Exposure in the Account
who: { name: …, as: …, origin: … }   # the head of the Ledger
start: { … }                   # the hero's state on arrival (see below)
first: approach                # the first beat
chapter: { … }                 # how the chapter heading is written
story: { … }                   # the Story's title, preface and close
reckoning: { … }               # Beat V
beats: [ … ]                   # Beats I–IV
```

### In a run

A Venture is offered in a run only if it has an `offer` block:

```yaml
offer:
  district: Covent Garden        # one of the ten districts, shown on the card
  circle: the Town               # optional: the Quality, the City, the Town, the Trade or the Underworld
  rank: Esquire                  # optional: the Claimed Rank it expects; below it, it is gate-crashed
  blurb: When the playhouses empty, the Town goes on to Tom King’s…
  when: has_persona("Capt") and has_item_like("pistol")   # optional: who may be offered it
  from: { year: 1724, week: 41 }  # optional: only between these dates
  to: { year: 1724, week: 46 }
  weight: 3                      # optional: relative chance of being drawn (default 1)
  weight_when:                   # optional: multiply the weight while a condition holds (Step 10)
    - { when: purse < 240, by: 3 }           # poor heroes are drawn to St Giles
    - { when: played("geneva"), by: 0.5 }    # less often once played
  prophecy: The Moon will stand over a high road…   # optional, for a dated Venture: the Cunning Man's reading
  prophecy_when: origin == "younger-son"           # optional: whom the prophecy is for
  repeat: true                   # optional: may be offered again after it is played
  arrival: true                  # instead: played in the first turn, as an Origin's arrival
kit:                             # optional: lent for this Venture only
  items: [A hired grey prancer, from the Bell in Holborn]
  returned: [A hired grey prancer, from the Bell in Holborn]   # taken back after the Reckoning
test: true                       # placeholder content, marked on the card
```

Each turn the run draws three offers from the Ventures whose conditions hold. A Venture's
`circle` is where it is set: playing it makes the name worn known there, its rumours are that
circle's talk, and it is not offered while that circle is closed after a name was blown. A Venture
with a `rank` can be played below it, but every Exposure gain in it is one worse, and its card
says so. In a run the Venture
starts from the hero as they are, not from its `start` block, which is used only on the Venture's
own page. `who`, `persona` and `start` stay required for that page.

Every Venture has five beats: **Approach, Complication, Turn, Crisis, Reckoning**. The Crisis may
come in variants (heath has `known` and `chase`); its choices are labelled **Press on:** or
**Withdraw:**. A Withdraw option may also appear at the Complication, ending the Venture early.

## A beat

```yaml
- id: lamps
  num: II
  phase: The Complication        # The Approach | The Complication | The Turn | The Crisis
  title: Lamps upon the Hill
  sid: heath.02.lamps            # storylet id, shown in the designer's view
  dev: …                         # designer's notes (blue pencil); optional
  text: |-
    First paragraph.

    Second paragraph. A blank line separates paragraphs.
  notes:                         # the Editor's footnotes, optional
    - "* Sheppard escaped from the Castle … on 15 October 1724."
  ask: What will you do about the outrider?
  options: [ … ]                 # two to four
```

## An option

Each beat offers a mix of the four kinds the design asks for:

```yaml
# Certain: no Wheel
- label: Take post alone in the hollow below the Spaniards toll-gate, and wait.
  do:
    effects: [ … ]
    text: You wait. …
  next: lamps

# Gated: shown to everyone, playable only if the condition holds
- label: Stand Will Gallow a bottle …
  gate: { when: 'has_hook("Will Gallow")', need: "Hook: Will Gallow" }

# Costed: says what it costs on a badge. If the purse cannot pay, the option is locked; the
# price is worked out from a certain option's purse effects, or given as price: 15s
  cost: 2s 6d, and a third of the spoils

# Risky: goes to Fortune's Wheel, with one outcome for each segment
- label: Steady your nerves in the taproom of the Spaniards first.
  check:
    attr: Constitution           # Address | Wit | Nerve | Constitution | Countenance | Learning
    diff: 3                      # 3 easy · 4 standard · 5 hard · 6 desperate
    bonus:
      - { when: flags.wounded, by: -1, why: wounded }
  outcomes:
    T: { effects: [ … ], text: … }   # Triumph
    S: { … }                         # Success
    C: { … }                         # Success at a cost
    R: { … }                         # Reversal
    X: { … }                         # Catastrophe
  story:                             # the Story, written on Triumph and Catastrophe
    T: Our hero, being…              # one passage, in the Story's voice
    X: …
  next: lamps

# Locked: a gate the player cannot meet yet, and no outcome; shown as a lure
- label: Send word to the gang at the Blue Boar for a proper ambuscade.
  gate: { when: notoriety >= 3, need: "Notoriety 3 · you have {notoriety}" }
```

`withdraw: true` adds the Withdraw badge. A certain option that passes a milestone can carry
`story: { M: { sm: …, st: … } }`.

`next` is a beat id, `reckon`, or a list of routes tried in order, the last without a condition:

```yaml
next:
  - { when: flags.sirPistol or flags.outriderArmed, go: chase }
  - { go: known }
```

## Effects

| Effect | What it does |
| --- | --- |
| `{ adj: composure, by: 1, why: … }` | Changes a quality: `purse`, `debts`, `composure`, `luck`, `exposure`, `notoriety`, `celebrity`, or a humour (`hum.Sanguine`, `hum.Choleric`, `hum.Melancholic`, `hum.Phlegmatic`) |
| `{ adj: purse, by: -2s 6d, why: … }` | Money is written as money: `£24`, `10s 6d`, `20 guineas` |
| `{ loot: £38, why: … }` | Money gained as spoils (counted for shares and losses) |
| `{ set: tip }` · `{ unset: will }` | Sets or clears a flag, which later text and conditions can read |
| `{ tag: Gallant (the Quality), why: … }` | A reputation Tag; always names a faction or the Town, and must be in the register (`settings.yaml` under `tags:`). Earning it again renews it; earning it removes its opposite; three per faction at most |
| `{ condition: "Wounded (a ball-graze, left arm)", why: … }` | A wound, disease or Affliction |
| `{ item: …, why: … }` · `{ lose: …, why: … }` | Possessions; `lose_matching: pistol` loses the first item containing the word |
| `{ hook: …, why: … }` · `{ unhook: Betty Slyfield, why: … }` | Hooks, written as a person or thing and why it matters; `unhook` spends the first that starts with the words given |
| `rumour: { id, delay, from, text, effect, circle }` | A rumour, delivered 1–3 weeks after the Venture (a week later if the Venture's district is not the hero's). Its `circle` defaults to the Venture's: from a circle where the name is unknown, it adds only 1 Exposure, and makes the name known there. On delivery the run applies the simple effects it can read in `effect` (“Exposure +3”, “Notoriety +1”, “Celebrity −1”); for anything else, add `on_delivery:` with a list of effects |
| `{ persona: Capt. O’Rourke, why: … }` | The hero passes under this name. A new one starts at Exposure 1, +1 for each rank claimed above the truth; a name worn before keeps its Exposure. Exposure is kept separately for each name |
| `{ pledge: His father’s sword, loan: £1, why: … }` | Pawns an item; the run keeps the ticket, redeemable in the town for a fifth more within 12 weeks |
| `{ note: 15s, to: Mr Tozer, why: … }` | A note of hand: a debt of honour, which costs Celebrity once four weeks unpaid |
| `{ when: …, then: [ … ], else: [ … ] }` | Effects that happen only if a condition holds |
| `{ adj: purse, by: "= -floor(spoils / 2)", … }` | A sum worked out from the state, after `=` |
| `{ calc: spoils, to: "0" }` | Sets a value silently |

The `why` appears in the designer's ledger of causes. Chips under each outcome are written by the
engine from the effects, so the prose never repeats the numbers.

## Conditions and sums

Conditions read the hero's state:

```
flags.will and spoils > 0
attrs.Address >= 3
not flags.sawFace
flags.sirPistol or flags.outriderArmed
has_hook("Will Gallow")      has_item("A borrowed fan")      has_tag("Brother")
has_condition("Wounded")     rumour_says("Exposure")
exposure > start.exposure    # start = the state at the Approach
has_persona("Capt")          played("blue-boar")
has_tag_in("Rake", "the Church")   standing("the Church") >= 1   # a Tag with a faction (or the Town); standing from the register
rank_at_least("Esquire")     known_in("the Quality")   # the Claimed Rank; the circles where the name worn is known
appearances >= expected_next # in a run: also claimed_rank, true_rank, secret ("kept" or "out"),
                             # lodging_district, equipage (its tier, 0–3), circles_known, sale_money
year == 1724 and week >= 41  # in a run: the calendar, the turn, and the Origin's id
```

Sums may use `+ - * /`, `floor()`, `ceil()`, `min()`, `max()`, and `if(condition, a, b)`.

## Text

| Write | To get |
| --- | --- |
| A blank line | A new paragraph |
| `[[prancer]]` · `[[lope\|loped]]` | A glossary word, underlined, opening the Editor's dictionary; the second form shows another form of the word |
| `{fn *}` | A footnote marker: `*`, `†`, `‡`, `§`, restarting each Venture |
| `{if flags.tip}…{else}…{end}` | Text that depends on the state; `{elif …}` is allowed |
| `{money(purse)}` · `{notoriety}` | A value from the state |

Every glossary word must be in `glossary.yaml` before a Venture uses it.

## The Story

The Story has one voice (ruled 20 October 2026): third person, past tense, brisk and low-comic.
A passage is a single string: `story: { T: "…", X: "…" }`, or `M:` for a milestone on a certain
option, and the Venture's `story` block gives a `preface` and a `close`. A rumour may carry a
`hindsight:` passage, added as a footnote to the Venture's chapter when the rumour lands; without
one, the Editor writes a plain note. Book openings, milestones, the connectives that open each
chapter, the endings and the subscription list are in `content/story.yaml`. A Venture can end the
run by setting `ends_death` or `ends_transportation`, or make Apotheosis possible with
`ends_apotheosis`.

Every Triumph and Catastrophe should have a Story passage telling the same facts (style guide). The Venture's `story` block gives the History's title,
a preface (written when the first passage is) and a close (added at the Reckoning).

## Names

The hero's and the Persona's names are drawn afresh for each run (or chosen on the start screen),
so text never writes them out. Use these instead:

| Write | For example |
| --- | --- |
| `{given}` · `{surname}` · `{name}` · `{styled}` | Dermot · Kirwan · Dermot Kirwan · Mr Kirwan |
| `{county}` | Roscommon |
| `{alias}` · `{alias_long}` | Maj. Plunkett · Major Plunkett: the Persona the Origin offers |
| `{alias_title}` · `{alias_title_lc}` · `{alias_surname}` · `{alias_claim}` | Major · major · Plunkett · late of the French service |

To take up the Persona, write `{ persona: "= alias" }`; to test for it, `persona == alias`.

The hero may be a man or a woman (Step 10). Play text is in the second person, so it rarely
matters; where the world addresses the hero, use these:

| Write | A man | A woman |
| --- | --- | --- |
| `{sir}` · `{Sir}` | sir · Sir | madam · Madam |
| `{gent}` · `{fellow}` | gentleman · man | lady · woman |
| `{hero}` · `{Hero}` | our hero · Our hero | our heroine · Our heroine |
| `{he}` `{his}` `{him}` `{himself}` · `{He}` `{His}` | he his him himself | she her her herself |

Test with `hero_sex == "woman"`. Story passages use `{hero}` and the pronouns. Chapter headings may
use the pronoun slots (quote them in YAML: `text: "loses {his} Shoes"`), and “our Hero” in a
heading becomes “our Heroine” by itself. A value that *begins* with a slot needs quotes in YAML:
`T: "{Hero} drank it off…"`. In a run, `{prophecy}` is the Cunning Man's reading.
A Venture's `names:` block gives the names on its own page (heath's are Cornelius Byrne and
Capt. O’Rourke). A value that begins with a name needs quotes in YAML: `st: "{alias_long}. — Of what regiment?"`.

## Ventures the run starts itself

`system: true` marks a Venture the run starts, never offers: `bailiff` (when a writ is out) and
`fleet` (each month in prison). Their flags tell the run what happened (`paid`, `bribed`, `fled`,
`taken`; `flags.pound` for a composition). Their text can use `{writ_money}`, `{writ_amount}`,
`{creditor}`, `{prison}` and `{debts_money}`; `sample:` gives those values on the Venture's own page.
The shops, prices and rules of the economy are in `settings.yaml` under `economy:`.

## The false self

Each name the hero passes under has its own Exposure, claimed rank and circles where it is known;
the town screen lists them. The kinds of Persona a hero can take up in town, with their ranks,
needs and prices, are in `settings.yaml` under `personas:`, with the rules' numbers. An ordinary
Venture can ask the engine for five things by setting a flag:

| Flag | What the run does after the Reckoning |
| --- | --- |
| `claim_up` | The name worn is received a rank higher (levee) |
| `sold_name` | The name worn is sold for `{sale_money}`, its debts going with it; the hero is himself again (name-buyer) |
| `named` | With `sold_name`: the buyer may name his seller, in a letter 4–12 weeks later |
| `secret_out` | The Origin's Secret comes out |
| `made_real` | The thing the name claims has been acquired: it is made real, and the True Rank rises to it |

At Exposure 10 a name is blown (debts fall due, Celebrity −2, the Book of the True Rank, its
circles closed, and a Wheel on Nerve against 5 for the Secret); a name made real, or the hero's
own, suffers a scandal instead.

## Humours and Afflictions

A humour at 5 brings an Affliction, shown as a Condition (`has_condition("Afflicted: Quarrelsome")`),
until it falls to 3: Prodigal, Quarrelsome, Hipped and Torpid. The engine raises humours itself for
a Triumph, large spoils or losses, a writ, a name blown and routine, once each a turn; Ventures
raise them as before. The quarrel a Quarrelsome hero is offered is `humours.quarrel` in
`settings.yaml`, with the reliefs' prices. A Quarrelsome hero cannot take a Withdraw at a beat whose
phase is `The Crisis`; a Torpid one is not shown locked lures.

## Origins

`origins.yaml` lists the eight Origins. An Origin marked `available: true` needs a `hero` block (the pools its
names are drawn from, ranks, first lodging, starting `dress` for the six Appearances slots, and a
`start` like a Venture's) and an `arrival`
Venture. `alias_kind` names the kind of Persona its drawn alias is, and `secret_out` says what the
Secret costs when it comes out (a letter, a chapter, a Tag, a Hook, Credit at a lower rank) and
the late reversal its Hook may bring. The others appear on the start screen as “not yet written”.

## Checking your work

Claude runs these after any change; you can too, with Node installed:

```
npm install         # once
npm run check       # the schema and every cross-reference: beats, flags, glossary words, sums
npm test            # plays every path through every Venture and reports anything broken
npm run build       # writes dist/index.html (the run) and dist/<id>.html, one page per Venture
npm run test-runs   # plays 300 whole runs, reloading saves mid-Venture, and checks they replay exactly
npm run smoke       # after a build: clicks through the built pages in a simulated browser
```

`npm run check` stops on errors (a beat that doesn't exist, a flag read but never set, a word not
in the glossary, a sum that isn't money) and warns about anything against a ruling (a Tag that
names no faction, a rumour with an absolute week).
