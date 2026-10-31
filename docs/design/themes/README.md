# Themes: tokens and checks

This folder holds Berean's color themes as data. The spec is [themes-spec.md](themes-spec.md).

| File | What it is |
| --- | --- |
| [tokens.json](tokens.json) | The platform-neutral token file. It is the source of truth for every theme color. The SwiftUI apps and the Expo app read it. Nothing in it goes in the Rust core. |
| [tokens.schema.json](tokens.schema.json) | JSON Schema (draft 2020-12) for `tokens.json`. |
| [contrast.py](contrast.py), [colorlib.py](colorlib.py) | Re-check every token pair against the contrast floors. Python 3 standard library only. |
| [contrast-table.md](contrast-table.md), [contrast-table.csv](contrast-table.csv) | The full table `contrast.py` writes: 2,448 checks. |
| [frames/](frames/) | The design frames, F01–F10, as 2× PNGs. See [themes-spec.md](themes-spec.md) §13. |

## Re-check

```sh
python3 docs/design/themes/contrast.py --check   # exit 1 on any FAIL, writes nothing
python3 docs/design/themes/contrast.py           # same, and rewrites contrast-table.md and .csv
```

Run it after any change to `tokens.json`, and commit the regenerated tables with the change.

## `tokens.json` schema

- **Top level:** `$schema`, `version` (semver; see the schema), `modes`, `defaults`, `appearances`, `roles`, `highlightFamilies`, `notes`, `themes`.
- **`themes.<id>`**, in order `paper`, `sepia`, `stone`, `sage`: `name`, `character`, `default` (true only for Paper), and:
  - `modes.<mode>` for `light`, `dark`, `lightIC` and `darkIC` (IC is Increase Contrast). Each holds the 16 roles in `roles` as hex, plus `highlights`: six `{ key, name, spokenName, hex, oklch }` in the display order yellow, green, blue, pink, purple, orange.
  - `accents.slots`: six `{ slot, name, flags?, modes.<mode>: { hex, onAccent, oklch } }`. Slot 1 is the default. `accents.sharedOklch.<mode>` is the shared `{ L, C }` that every slot in a mode is built on. `flags` lists every slot value whose chroma was reduced to fit sRGB, and Paper slot 1's pinned baseline.
  - `material3.<mode>`: the Material 3 role map for the Expo app's Material look. `scrim` and `scrimWarm` are `rgba()`; every other value is hex.
- **Colors** are opaque sRGB `#RRGGBB`, uppercase, except the two M3 scrims. `oklch` is `[L, C, H]` with L from 0 to 1.
- **`highlightFamilies`** gives each key's display position (`order`), name, spoken name, hue and lightness tier (`light` or `deep`).

`highlights[n].key` is the Rust core's color name (`yellow` … `orange`). The array order is the display order, **not** JW Library's `ColorIndex`, so map by name, never by position; see [themes-spec.md](themes-spec.md) §12.5.

## Provenance

The values come from Kerning & Co.'s themes package (Oct 31, 2026), which `build_tokens.py` produced; that script isn't in the repo. This file is the package's `tokens.json` restructured into the schema above. Every hex, rgba and OKLCH value is copied unchanged. To confirm, `contrast.py` reproduces the package's contrast table byte for byte. The frames are the package's renders, copied unchanged. To change a value, edit `tokens.json` directly, re-run `contrast.py`, and log the change in [themes-spec.md](themes-spec.md) §14.
