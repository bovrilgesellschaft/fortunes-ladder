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
  blurb: When the playhouses empty, the Town goes on to Tom King’s…
  when: has_persona("Capt") and has_item_like("pistol")   # optional: who may be offered it
  from: { year: 1724, week: 41 }  # optional: only between these dates
  to: { year: 1724, week: 46 }
  weight: 3                      # optional: relative chance of being drawn (default 1)
  repeat: true                   # optional: may be offered again after it is played
  arrival: true                  # instead: played in the first turn, as an Origin's arrival
kit:                             # optional: lent for this Venture only
  items: [A hired grey prancer, from the Bell in Holborn]
  returned: [A hired grey prancer, from the Bell in Holborn]   # taken back after the Reckoning
test: true                       # placeholder content, marked on the card
```

Each turn the run draws three offers from the Ventures whose conditions hold. In a run the Venture
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
    T: { sm: …, st: … }              # after Smollett, after Sterne
    X: { sm: …, st: … }
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
| `{ tag: Gallant (the Quality), why: … }` | A reputation Tag; always names a faction or the Town |
| `{ condition: "Wounded (a ball-graze, left arm)", why: … }` | A wound, disease or Affliction |
| `{ item: …, why: … }` · `{ lose: …, why: … }` | Possessions; `lose_matching: pistol` loses the first item containing the word |
| `{ hook: …, why: … }` · `{ unhook: Betty Slyfield, why: … }` | Hooks, written as a person or thing and why it matters; `unhook` spends the first that starts with the words given |
| `rumour: { id, delay, from, text, effect }` | A rumour, delivered 1–3 weeks after the Venture. On delivery the run applies the simple effects it can read in `effect` (“Exposure +3”, “Notoriety +1”, “Celebrity −1”); for anything else, add `on_delivery:` with a list of effects |
| `{ persona: Capt. O’Rourke, why: … }` | The hero takes up a Persona, with Exposure 1; Exposure is kept separately for each name |
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

Every Triumph and Catastrophe should have a Story passage in both voices, describing the same
event with the same facts (style guide). The Venture's `story` block gives the History's title,
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
A Venture's `names:` block gives the names on its own page (heath's are Cornelius Byrne and
Capt. O’Rourke). A value that begins with a name needs quotes in YAML: `st: "{alias_long}. — Of what regiment?"`.

## Ventures the run starts itself

`system: true` marks a Venture the run starts, never offers: `bailiff` (when a writ is out) and
`fleet` (each month in prison). Their flags tell the run what happened (`paid`, `bribed`, `fled`,
`taken`; `flags.pound` for a composition). Their text can use `{writ_money}`, `{writ_amount}`,
`{creditor}`, `{prison}` and `{debts_money}`; `sample:` gives those values on the Venture's own page.
The shops, prices and rules of the economy are in `settings.yaml` under `economy:`.

## Origins

`origins.yaml` lists the eight Origins. An Origin marked `available: true` needs a `hero` block (the pools its
names are drawn from, ranks, first lodging, starting `dress` for the six Appearances slots, and a
`start` like a Venture's) and an `arrival`
Venture. The others appear on the start screen as “not yet written”.

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
