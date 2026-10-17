# Writing content

Everything a player reads lives in this folder, in YAML: one file per Venture in `ventures/`,
and the Editor's two dictionaries in `glossary.yaml`. The engine never needs touching to change
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

# Costed: says what it costs on a badge
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
| `rumour: { id, delay, from, text, effect }` | A rumour, delivered 1–3 weeks after the Venture |
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

## Checking your work

Claude runs these after any change; you can too, with Node installed:

```
npm install         # once
npm run check       # the schema and every cross-reference: beats, flags, glossary words, sums
npm test            # plays every path through every Venture and reports anything broken
npm run build       # writes dist/<id>.html, one self-contained page per Venture
```

`npm run check` stops on errors (a beat that doesn't exist, a flag read but never set, a word not
in the glossary, a sum that isn't money) and warns about anything against a ruling (a Tag that
names no faction, a rumour with an absolute week).
