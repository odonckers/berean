# berean

Personal study library. Publications stay on this machine; nothing in this repository is for redistribution.

```
berean
berean open
berean import file.jwpub
berean cite "w23.01 p. 2 par. 3"
berean bench
berean version
```

The database file is `berean.db` in the current directory unless `-db` says otherwise.

`go test ./...` downloads the fixture publications into `testdata/cache` (gitignored) and skips those tests when the download is unavailable.
