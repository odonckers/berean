# Releasing Berean

Berean has one version for the whole product, `MAJOR.MINOR.PATCH`. The Expo app (`apps/mobile/app.json`, `package.json`, `package-lock.json`) and the Rust crates (`core/*/Cargo.toml`, `core/Cargo.lock`) always carry the same version, and the `repo` check fails a pull request where they don't. Android's `versionCode` is derived from it (`1.2.3` becomes `1002003`). The native Apple apps keep their own version in `apple/project.yml` for now.

While the version is `0.x`, releases are marked as pre-releases on GitHub.

## Cutting a release

1. Open a pull request that sets the new version:

   ```sh
   node scripts/release/version.mjs set 0.2.0
   ```

   Commit the changed files as `Release 0.2.0` and merge the pull request once CI is green.

2. Tag the merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -m "Berean 0.2.0"
   git push origin v0.2.0
   ```

3. The [`release` workflow](../.github/workflows/release.yml) takes it from there. It checks that the tag matches the repository's version, runs the Rust core checks, builds the Android app, and publishes a GitHub Release with notes generated from the merged pull requests and the builds attached:

   - `berean-<version>-android.apk` and `berean-<version>-android.aab` when release signing is configured, or `berean-<version>-android-debug-signed.apk` when it isn't
   - `SHA256SUMS.txt`

   With Google Play configured, it also uploads the AAB to Play's internal testing track as a draft.

To rebuild and re-upload an existing release, run the `release` workflow by hand from the Actions tab with the tag.

## Release notes

GitHub writes the notes from the pull requests merged since the last release, grouped by label ([`.github/release.yml`](../.github/release.yml)). The `labeler` workflow labels pull requests by the files they change (`area: core`, `area: mobile`, `area: apple`, `docs`, `ci`), and Dependabot adds `dependencies`. Give a pull request a clear title, since the title becomes its line in the notes, and label it `skip-changelog` to leave it out.

## Secrets and settings

Signing and store upload are optional. Without these secrets the release still runs and skips those steps.

| Secret | What it is |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The upload keystore (`.jks` or `.keystore`), base64-encoded: `base64 -w0 upload.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore's password |
| `ANDROID_KEY_ALIAS` | The key's alias in the keystore |
| `ANDROID_KEY_PASSWORD` | The key's password |
| `PLAY_SERVICE_ACCOUNT_JSON` | JSON key of a Google Cloud service account with release access to the app in the Play Console |

| Variable | What it does |
| --- | --- |
| `PLAY_TRACK` | Play track to upload to (default `internal`) |
| `DEPENDABOT_AUTOMERGE` | `true` lets Dependabot's patch updates (and minor GitHub Actions updates) merge themselves once required checks pass. Turn it on only after branch protection requires the CI checks. |

Google Play only accepts uploads through the API after the app exists in the Play Console and a first build has been uploaded there by hand.

iOS builds aren't part of the release yet. They need a Mac or EAS Build, and Apple signing credentials.
