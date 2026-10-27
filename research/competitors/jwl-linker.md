# JWL Linker (Obsidian community plugin)

- **Date checked:** 2026-10-26
- **Sources:**
  - Original repo and README: https://github.com/MrBertie/jwl-linker
  - Community listings (forks): https://community.obsidian.md/plugins/jwl-linker-en-ru-es · https://community.obsidian.md/plugins/jw-library-linker
  - Related: https://github.com/jwnetdotwork/nwt-linker

## Who it's for
Witnesses who keep study notes in Obsidian and want scripture references in those notes to open JW Library, or to pull in verse text.

## Pricing
Free community plugin. The README shows no price ([repo](https://github.com/MrBertie/jwl-linker)).

## Core flow
- **Reading View.** It shows scripture references as working links: "all scripture references are now displayed as functioning hyperlinks; in addition any abbreviated bible book names will be written out in full." The markdown itself is not changed ([README](https://github.com/MrBertie/jwl-linker)).
- **Cite verses.** "fetches bible verse content online and inserts (or cites) the text directly into the page markdown content with plain formatting." It accepts any verse range within one chapter, e.g. `Ac 12:1-4`. A variant inserts the text as a callout ([README](https://github.com/MrBertie/jwl-linker)).
- **Cite jw.org url.** "fetches the paragraph content from an existing jw.org link and inserts it… together with the correct navigation title." The tip is to click a paragraph on wol.jw.org first and then copy the page link ([README](https://github.com/MrBertie/jwl-linker)).
- **Convert.** "converts Bible scripture references to JW Library links" ([README](https://github.com/MrBertie/jwl-linker)).

## Focus areas
1. **Placement.** Inserts text inline, below the cursor reference. There is no canvas.
2. **Citations.** The quoted paragraph keeps "the correct navigation title" and its source link. This is the closest public precedent for Berean's citation-as-header ([README](https://github.com/MrBertie/jwl-linker)).
3. **Snapping and edges.** Not applicable.

## Translation labeling
**Unverified.** The README doesn't say which Bible edition "Cite verses" fetches, or whether the inserted text names the translation. One fork advertises a "Dual Language Mode" ([jwl-linker-en-ru-es](https://community.obsidian.md/plugins/jwl-linker-en-ru-es)). We didn't verify how it labels each language.

## Broken citation display
"Invalid scripture references will be ignored" ([README](https://github.com/MrBertie/jwl-linker)). A bad reference just stays plain text, with no error styling.

## Notes ↔ drawings
None. It handles text only.

## Gaps
- Silent failure on invalid references.
- Translation labeling isn't documented.
- Several forks exist with differing scope ([community listing](https://community.obsidian.md/plugins/jw-library-linker)).

## What users say
We found no public reviews beyond the plugin listings.

## Worth screenshotting
1. https://github.com/MrBertie/jwl-linker (README command table)
2. https://community.obsidian.md/plugins/jwl-linker-en-ru-es

## Screenshots (captured 2026-10-26)
- [`screenshots/jwl-linker-readme.png`](screenshots/jwl-linker-readme.png): GitHub README. Source: https://github.com/MrBertie/jwl-linker
