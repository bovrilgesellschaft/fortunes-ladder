# Fortune's Ladder

A text-based picaresque roguelike set in London, 1719–1745. The player is a social-climbing
adventurer who arrives unknown and tries to make a fortune; each run is a picaresque novel,
and ruin is simply the last chapter.

The canon (the design document, the world bible and the style guide) lives in the claude.ai
project *Picaresque*. This repository holds the game.

## Layout

| Folder | What is in it |
| --- | --- |
| `content/` | Everything the player reads, in YAML: the Ventures and the Editor's dictionaries. See [content/README.md](content/README.md) for how to write it. |
| `content/schema/` | The rules the YAML is checked against; also gives editors autocompletion. |
| `engine/src/` | The TypeScript engine: `core.ts` (state, effects, the Wheel, the Reckoning), `expr.ts` (conditions and sums), `ui.ts` (the page). |
| `engine/page/` | The page shell and stylesheet, carried over unchanged from the published *A Ball in Hanover Square*. |
| `tools/` | The build, the checks and the tests. |
| `reference/` | The published prototypes of heath and ball as they stood on 17 October 2026, before conversion. |

## Commands

```
npm install
npm run check      # check all content
npm test           # play every path through every Venture
npm run build      # write dist/<id>.html, one self-contained page per Venture
npm run typecheck  # check the engine's types
```

`npm run verify-conversion` replays every path through the reference prototypes against the YAML.
It proved the conversion exact (ball, 9,993 paths; heath, 5,646) before the Step 1 rulings
and heath's second-person rewrite deliberately changed the content, so it now reports those changes.
