# SilverBullet (Owen's current note tool)

- **Date checked:** 2026-10-26
- **Sources:**
  - Links: https://docs.silverbullet.md/Link
  - Aspiring Pages: https://docs.silverbullet.md/Aspiring%20Pages
  - Linked Mentions: https://docs.silverbullet.md/Linked%20Mention
  - Transclusions: https://docs.silverbullet.md/Transclusions
  - Anchors: https://docs.silverbullet.md/Markdown/Anchor
  - Document Editor: https://docs.silverbullet.md/Document%20Editor
  - Pricing: https://silverbullet.md/pricing
  - Workbench (main-branch docs; returned 404 on docs.silverbullet.md on 2026-10-26, so it may be unreleased): https://github.com/silverbulletmd/silverbullet/blob/main/docs/Workbench.md
  - Theme source: https://github.com/silverbulletmd/silverbullet/blob/main/client/styles/theme.scss
  - Excalidraw plugs: https://github.com/LogeshG5/silverbullet-excalidraw · https://github.com/jim-fx/silverbullet-excalidraw · https://community.silverbullet.md/t/excalidraw-plug/2126
  - Whiteboard request: https://github.com/silverbulletmd/silverbullet/issues/1840

## Who it's for
SilverBullet is a self-hosted (or desktop) markdown notebook for people who program their notes with queries and Lua. Owen currently uses it for study notes.

## Pricing (official page, https://silverbullet.md/pricing)
- Server: free (MIT).
- Desktop Personal: free.
- Desktop Pro: $50/user/year, for work use.
- Cloud: from $2/month via PikaPods.

## Onboarding
Not evaluated hands-on, since we did no sign-ups or installs.

## Linking, backlinks, citations
- **Links.** `[[page]]`, with aliases, `[[page#header]]`, and line/column refs `[[page@L12C13]]`. A link resolves by exact path first, then by name lookup ([Link](https://docs.silverbullet.md/Link)).
- **Backlinks.** "Linked Mentions" are docked at the bottom of the page ([Linked Mention](https://docs.silverbullet.md/Linked%20Mention)).
- **Transclusion.** `![[page#header]]` embeds content inline ([Transclusions](https://docs.silverbullet.md/Transclusions)). This is the nearest analogue to clipping a passage.
- **Citations.** There is no built-in citation or bibliography feature. Citations to JW sources are ordinary URLs or links (we found no doc saying otherwise).

## Broken link display (strongest of all the tools we checked)
- **Aspiring pages.** "An aspiring page is a page that does not yet exist, but is already linked to." Aspiring pages show in the Page Picker with a `Create` chip and in link autocomplete. They are also queryable (`index.aspiringPages()`) "to audit broken or forward-references" ([Aspiring Pages](https://docs.silverbullet.md/Aspiring%20Pages)).
- **Missing-link color.** The theme defines `--link-missing-color: #9e4705` and applies it to `--editor-wiki-link-page-missing-color`, so a link to a missing page renders in a distinct brownish-orange ([theme.scss](https://github.com/silverbulletmd/silverbullet/blob/main/client/styles/theme.scss)).
- **Ambiguous links.** When a name matches several pages and none exactly, "SilverBullet highlights it in the editor and when clicking it, you get to choose which matching page to navigate to" ([Link](https://docs.silverbullet.md/Link)).
- **Anchors.** "Editor-based linting will highlight broken links" ([Anchor](https://docs.silverbullet.md/Markdown/Anchor)).
- **Health tab** (main-branch docs, possibly unreleased). It lists "broken links: links to pages that don't exist yet," alongside failed scripts and Git conflicts, and its tab label shows an error count ([Workbench.md](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Workbench.md)).

## Canvas, whiteboard, drawings
- **No built-in canvas or whiteboard.** An open feature request (Feb 2026) asks for "a feature similar to logseq's whiteboards where you can draw, write text, and even drop existing pages/files in as movable blocks" ([#1840](https://github.com/silverbulletmd/silverbullet/issues/1840)).
- **Drawings through plugs.** Community Excalidraw plugs create and edit `.excalidraw` drawings and show them in pages ([LogeshG5](https://github.com/LogeshG5/silverbullet-excalidraw), [jim-fx](https://github.com/jim-fx/silverbullet-excalidraw), [forum](https://community.silverbullet.md/t/excalidraw-plug/2126)). Document Editors let plugs open non-markdown files ([Document Editor](https://docs.silverbullet.md/Document%20Editor)).
- **Plug limits.** In #1840 the requester answers: "this plug just allows creating diagrams inside pages, but does not have drag-and-drop for pages (rendering a page in-diagram within a frame)." Another user suggests syncing notes to Obsidian and using its Excalidraw plugin instead ([#1840](https://github.com/silverbulletmd/silverbullet/issues/1840)).
- **Snapping and edges.** Not applicable (no canvas).

## Gaps (relevant to Berean)
- There is no spatial view at all, which is why Owen draws on paper.
- Drawings are separate files embedded in pages. There's no public evidence that a drawing can link to a specific passage.

## What users say
- "It would be amazing if SB had a feature similar to logseq's whiteboards… This feature has helped a ton when trying to make sense of things in my knowledgebase." (OmnesPotens, [#1840](https://github.com/silverbulletmd/silverbullet/issues/1840))
- "Excalidraw plugin covers this function." (malys, same thread). The requester disagreed, as quoted above.

## Worth screenshotting
1. https://docs.silverbullet.md/Aspiring%20Pages
2. https://docs.silverbullet.md/Link (the ambiguous-links section)
3. https://github.com/LogeshG5/silverbullet-excalidraw (README images)
4. https://github.com/silverbulletmd/silverbullet/issues/1840

## Screenshots (captured 2026-10-26)
- [`screenshots/silverbullet-aspiring-pages.png`](screenshots/silverbullet-aspiring-pages.png): Aspiring Pages docs page (query embed still loading). Source: https://docs.silverbullet.md/Aspiring%20Pages
- [`screenshots/silverbullet-issue-1840.png`](screenshots/silverbullet-issue-1840.png): GitHub issue #1840, whiteboard request. Source: https://github.com/silverbulletmd/silverbullet/issues/1840
