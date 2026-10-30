# Design specs

`docs/design/` holds Berean's signature-interaction specs: the handful of interactions that make Berean feel different from a standard reader. Each spec covers behavior, input, layout, motion, materials, and accessibility on iOS, iPadOS, and macOS, compares a few directions, and ends with open questions.

A spec's recommended direction stays **pending** until Owen decides on it in the spec's pull request.

| Spec | Status |
| --- | --- |
| [Berean design guide](berean-design-guide.md) | v3 with Notes section; approved direction (Oct 28, 2026), reference for all platforms |
| [Inline study pane](inline-study-pane.md) | Decided: direction B, open questions resolved |
| [Markdown notes, folders and tags (core FFI shapes)](markdown-notes.md) | Proposed; Wren decides in the PR |
| [Document blocks for publication articles (core FFI shapes)](document-blocks.md) | Proposed; Wren decides in the PR |
| Studyspace infinite canvas | Planned |
| Omnisearch | Planned |
| Note hyperlinks with inline previews | Planned |
| Liquid Glass and platform fidelity guide | Planned |

## Conventions

- One file per interaction, named in kebab-case.
- Numbers such as breakpoints, durations, and springs are **proposals** to check on device, not final values.
- Follow the Apple Human Interface Guidelines and link the pages a spec relies on.
- Use only original assets and wording. Don't copy them from JW Library or any other app.
