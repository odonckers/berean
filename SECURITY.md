# Security policy

## Reporting a vulnerability

Please don't report security problems in public issues, discussions or pull requests.

Report them privately through GitHub instead: open [**Report a vulnerability**](https://github.com/odonckers/berean/security/advisories/new) on the repository's Security tab. Only the maintainers can see the report.

Please include:

- what the problem is and what an attacker could do with it
- the steps or a file that reproduces it (for example a crafted `.jwpub` or `.jwlibrary` backup)
- the platform, app version or commit you tested

You'll get an acknowledgement within a week. Berean is maintained by volunteers, so a fix may take longer; we'll keep you updated in the advisory and credit you when it's published, unless you'd rather stay anonymous.

## What's in scope

Berean opens files it didn't create: publication files, catalog databases and backups. Problems in how the Rust core reads, decrypts or stores them are the most important to hear about, along with anything that could expose a user's notes, highlights or other study data.

## Supported versions

Fixes go into `main` and ship in the next release. Older releases aren't patched.
