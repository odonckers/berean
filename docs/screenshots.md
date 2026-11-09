# Screenshots on pull requests

Every pull request that changes the mobile app gets a comment with
screenshots of its key screens, taken on an Android emulator. The comment
updates in place when new commits land. UI changes are merged only after
someone has looked at them.

## What it captures

The app is built in release mode with the Rust core, installed on an
Android emulator (API 35) and filled through its own download paths: the
catalog, the study Bible and this week's daily text and meeting
publications come from the real JW CDN, one more publication is
downloaded as a plain file and opened the way Library › Import opens one,
and sample notes and workspaces are seeded. Then each screen is opened by deep link and captured in six
variants:

| Variant | Device |
| --- | --- |
| `phone-light`, `phone-dark` | Pixel 6, 411×914 dp |
| `phone-large-text` | Pixel 6 at Android's largest font size (2×) |
| `tablet-light`, `tablet-dark` | 1600×2560 at 320 dpi, 800×1280 dp |
| `tablet-landscape-light` | the tablet turned sideways, an expanded window |

The screens are Read (John 1), Today, Library, Library with sample
imports of a .jwpub (adding, asking to replace, failed), What's New,
Library › Find (searching “watchtower”), Notes, Studyspace, Search and
Appearance. The list lives in `SCREENS` in
`apps/mobile/scripts/emulator-screenshots.ts`; add a screen there when a
new one matters.

What it does not show: anything on iOS, iPadOS or macOS, and screens you
can only reach by tapping through a flow. For those, add screenshots by
hand to the PR description.

## How it works

- `.github/workflows/screenshots.yml` runs on pull requests that touch
  `apps/mobile`, the core crates the app links, or the workflow. It runs
  the PR's code with a read-only token and uploads the images as the
  `screenshots` artifact (half size) and `screenshots-full`.
- `.github/workflows/screenshots-comment.yml` runs from `main` when that
  finishes. It never runs PR code. It accepts only PNGs named
  `<screen>/<variant>.png`, checks that the PR's head is the commit that
  was captured, pushes the images to the `ci-screenshots` branch (one
  commit holding each PR's latest run) and writes the comment itself. This
  split keeps forked PRs from ever holding a write token.
- The in-app setup is the `dev-screenshots` route
  (`apps/mobile/src/app/dev-screenshots.tsx`,
  `apps/mobile/src/screenshots/setup.ts`). It exists in debug builds, and
  in release builds only when `EXPO_PUBLIC_SCREENSHOTS=1`.

## Running it

- On any branch or commit: Actions › screenshots › Run workflow. Give a
  `ref`, and a PR number if the comment should go on a PR (for example
  one that was already merged).
- Locally, with an emulator running and the app installed (debug builds
  have the setup route):

  ```sh
  cd apps/mobile
  node scripts/emulator-screenshots.ts screenshots
  ```

## Reviewing

Open each screen in the comment and check the phone, tablet and largest
text variants: nothing clipped or overlapping, dark mode legible, the
tablet layouts using the space. A run that fails says so in the same
comment, with a link to its log.
