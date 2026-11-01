// Removed. The in-app `cacheDisplay(in:to:)` capture could not render system
// materials (Liquid Glass came out blank), so it could never prove the thing it
// existed to prove. Real window screenshots replace it, and DebugLaunch.swift
// holds the launch hooks that set a window up for one.
//
// PENDING DELETION: `rm` and `git rm` were blocked in the session that emptied
// this file, so it is left here with no contents. Run:
//
//     git rm apple/Apps/macOS/DebugSnapshot.swift
