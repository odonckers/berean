# JW Library (official app, Jehovah's Witnesses)

- **Date checked:** 2026-10-26
- **Sources:**
  - Help index: https://www.jw.org/en/online-help/jw-library/
  - Features: https://www.jw.org/en/online-help/jw-library/features/
  - Start Using (iOS / Android / Windows): https://www.jw.org/en/online-help/jw-library/apple/features/ · https://www.jw.org/en/online-help/jw-library/android/features/ · https://www.jw.org/en/online-help/jw-library/windows/features/
  - Highlight Text (iOS / Android / Windows): https://www.jw.org/en/online-help/jw-library/apple/highlight-text/ · https://www.jw.org/en/online-help/jw-library/android/highlight-text/ · https://www.jw.org/en/online-help/jw-library/windows/highlight-text/
  - FAQs (iOS / Android / Windows): https://www.jw.org/en/online-help/jw-library/apple/faqs/ · https://www.jw.org/en/online-help/jw-library/android/faqs/ · https://www.jw.org/en/online-help/jw-library/windows/faqs/
  - App Store listing and version history: https://apps.apple.com/us/app/jw-library/id672417831
  - Study Tip on the Research Guide (Watchtower, April 2023): https://www.jw.org/en/library/magazines/watchtower-study-april-2023/Study-Tip/
  - Squad research, backup schema: /workspace/jw-study/research/jw-library-technical-research.md (section 2)
  - Public user posts: https://jwtalk.net/topic/46302-technical-problemplease-help/ · https://curiousnetentity.com/JWLibrary/context-menu/

**No canvas.** JW Library has no canvas, whiteboard, connector, or drawing surface in any official help page or store listing we found. Its study tools are highlights, notes, tags, bookmarks, and the Study pane ([features](https://www.jw.org/en/online-help/jw-library/features/), [App Store](https://apps.apple.com/us/app/jw-library/id672417831)).

## Who it's for
JW Library is the official reading and study app for Bibles, publications, video, and audio produced by Jehovah's Witnesses. It is "designed to enhance your Bible reading and deepen your personal study" ([features](https://www.jw.org/en/online-help/jw-library/features/)).

## Pricing
No price appears on the official pages. The App Store lists it as an app from the organization ([App Store](https://apps.apple.com/us/app/jw-library/id672417831)). We did not verify an exact price field.

## Core flow, by area

| Area | What the official sources say | Platform notes |
|---|---|---|
| Reading | Tap a Bible book, then a chapter. Publications open by type, then article ([iOS](https://www.jw.org/en/online-help/jw-library/apple/features/), [Android](https://www.jw.org/en/online-help/jw-library/android/features/)). | Windows help describes an "App Commands bar" opened by right-click or swiping down ([Windows](https://www.jw.org/en/online-help/jw-library/windows/features/)). The text looks dated (Windows 8 era). |
| Study pane: footnotes, cross-references, parallel translations | "As you read, you can also see footnotes, marginal references, and parallel translations in the Study pane." In a publication, "Tap a Bible citation to see the verse in the Study pane. Tap a link in the Study pane to go to the verse in the Bible." ([iOS](https://www.jw.org/en/online-help/jw-library/apple/features/)) | The same wording appears for Android and Windows ([Android](https://www.jw.org/en/online-help/jw-library/android/features/), [Windows](https://www.jw.org/en/online-help/jw-library/windows/features/)). |
| Research Guide links | Research Guide verse references appear in the Study pane of any Bible version. To enable them, "install the Research Guide and download updates," using a button at the top of the Study pane. Newest articles are listed first ([Study Tip](https://www.jw.org/en/library/magazines/watchtower-study-april-2023/Study-Tip/)). The App Store history adds a gem icon on the context menu that shows "all study content for a single verse, including Research Guide references" ([App Store](https://apps.apple.com/us/app/jw-library/id672417831)). | A user says the Research Guide is installed from Publications > Indexes, after which "click on any verse number in bold" shows the articles ([JWTalk](https://jwtalk.net/topic/46302-technical-problemplease-help/)). This is user evidence, not official. |
| Highlights | Select text, tap Highlight, and pick a color. Touch, hold, and drag highlights in one gesture. Tap a highlight to recolor or remove it ([iOS](https://www.jw.org/en/online-help/jw-library/apple/highlight-text/), [Android](https://www.jw.org/en/online-help/jw-library/android/highlight-text/)). | Windows: "You can also use a pen to highlight a word or phrase… as you would using a highlighter on a printed page" ([Windows](https://www.jw.org/en/online-help/jw-library/windows/highlight-text/)). The help pages cite version 1.6 (2015), so they may be out of date. |
| Notes and tags | "Highlight text, add personal notes, and categorize with tags" ([App Store](https://apps.apple.com/us/app/jw-library/id672417831)). Per the App Store version history, notes made in the Bible and other publications show in the Study pane, and "Notes cannot be created in the study pane." Personal notes appear before other study content. | A VoiceOver user describes the note form as an optional title, the note text, and a tag field ([curiousnetentity](https://curiousnetentity.com/JWLibrary/context-menu/)). |
| Backup and sync | Notes, tags, highlights, favorites, and bookmarks can be saved to a backup file and restored. "Can I synchronize my personal data across my devices? No." ([iOS FAQ](https://www.jw.org/en/online-help/jw-library/apple/faqs/), [Android FAQ](https://www.jw.org/en/online-help/jw-library/android/faqs/), [Windows FAQ](https://www.jw.org/en/online-help/jw-library/windows/faqs/)) | The backup is a zip with `userData.db`. Note `Content` is plain text (squad research §2, citing [JWLMerge](https://github.com/DavidIQ/JWLMerge)). |
| Parallel translations (detail) | Context menu > Parallel Translations shows "the current Bible verse in Every Bible version and language you have downloaded". The Customize button reorders the Bibles. "I have not found any way to select multiple verses to be shown in Parallel Translations." ([curiousnetentity](https://curiousnetentity.com/JWLibrary/context-menu/), user guide, iOS) | Single verse only, according to this user. |
| Share and Copy | Share sends "a link to the exact spot in the current publication". Copy puts "the entire paragraph or verse" on the clipboard ([curiousnetentity](https://curiousnetentity.com/JWLibrary/context-menu/)). The author says pasting shared links into an outside note is sometimes "more efficient… than to use the built-in Note feature." | iOS user guide |
| Mac | We found no official Mac help page. A third-party mirror of the App Store notes says you can open multiple JW Library windows "on devices running iPadOS 15 or macOS 11 and later" ([apps112 mirror](https://jw-library-ios.apps112.com/)). | **Unverified** on an official page. |

## Focus areas
1. **Placing clips:** Not applicable. There is no canvas. The nearest pattern is that a note attaches to the selected text or verse and then appears in the Study pane next to that verse ([App Store history](https://apps.apple.com/us/app/jw-library/id672417831)).
2. **Citations and source links:** A Bible citation in a publication opens the verse in the Study pane, and a link there jumps into the Bible ([iOS help](https://www.jw.org/en/online-help/jw-library/apple/features/)). This two-step flow (peek, then go) is the closest model for Berean's `jwcite:` chips.
3. **Snapping and edges:** None.

## Broken citation or link display
We found no official page describing what a link to a publication that isn't installed looks like. Public user evidence:
- **Missing Research Guide.** If the Research Guide isn't downloaded, the extra study content simply doesn't appear. One user thought their study notes were missing until someone explained "make sure you have it downloaded to your device then it will show up in the study notes" ([JWTalk, Aug 2020](https://jwtalk.net/topic/46302-technical-problemplease-help/)). The failure is silent: content is absent, and no error is shown.
- **Shared links to undownloaded publications.** For a shared JW Library link: "If the publication isn't downloaded it will ask if they want to download it," then it opens at the right spot. Without the app, "The link should open on jw.org" ([curiousnetentity](https://curiousnetentity.com/JWLibrary/context-menu/)). This comes from a user guide, not official docs.

## Notes ↔ drawings
There is no drawing tool. The only pen feature is pen highlighting on Windows ([Windows](https://www.jw.org/en/online-help/jw-library/windows/highlight-text/)).

## Parallel texts
Parallel translations show in the Study pane ([iOS](https://www.jw.org/en/online-help/jw-library/apple/features/)). There is no free arrangement, so snapping doesn't apply.

## Gaps (relevant to Berean)
- No canvas, connectors, or sketches. No cross-device sync of notes ([FAQ](https://www.jw.org/en/online-help/jw-library/apple/faqs/)).
- Notes are plain text and can't be created in the Study pane ([App Store](https://apps.apple.com/us/app/jw-library/id672417831), squad research §2).
- The official help pages are thin and look dated (they still reference version 1.6).

## What users say
- **Research Guide discoverability.** A user couldn't find study notes for Job until others explained the Research Guide. The fix: "In JW Library go to Publications > Indexes > Study Guide, click on the cloud symbol. Now when you go to the Bible and click on any verse number in bold, it will show you articles…" ([JWTalk](https://jwtalk.net/topic/46302-technical-problemplease-help/)).
- **Notes and tags accessibility.** A VoiceOver user: "I kept failing to add tags unless I did so using a keyboard," and "Never mind the 'add a Tag' button that doesn't work." Also: "In my latest testing I was unable to find images or any other indication of Notes I created", although notes are still listed in the Personal Study tab ([curiousnetentity](https://curiousnetentity.com/JWLibrary/context-menu/)).
- **Notes kept outside the app.** The same author pastes JW Library share links into outside notes so they can "create something with a lot of info in one place and have multiple reference links included" ([curiousnetentity](https://curiousnetentity.com/JWLibrary/context-menu/)). This is close to Owen's Research Guide → SilverBullet workflow.

## Worth screenshotting
1. https://www.jw.org/en/online-help/jw-library/apple/features/ (Study pane description and screenshots)
2. https://www.jw.org/en/library/magazines/watchtower-study-april-2023/Study-Tip/ (Research Guide in the Study pane)
3. https://apps.apple.com/us/app/jw-library/id672417831 (store screenshots of notes and the Study pane, plus version history)
4. https://wol.jw.org/en/wol/b/r1/lp-e/nwtsty/1/3 (public WOL Genesis 3, nwtsty. Note: this page is Watchtower Online Library, not JW Library. It shows the same study-pane model on the web.)

## Screenshots (captured 2026-10-26)
- [`screenshots/jw-library-features.png`](screenshots/jw-library-features.png): iOS "Start Using" features help (notes/tags sections collapsed). Source: https://www.jw.org/en/online-help/jw-library/apple/features/
