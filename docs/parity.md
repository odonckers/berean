# JW Library parity

**Checked against JW Library 15.9.2 (iOS, App Store, released 2026-10-05).** Every row was checked against that version on 2026-10-27, unless its Notes say otherwise. Re-check the rows whenever JW Library ships a new version, and bump this header.

Only features that a cited source describes are listed. Rows marked **to verify** come from a source that may be out of date or that doesn't say which version added the feature. Someone needs to confirm them in the 15.9.2 app.

## Legend
- **Status**
  - **Not started**: no Berean work yet.
  - **Core in progress**: Rust core work is on an open PR or underway.
  - **Core done**: the Rust core is implemented and tested on its PR (the stack isn't merged yet), and no UI is needed beyond what another row covers.
  - **UI pending**: the core is done, and the feature still needs app UI.
- **Layer**: `core`, `ui`, or `both`.
- **UI**: whether the row needs app UI from **Kiwi or Moss**. Assignment between them is still open.

## Sources
- [S1] Start Using JW Library (iOS): https://www.jw.org/en/online-help/jw-library/apple/features/
- [S2] Download and Manage Bibles (iOS): https://www.jw.org/en/online-help/jw-library/apple/bibles/
- [S3] Download and Manage Publications (iOS): https://www.jw.org/en/online-help/jw-library/apple/publications/
- [S4] Set and Manage Bookmarks (iOS): https://www.jw.org/en/online-help/jw-library/apple/bookmarks/
- [S5] Use History (iOS): https://www.jw.org/en/online-help/jw-library/apple/history/
- [S6] Customize the Reading Experience (iOS): https://www.jw.org/en/online-help/jw-library/apple/customize-reading/
- [S7] Search in a Bible or Publication (iOS): https://www.jw.org/en/online-help/jw-library/apple/search/
- [S8] Highlight Text (iOS): https://www.jw.org/en/online-help/jw-library/apple/highlight-text/
- [S9] FAQ (iOS): https://www.jw.org/en/online-help/jw-library/apple/faqs/
- [S10] What's New, on the iOS help index (15.5–15.7): https://www.jw.org/en/online-help/jw-library/apple/
- [S11] "Research Guide in JW Library Updated With Expanded Scripture Index": https://www.jw.org/en/news/region/global/Research-Guide-in-JW-Library-Updated-With-Expanded-Scripture-Index/
- [S12] App Store version history: https://apps.apple.com/us/app/jw-library/id672417831
- [S13] Data: the real `rsg_E.jwpub` (sha256 `5ef3c591…`), pinned in `core/scripts/fixtures.txt`.

## Library / catalog
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| CAT-1 | Browse by type | The Publications tab groups publications in the browsed language by type (Books, Tracts, Videos, …). Some types have sub-options, e.g. Watchtower editions. [S3] | UI pending | both | Kiwi/Moss | Core: catalog sync + download plans / #16 | `Catalog` query + `CatalogFilter` (kind, language). |
| CAT-2 | Languages list | A Languages button lists every language with content; the languages used most are at the top, and the list is searchable. [S2][S3] | UI pending | both | Kiwi/Moss | #16 | `Catalog::languages` comes from the versioned language table. "Most used" ordering is UI/userdata, **to verify** where it lives. |
| CAT-3 | What's New | Recently released publications in the browsed language. [S3] | Not started | both | Kiwi/Moss | #16 | No "recent" query yet. **to verify** which catalog field carries the release date and what cut-off JW Library uses. |
| CAT-4 | Library search by title | The Search button on the Library tab finds publications, videos or audio by title (15.6). [S10] | Not started | both | Kiwi/Moss | Core: FTS5 search (Holding) | The catalog has titles. No title search API yet. |

## Downloads
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| DL-1 | Download a Bible or publication | A cloud icon marks items that aren't downloaded; tap to download. [S2][S3] | UI pending | both | Kiwi/Moss | Core: publication store + library / #15; #16 | The core plans (`download_request`, `plan_download`) and installs (`Library::install`, with progress and cancel). Swift owns transport. |
| DL-2 | Delete | Swipe or select to delete Bibles or publications. [S2][S3] | UI pending | both | Kiwi/Moss | #15 | `Library::remove`. |
| DL-3 | Updates | A refresh icon marks an updated item, with "Download" or "Later", plus a Pending Updates section. [S2][S3] | Core in progress | both | Kiwi/Moss | #16 | Comparing catalog vs installed versions: **to verify** that the catalog signature is enough. |
| DL-4 | Downloaded list | Lists downloads in all languages, sortable by Title, Frequently Used, Rarely Used or Largest Size. [S3] | Core in progress | both | Kiwi/Moss | #15 | `Library::list` gives size and title. Usage-frequency sorting needs usage tracking (userdata). |

## JWPUB reading (Publications reader)
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| PUB-1 | Open and read an article | Tap a publication, then an article. [S1] | UI pending | both | Kiwi/Moss | Core: JWPUB open/decrypt/parse / #14; reader #17 | `Reader::toc`, `Reader::document` (decrypted HTML + whole-element paragraph anchors). |
| PUB-2 | Bible citations in articles | Tap a citation to see the verse in the study pane; links in the pane go to the Bible. [S1] | UI pending | both | Kiwi/Moss | #17 | `Reader::resolve` turns `jwpub://b/…` and `jwpub://p/…` links (including ranges) into a `LocationSpan`. |
| PUB-3 | Change language of the current article | Lists the languages that have this page; a cloud icon marks ones not downloaded. [S6] | Not started | both | Kiwi/Moss | — | MEPS doc ids are shared across languages (see #17), so the core can find the same document in another language. No API yet. |
| PUB-4 | Text size | One slider for all publications. [S6] | Not started | ui | Kiwi/Moss | — | UI setting. |
| PUB-5 | View Image / View Text | Some articles toggle between a print-page image and text. [S6] | Not started | both | Kiwi/Moss | — | **to verify** which jwpub assets back the image view. |
| PUB-6 | Open in Online Library | "Open in …" opens the page in Watchtower ONLINE LIBRARY. [S6] | Not started | ui | Kiwi/Moss | — | Needs a URL from pub_key + doc id: **to verify** the URL format. |

## Bible
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| BIB-1 | Book → chapter navigation | Tap a book, then a chapter. Book colors follow the eight groupings. [S1][S9] | UI pending | both | Kiwi/Moss | Core: Bible/verse mapping + reader content / #17 | `Reader::toc` on a Bible lists books. Grouping colors are UI, **to verify** whether the data has them. |
| BIB-2 | Read a chapter with verse anchors | — [S1] | UI pending | both | Kiwi/Moss | #17 | `Reader::bible_chapter`: verse anchors, split verses covered whole, Psalm superscription = verse 0. |
| BIB-3 | Look up a reference | Look up scriptures. [S1] | UI pending | both | Kiwi/Moss | #17 | `Reader::resolve("John 3:16-18")`, cross-chapter verse ranges, chapter ranges ("John 3-4"), single-chapter books ("Jude 3"), English and Spanish book names; a span stays within one book. Abbreviations and name variants ("Salmo") are deferred (Owen). |
| BIB-4 | Customize look-up Bibles | Choose and reorder which downloaded Bibles show for a tapped citation. [S6] | Not started | both | Kiwi/Moss | — | Settings/userdata plus `bible_chapter` per Bible. |
| BIB-5 | Footnotes, marginal references, parallel translations in the study pane | [S1] | Not started | both | Kiwi/Moss | Design spec: inline study pane (Lumen, Done) | **to verify** the table mapping (Footnote / BibleCitation in Bible jwpubs). |
| BIB-6 | Study pane scene images for *The Good News According to Jesus* clips | (15.7) [S10] | Not started | both | Kiwi/Moss | — | **to verify** the data source. |

## Study pane: Research Guide connections
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| RG-1 | Research Guide references for a verse | Select a verse, then the Research Guide icon in the study pane. References are listed newest first. [S11] | UI pending | both | Kiwi/Moss | Parity: Research Guide connections in the study pane / #18 | `Reader::study_references(Location)` gives `Installed` + items `{label, html, target}`, in the guide's own order. Tested on real `rsg_E` [S13]. Design spec by Lumen (row "Design spec: Research Guide connections", Watching 2/3). |
| RG-2 | Install the Research Guide from the study pane | If it isn't downloaded, the study pane offers the download (gem icon). [S11] | UI pending | both | Kiwi/Moss | #18 | `NotInstalled { pub_key }` from the catalog (e.g. `rsg:1:0` for Spanish). The download goes through DL-1. |
| RG-3 | Research Guide for publication paragraphs | — | Not started | core | — | — | The `rsg` schema has `ParagraphCommentary`/`Map` tables, but they're empty in rsg_E 2026 [S13]. **to verify** that the app has any such feature. |

## Search
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| SR-1 | Search in a Bible | Word/phrase, with suggestions while typing. Top Verses / All Verses (book order) / Articles; Match Exact Phrase. [S7] | Not started | both | Kiwi/Moss | Core: FTS5 search (Holding) | |
| SR-2 | Search in a publication | Word/phrase, suggestions, Match Exact Phrase. [S7] | Not started | both | Kiwi/Moss | Core: FTS5 search (Holding) | |
| SR-3 | Insight topic search | With *Insight on the Scriptures* downloaded, matching Insight topics appear in suggestions. [S7] | Not started | both | Kiwi/Moss | Core: FTS5 search (Holding) | jwpubs have `Topic`/`TopicDocument` tables (seen in rsg_E) [S13]: **to verify** for Insight. |

## Notes / highlights / tags / bookmarks / history
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| UD-1 | Highlights | Select text or drag to highlight, choose or change a color, delete. [S8] | Not started | both | Kiwi/Moss | Core: userdata (Holding) | Will key on the `LocationSpan` and paragraph/verse anchors from #17. |
| UD-2 | Notes | [S9] mentions them (backup) | Not started | both | Kiwi/Moss | Core: userdata (Holding) | **to verify** the 15.9.2 note UI (no iOS help page). |
| UD-3 | Tags | [S9] mentions them (backup) | Not started | both | Kiwi/Moss | Core: userdata (Holding) | **to verify** the 15.9.2 tag UI. |
| UD-4 | Favorites | [S9] mentions them (backup) | Not started | both | Kiwi/Moss | Core: userdata (Holding) | **to verify** what "favorites" covers. |
| UD-5 | Bookmarks | 10 per publication; for an article/chapter or a specific paragraph/verse; go to, delete, replace. [S4] | Not started | both | Kiwi/Moss | Core: userdata (Holding) | |
| UD-6 | History | Long-press the Bible or Publications tab for recent scriptures/articles; Clear. [S5] | Not started | both | Kiwi/Moss | — | No board row yet. |
| UD-7 | Sync across devices | Not supported ("No. At this time…"). [S9] | n/a | — | — | — | Not a parity target. |

## .jwlibrary backup / restore
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| BK-1 | Back up personal data | Saves notes, tags, highlights, favorites and bookmarks to a backup file. [S9] | Not started | both | Kiwi/Moss | Core: userdata + .jwlibrary import/export (Holding) | The format is `.jwlibrary` per the approved proposal. |
| BK-2 | Restore | Restore on the same or a different device. [S9] | Not started | both | Kiwi/Moss | Core: userdata + .jwlibrary (Holding) | Round-trip test planned. |

## Meetings tab / Meeting Workbook
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| MT-1 | Meetings tab | Shows the publications for the current meeting. [S1] | Not started | both | Kiwi/Moss | — | `PubKind::MeetingWorkbook` exists (#16), and `mwb` issues are day-level tags. No "current week" API or board row yet. **to verify** the exact 15.9.2 layout (workbook + Watchtower study article). |

## Daily text
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| DT-1 | Daily Text tab | Today's text. [S1] | Not started | both | Kiwi/Moss | — | The catalog has a `DatedText` table and jwpubs have `DatedText`. No board row yet. |

## Audio / video
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| AV-1 | Playback speed remembered | Remembered after restarting (15.5). [S10] | Not started | ui | Kiwi/Moss | — | |
| AV-2 | "Watch Now" shuffles videos; video language selector | (15.8) [S12] | Not started | ui | Kiwi/Moss | — | **to verify**: sources disagree on which version added this. |

## Platform / app
| ID | Feature | JW Library behavior | Status | Layer | UI | Board row / PR | Notes |
|---|---|---|---|---|---|---|---|
| PL-1 | Multiple windows | iPadOS/macOS multi-window (15.9). [S12] | Not started | ui | Kiwi/Moss | — | **to verify** the exact OS minimums. The core is `Send + Sync`, so several windows can share one `Core`. |
| PL-2 | Online tab | Links to official websites. [S1] | Not started | ui | Kiwi/Moss | — | |
| PL-3 | OS minimums | iOS 15.0+, macOS with M1 or newer. [S9][S10] | n/a | — | — | — | Berean's targets are set in project.yml (#12). |
