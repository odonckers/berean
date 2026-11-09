# Working on Berean

## UI changes need reviewed screenshots

A pull request that changes what the mobile app shows must not be merged
until its screenshots have been looked at. The screenshots workflow posts
them on the PR as a comment (docs/screenshots.md): open each changed
screen at phone, tablet and largest text sizes, light and dark, and check
that nothing is clipped, overlapping or unreadable. Say in the PR that you
reviewed them. If the screen you changed isn't in the set, add it to
`SCREENS` in `apps/mobile/scripts/emulator-screenshots.ts`, or attach your
own screenshots to the PR.
