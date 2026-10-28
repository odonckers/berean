package read

import (
	"runtime"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// The native look is one theme. appleTheme has Apple's light palette and
// Apple's dark palette; the system appearance picks which one, and the
// view installs it on every frame. The family is the system font.
//
// The left column is the sidebar. It is left unpainted only when the
// window is actually showing a material and the desktop is not asking for
// solid surfaces, so the blur stays on the sidebar. The reading panes and
// the canvas always paint the opaque content color.
//
// MyGo shows a material on macOS and Windows 11. Run asks for the sidebar
// material unless Reduce Transparency (or the platform's equivalent) is
// on. A material that was asked for and does not show is logged. Package
// ui's Preferences does not carry Reduce Transparency, and
// mygo.Theme.Preferences panics outside App.Run, so the window copies the
// flag onto App and the view reads that.

const (
	themeName  = "apple"
	systemFont = "system-ui"
)

// appleTheme returns the one theme for dark or light. Colors are Apple's
// system colors in sRGB: the light value and the dark value of the same
// token. The sidebar material has no single color; sidebarSolid is the
// opaque stand-in.
func appleTheme(dark bool) *ui.Theme {
	black := ui.Hex("#000000")
	white := ui.Hex("#FFFFFF")
	if !dark {
		accent := ui.Hex("#0088FF") // NSColor.systemBlue, light
		return &ui.Theme{
			Background:     white, // windowBackground / controlBackground
			Surface:        white, // controlColor
			SurfaceHover:   white.Mix(black, 0.05),
			SurfacePressed: white.Mix(black, 0.1),
			Border:         ui.RGBA(0, 0, 0, 0.1).Over(white), // separator over the content well
			Text:           ui.RGBA(0, 0, 0, 0.85),            // labelColor
			TextMuted:      ui.RGBA(0, 0, 0, 0.5),             // secondaryLabelColor
			Accent:         accent,
			AccentHover:    accent.Mix(black, 0.12),
			AccentPressed:  accent.Mix(black, 0.24),
			AccentText:     white,
			Danger:         ui.Hex("#FF383C"), // systemRed
			Warning:        ui.Hex("#FF8D28"), // systemOrange
			Success:        ui.Hex("#34C759"), // systemGreen
			Selection:      ui.Hex("#B3D7FF"), // selectedTextBackground
			Focus:          accent.Alpha(0.5),
			Inverse:        ui.Hex("#1E1E1E"),
			InverseText:    white,
			Scrollbar:      ui.RGBA(0, 0, 0, 0.4),
			Radius:         6,
			Spacing:        4,
			FontSize:       systemFontSize(),
			Font:           systemFont,
		}
	}
	content := ui.Hex("#1E1E1E") // windowBackground, dark
	accent := ui.Hex("#0091FF")  // systemBlue, dark
	surface := ui.Hex("#2C2C2E")
	return &ui.Theme{
		Dark:           true,
		Background:     content,
		Surface:        surface,
		SurfaceHover:   surface.Mix(white, 0.08),
		SurfacePressed: surface.Mix(white, 0.14),
		Border:         ui.RGBA(255, 255, 255, 0.1).Over(content),
		Text:           ui.RGBA(255, 255, 255, 0.85),
		TextMuted:      ui.RGBA(255, 255, 255, 0.55),
		Accent:         accent,
		AccentHover:    accent.Mix(white, 0.16),
		AccentPressed:  accent.Mix(white, 0.28),
		AccentText:     white,
		Danger:         ui.Hex("#FF4245"),
		Warning:        ui.Hex("#FF9230"),
		Success:        ui.Hex("#30D158"),
		Selection:      accent.Alpha(0.45),
		Focus:          accent.Alpha(0.7),
		Inverse:        ui.Hex("#F2F2F7"),
		InverseText:    black,
		Scrollbar:      ui.RGBA(255, 255, 255, 0.4),
		Radius:         6,
		Spacing:        4,
		FontSize:       systemFontSize(),
		Font:           systemFont,
	}
}

// systemFontSize is the size MyGo gives the system font: 13 pt on macOS,
// where that is the system text size, and 14 elsewhere.
func systemFontSize() float32 {
	if runtime.GOOS == "darwin" {
		return 13
	}
	return 14
}

// sidebarSolid is the sidebar's opaque color. The material itself is the
// window's blur. This stand-in is an elevated system gray, grouped
// background in the light and an elevated well in the dark, so the sidebar
// stays a separate surface from the content when no blur is shown.
func sidebarSolid(dark bool) ui.Color {
	if dark {
		return ui.Hex("#323234")
	}
	return ui.Hex("#F2F2F7")
}

// sidebarMaterial is the vibrancy to ask the window for. None when the
// desktop wants opaque surfaces.
func sidebarMaterial(reduceTransparency bool) mygo.Vibrancy {
	if reduceTransparency {
		return mygo.VibrancyNone
	}
	return mygo.VibrancySidebar
}

// sidebarClear reports that the sidebar should leave its background
// unpainted. A material the window is not showing stays covered, and so
// does a window whose desktop asked for solid surfaces.
func sidebarClear(showsMaterial, reduceTransparency bool) bool {
	return showsMaterial && !reduceTransparency
}

// windowOptions is the study window: a hidden title bar with the
// platform's own controls, and the sidebar material when it should show.
func (a *App) windowOptions() mygo.WindowOptions {
	return mygo.WindowOptions{
		Title:         "Berean",
		Width:         1440,
		Height:        900,
		TitleBarStyle: mygo.TitleBarHiddenInset,
		Vibrancy:      sidebarMaterial(a.reduceTransparency),
		Content:       ui.View(a.View),
	}
}

// followDesktop copies Reduce Transparency from the running app. Call it
// on the main thread, from WhenReady and from Theme.OnUpdated.
func (a *App) followDesktop() {
	a.reduceTransparency = mygo.Theme.Preferences().ReduceTransparency
}

// applyLook installs the palette for the appearance MyGo is following.
// c.Theme().Dark is that appearance until SetTheme replaces the theme.
func (a *App) applyLook(c *ui.Context) {
	dark := c.Theme().Dark
	scale := c.Preferences().TextScale
	if scale <= 0 {
		scale = 1
	}
	if a.look == nil || a.lookDark != dark || a.lookScale != scale {
		t := appleTheme(dark)
		if scale != 1 {
			t.FontSize *= scale
		}
		a.look = t
		a.lookDark = dark
		a.lookScale = scale
	}
	c.SetTheme(a.look)
	a.logAppearance(dark)
}

func (a *App) logAppearance(dark bool) {
	if a.log == nil {
		return
	}
	mode := "light"
	if dark {
		mode = "dark"
	}
	material := "none"
	if sidebarMaterial(a.reduceTransparency) == mygo.VibrancySidebar {
		material = "sidebar"
	}
	if a.appearanceLogged && a.loggedMode == mode && a.loggedReduce == a.reduceTransparency {
		return
	}
	a.appearanceLogged = true
	a.loggedMode = mode
	a.loggedReduce = a.reduceTransparency
	a.log.Info("appearance",
		"theme", themeName,
		"mode", mode,
		"font", systemFont,
		"reduce_transparency", a.reduceTransparency,
		"vibrancy", material,
	)
}

// noteVibrancy logs the material the sidebar is using, and an error when
// a material was asked for and the window is not showing it.
func (a *App) noteVibrancy(showsMaterial bool) {
	if a.log == nil {
		return
	}
	want := sidebarMaterial(a.reduceTransparency)
	state := "none"
	switch {
	case want == mygo.VibrancyNone:
		state = "none"
	case showsMaterial:
		state = "sidebar"
	default:
		state = "failed"
	}
	if state == a.loggedVibrancy {
		return
	}
	a.loggedVibrancy = state
	if state == "failed" {
		a.log.Error("vibrancy", "material", string(want), "applied", false, "err", "material did not apply")
		return
	}
	a.log.Info("vibrancy", "material", state, "applied", state == "sidebar")
}
