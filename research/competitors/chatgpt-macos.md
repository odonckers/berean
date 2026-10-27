# ChatGPT for macOS (design reference: native Mac feel)

- **Date checked:** 2026-10-26
- **Why it's here:** Owen likes how ChatGPT feels native on the Mac: its transparency, spacing and layout. This file is a **design reference, not a competitor**. It has no canvas, citations or study features.
- **Sources:**
  - Download and requirements: https://help.openai.com/en/articles/9275200-downloading-the-chatgpt-macos-app
  - macOS release notes: https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes
  - Chat Bar: https://help.openai.com/en/articles/9295241-how-to-launch-the-chat-bar
  - Moving to the new app: https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app
  - ChatGPT release notes (web): https://help.openai.com/en/articles/6825453-chatgpt-release-notes
  - Native build (OpenAI's Javi, via AAPL Ch.): https://applech2.com/archives/20240514-chatgpt-for-mac.html
  - Reviews: https://allenpike.com/2025/why-is-chatgpt-so-good-claude/, https://www.macstories.net/linked/why-is-chatgpt-for-mac-so-good/, https://daringfireball.net/linked/2026/07/06/allen-pike-chatgpt, https://9to5mac.com/2026/07/09/openai-announcing-the-next-chapter-for-chatgpt-today-watch-here/, https://9to5mac.com/2026/07/17/openai-fixes-chat-access-in-the-chatgpt-app-for-mac/, https://spyglass.org/chatgpt-gets-to-work/
  - Apple: WWDC25 session 310 https://developer.apple.com/videos/play/wwdc2025/310/ and the HIG pages listed below

## First, which app? (important)
There are now two ChatGPT Mac apps, and only one of them is native.
- **ChatGPT Classic:** the original Mac app. On July 9, 2026 it was renamed "ChatGPT Classic" and "continues to be supported" ([download help](https://help.openai.com/en/articles/9275200-downloading-the-chatgpt-macos-app)). It "continues to receive model updates, bug fixes, security patches" ([moving help](https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app)).
  - At launch, OpenAI's Javi said it is "a fully native macOS app. Not Electron. Not even Catalyst." AAPL Ch. reports it was built with SwiftUI and AppKit ([AAPL Ch.](https://applech2.com/archives/20240514-chatgpt-for-mac.html)).
  - A Hacker News commenter (saagarjha, third-party, not OpenAI) wrote: "They have some shared SwiftUI code and AppKit for platform native stuff" ([HN](https://news.ycombinator.com/item?id=45690616)).
- **New ChatGPT app (Chat + Work + Codex):** the old Codex app, renamed ([9to5Mac, Jul 9](https://9to5mac.com/2026/07/09/openai-announcing-the-next-chapter-for-chatgpt-today-watch-here/)). 9to5Mac says it "replaced the previous native Mac client with a much larger Electron-based app" ([9to5Mac, Jul 17](https://9to5mac.com/2026/07/17/openai-fixes-chat-access-in-the-chatgpt-app-for-mac/)). Desktop Insights lists its runtime as Electron, at 1924 MB ([desktopinsights](https://desktopinsights.com/apps/chatgpt)).
- 9to5Mac: "The ChatGPT Classic app looks more native Mac-like" ([Jul 9](https://9to5mac.com/2026/07/09/openai-announcing-the-next-chapter-for-chatgpt-today-watch-here/)).
- **Open question for Owen:** the native feel he likes most likely comes from **Classic**, but he may be using the new app. Everything below is about Classic unless a line says "new app".

## Who it's for and pricing
- Anyone with a ChatGPT account. It requires macOS 14 and runs on Apple Silicon or Intel. Download it at https://chatgpt.com/download/ ([download help](https://help.openai.com/en/articles/9275200-downloading-the-chatgpt-macos-app)).
- The app's own price: **unverified** (we did not find an official statement about it). Some features need a paid plan; for example, Work with Apps launched for Plus and Teams users ([release notes](https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes)).

## Window chrome: sidebar, toolbar, title bar, translucency
- **Sidebar and toolbar (Classic):** the release notes mention a sidebar ("Fixed renaming chats in the sidebar"), "the keyboard shortcut for toggling the sidebar", and "native support for customizing the layout of the window toolbar". A customizable toolbar is a standard AppKit behavior ([release notes](https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes)).
- **Title bar (observed in a screenshot):** in the 2024 launch image, the traffic lights, a sidebar toggle and a model picker ("ChatGPT 4 >") share one unified title bar/toolbar row, with a new-chat button on the right. The composer is a rounded pill along the bottom, with an attach button on the left and mic and voice buttons on the right ([AAPL Ch. image](https://applech2.com/wp-content/uploads/2024/05/OpenAI-ChatGPT-for-Mac-Hero.jpg)). This is a visual reading of one image, not a spec.
- **Translucency and Liquid Glass:**
  - A r/MacOS post titled "ChatGPT finally adopts Liquid Glass in the Mac…" cites version 1.2025.343, posted Dec 16, 2025 ([Reddit](https://www.reddit.com/r/MacOS/comments/1podg1z/chatgpt_finally_adopts_liquid_glass_in_the_mac/); title and search snippet only, because Reddit blocks fetches). **Unverified:** what exactly changed, and how much vibrancy Classic used before then.
  - New app: in screenshots, the sidebar appears translucent, with the wallpaper tinting through it ([Spyglass screenshot](https://storage.ghost.io/c/af/ca/afcaa655-46e2-45b8-889a-2881de5cce69/content/images/2026/07/Screenshot-2026-07-10-at-1.25.04---PM.png)). This is observed, not documented.
- **Light and dark mode:** the new app's Settings include an "Appearance" item ([Spyglass screenshot](https://storage.ghost.io/c/af/ca/afcaa655-46e2-45b8-889a-2881de5cce69/content/images/2026/07/Screenshot-2026-07-10-at-1.04.32---PM.png)). Classic's dark-mode behavior: **unverified** (no official source found).

## Spacing, typography, layout
- **No public source states ChatGPT's padding values, font, layout grid or message column width.** All of these are **unverified**, and we did not estimate any of them.
- What Apple's HIG says (these are platform defaults, not ChatGPT measurements):
  - "SF Pro is the system font in macOS." The macOS default text size is 13 pt and the minimum is 10 pt. "macOS doesn't support Dynamic Type" ([Typography](https://developer.apple.com/design/human-interface-guidelines/typography)).
  - The system has "predefined layout guides that make it easy to apply standard margins around content and restrict the width of text for optimal readability" ([Layout](https://developer.apple.com/design/human-interface-guidelines/layout)).
- **Composer placement:** at the bottom of the window (screenshot above). In the new app, Spyglass says Chat opens as "a pop-up box from the bottom of the window" ([Spyglass](https://spyglass.org/chatgpt-gets-to-work/)).

## Native behaviors
- **Chat Bar / companion window:**
  - ⌥+Space by default. You can drag it anywhere on the desktop, open it from the menu bar icon, and attach files or screenshots. The shortcut can be changed in Settings ([Chat Bar help](https://help.openai.com/en/articles/9295241-how-to-launch-the-chat-bar)).
  - It "stays in front of all other windows". ⌥Space starts a new chat, refocuses an open companion window, or reopens the last one. Its position, reset time and shortcut can be customized, and you can pop a past conversation out into it ([release notes](https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes)).
  - The global shortcut stops working if the menu bar icon is disabled ([HeyDingus](https://heydingus.net/blog/2025/1/quick-tip-get-chatgpts-global-keyboard-shortcut-working-again-in-5-seconds-flat)).
- **Shortcuts and menus** ([release notes](https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes)):
  - Cmd+. stops streaming. Cmd+Shift+1 shares the desktop and Cmd+Shift+2 the active window.
  - Cmd+F or the app menu finds text in a conversation. There is a shortcut to toggle the sidebar.
- **Platform integration** ([release notes](https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes)):
  - Apple Handoff with iOS, notifications when a reply finishes in the background, and an option to turn off macOS autocorrect.
  - A choice of showing the app in the menu bar, the Dock, or both, plus Launch at Login.
  - Draft messages are restored, and responses fade in.
  - Work with Apps uses the macOS Accessibility API ([help](https://help.openai.com/en/articles/10119604-work-with-apps-on-macos)).
- **Full screen:** a fix for "items would appear overlapped in fullscreen mode" confirms full screen is supported ([release notes](https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes)). **Default and minimum window sizes: unverified.**

## What users and reviewers say
- **Praise (Classic):**
  - Allen Pike: "The app does a good job of following the platform conventions on Mac. That means buttons, text fields, and menus behave as they do in other Mac apps" ([MacStories quoting Pike](https://www.macstories.net/linked/why-is-chatgpt-for-mac-so-good/); [original](https://allenpike.com/2025/why-is-chatgpt-so-good-claude/)).
  - Federico Viticci called it "one of the nicest AI apps for Mac I've used" ([MacStories](https://www.macstories.net/linked/why-is-chatgpt-for-mac-so-good/)).
  - John Gruber: "It's that it looks and feels like a Mac app — you know, with a Settings window that is ... a window." He also praised the live attachment to BBEdit or Notes documents: "Almost all good Mac apps are native; not all native Mac apps are good" ([Daring Fireball](https://daringfireball.net/linked/2026/07/06/allen-pike-chatgpt)).
- **Criticism:**
  - Pike later acknowledged bugs, including copy-paste issues (per search synthesis of https://allenpike.com/series/llm/; **not read directly**).
  - On the new app, 9to5Mac reported "a much larger Electron-based app". Chat was "relegated to a less prominent button that opened a floating window without access to users' existing conversation history or Projects." OpenAI then added a Chat/Work toggle at the top of the window ([9to5Mac Jul 17](https://9to5mac.com/2026/07/17/openai-fixes-chat-access-in-the-chatgpt-app-for-mac/)).
  - Spyglass: "I'm confused… it's seemingly no longer a native Mac app but instead a bloated Electron package." Chat sits in the sidebar under New task, Scheduled and Plugins ([Spyglass](https://spyglass.org/chatgpt-gets-to-work/)).
  - A Medium author says the old left sidebar was replaced by "a floating panel" with only a few recent chats, and Projects were missing. He restored Classic ([Medium](https://medium.com/@virtualdata/openais-new-chatgpt-mac-app-broke-my-workflow-here-s-how-i-restored-chatgpt-classic-2950b1236b5c)).
  - Reddit r/ChatGPTPro: history "buried at the bottom" and no "/" search shortcut ([thread](https://www.reddit.com/r/ChatGPTPro/comments/1ux6eyz/the_new_chatgpt_macos_app_redesign_has_made_basic/); snippet only).

## Apple HIG and WWDC references
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): Liquid Glass "forms a distinct functional layer for controls and navigation elements — like tab bars and sidebars — that floats above the content layer". "Don't use Liquid Glass in the content layer." "Use Liquid Glass effects sparingly." Standard materials "help with visual differentiation within the content layer."
- [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars): in macOS, "sidebars can float above content in the Liquid Glass layer". Offer a show/hide button, or Show Sidebar and Hide Sidebar commands in the View menu.
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars): "consider letting people customize the toolbar". "Provide a useful title for each window"; Notes leaves its title empty when the first line already gives context.
- [Windows](https://developer.apple.com/design/human-interface-guidelines/windows): "Choose a minimum and maximum size for each window".
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) and [Typography](https://developer.apple.com/design/human-interface-guidelines/typography): see above.
- [WWDC25 session 310](https://developer.apple.com/videos/play/wwdc2025/310/) (AppKit):
  - Sidebars "appear as a pane of glass that floats above the window's content", via NSSplitViewController.
  - "If you're using an NSVisualEffectView to display that material inside of your sidebar, it will prevent the glass material from showing through."
  - Also covers NSBackgroundExtensionView, concentric corners, and larger window corner radii.

## What Berean could take
1. **A floating glass sidebar over an opaque reading pane and canvas.** Put the library/outline sidebar in the glass (functional) layer, and keep the reading pane and canvas opaque. This follows HIG Materials ("Don't use Liquid Glass in the content layer") and WWDC25 310's floating sidebar. MyGo's docs show this exact layout: a transparent root, a sidebar over the material, and opaque content beside it (see Hex question).
2. **A global-hotkey quick-capture window, like ⌥Space.** A small floating window that "stays in front of all other windows", where Owen can jot a note or a `jwcite:` while JW Library or a browser is in front. It should drop the clip onto the current canvas. MyGo documents global shortcuts, always-on-top windows and frameless glass HUD windows ([MyGo README](https://github.com/egoist/mygo), [windows.md](https://github.com/egoist/mygo/blob/main/docs/ui/windows.md)). Avoid ChatGPT's pitfall where the hotkey dies with the menu bar icon ([HeyDingus](https://heydingus.net/blog/2025/1/quick-tip-get-chatgpts-global-keyboard-shortcut-working-again-in-5-seconds-flat)).
3. **Mac conventions reviewers notice:**
   - A real Settings window, a customizable toolbar, View-menu commands for showing and hiding the sidebar, Cmd+F find in the reading pane, and window title = current study.
   - Use SF Pro at 13 pt as the default UI text, per HIG.
   - Pike and Gruber both praise exactly this ("behave as they do in other Mac apps"; "a Settings window that is ... a window").
4. **Never bury navigation.** The 2026 redesign backlash was about history and Projects disappearing behind a floating panel ([9to5Mac](https://9to5mac.com/2026/07/17/openai-fixes-chat-access-in-the-chatgpt-app-for-mac/), [Medium](https://medium.com/@virtualdata/openais-new-chatgpt-mac-app-broke-my-workflow-here-s-how-i-restored-chatgpt-classic-2950b1236b5c)). Keep studies and canvases one click away in the sidebar.
5. **Use system vibrancy and respect Reduce Transparency, rather than painting a fake blur.** Real materials pick up the desktop and adapt to light and dark mode. MyGo exposes `ReduceTransparency` ("the desktop asks for opaque surfaces, e.g. no vibrancy") so Berean can fall back to opaque ([native.md](https://github.com/egoist/mygo/blob/main/docs/native.md)).

## Open question for Hex: can Berean (Go + MyGo) get real macOS vibrancy?
**The docs say yes. We have not tested it.**
- Berean pins `github.com/egoist/mygo v0.6.4` (go.mod). It opens one native-UI window (`Content: ui.View(a.View)`, 1440×900) with no vibrancy option set (`internal/read/app.go`).
- MyGo has `WindowOptions.Vibrancy`. On macOS it "has all of them (NSVisualEffectView materials, and from macOS 26 Liquid Glass)", including `VibrancySidebar`, `VibrancyTitlebar`, `VibrancyGlass` (NSGlassEffectView) and others. Linux has none ([vibrancy.go](https://github.com/egoist/mygo/blob/main/vibrancy.go)). The file exists at the v0.6.4 tag.
- How to use it, from [docs/ui/windows.md](https://github.com/egoist/mygo/blob/main/docs/ui/windows.md):
  - The material "shows wherever its native UI draws no background". Check `c.Vibrancy()`, make the root transparent, and give opaque backgrounds to the content.
  - Text over the material is "antialiased in grayscale".
  - `TitleBarHidden` lets the view draw under the traffic lights.
  - `SetActiveAppearance` uses "a private AppKit call… apps for the Mac App Store should leave it off".
- [`examples/vibrancy`](https://github.com/egoist/mygo/tree/main/examples/vibrancy) is "a sidebar over a translucent material, under a hidden title bar… the traffic lights inset over the sidebar". That is close to the ChatGPT Classic look.
- The separate **glass plugin** draws Liquid Glass with shaders over *in-window* content, the same on every platform. Useful for a toolbar floating over the canvas ([glass.md](https://github.com/egoist/mygo/blob/main/docs/plugins/glass.md)).
- **For Hex to confirm:**
  - (a) Does a transparent root conflict with the canvas renderer's background or performance?
  - (b) Is grayscale antialiasing acceptable for reading-pane text? Keep the reading pane opaque.
  - (c) Does it work on macOS 14/15 (NSVisualEffectView) as well as 26 (glass)?
  - (d) WWDC25 warns that an NSVisualEffectView inside a sidebar blocks the macOS 26 glass, so which material should the sidebar use on 26?
- **Other Go precedent:**
  - Wails v3 has `MacBackdropTranslucent` / `MacBackdropLiquidGlass` and NSVisualEffectMaterial options ([options](https://github.com/wailsapp/wails/blob/master/v3/pkg/application/webview_window_options.go)). It added NSGlassEffectView with an NSVisualEffectView fallback ([PR #4534](https://github.com/wailsapp/wails/pull/4534)).
  - We found no vibrancy evidence for Fyne or Gio.

## Screenshots (captured 2026-10-26)
Images are third-party press or review screenshots, saved for internal research only.
- [`screenshots/chatgpt-classic-window.png`](screenshots/chatgpt-classic-window.png): Classic launch image showing the unified title bar and the bottom composer pill. Source: https://applech2.com/wp-content/uploads/2024/05/OpenAI-ChatGPT-for-Mac-Hero.jpg (article: https://applech2.com/archives/20240514-chatgpt-for-mac.html)
- [`screenshots/chatgpt-classic-app-info.png`](screenshots/chatgpt-classic-app-info.png): Classic app info for v1.2024.130 (134.4 MB, "Requires macOS 14.0 or later"), for comparison with the new app's size. Source: https://applech2.com/wp-content/uploads/2024/05/OpenAI-ChatGPT-for-Mac-features-3.jpg
- [`screenshots/chatgpt-new-app-sidebar.png`](screenshots/chatgpt-new-app-sidebar.png): new app (Work) with a translucent-looking sidebar, task pane and browser pane. Source: https://storage.ghost.io/c/af/ca/afcaa655-46e2-45b8-889a-2881de5cce69/content/images/2026/07/Screenshot-2026-07-10-at-1.25.04---PM.png (article: https://spyglass.org/chatgpt-gets-to-work/)
- [`screenshots/chatgpt-new-app-settings.png`](screenshots/chatgpt-new-app-settings.png): new app Settings, with a sidebar list and grouped rounded sections including Appearance. Source: https://storage.ghost.io/c/af/ca/afcaa655-46e2-45b8-889a-2881de5cce69/content/images/2026/07/Screenshot-2026-07-10-at-1.04.32---PM.png
- Not captured: a Classic screenshot with Liquid Glass (1.2025.343 or later). **Gap.**

## Unverified
- The app's own price.
- Classic's font, padding, column width, default and minimum window size, and dark-mode behavior.
- What the Liquid Glass update changed (Reddit snippet only).
- Pike's later bug list (search synthesis only).
- Whether MyGo vibrancy works with Berean's canvas (docs only; not run).
