package read

import (
	"math"

	"github.com/egoist/mygo/ui"
)

// textInk is the color of text. Fills stay the system colors on the theme
// (Accent, Danger, Warning). These are Apple's increased-contrast variants
// of the same hues, shifted only where that variant is still under 4.5:1
// on a tint mixed from the system color.
type textInk struct {
	link, danger, warning ui.Color
}

func inkFor(dark bool) textInk {
	if !dark {
		return textInk{
			link: ui.Hex("#0040DD"), // increased-contrast system blue
			// #D70015 is the increased-contrast red. On the 16% system-red
			// chip wash it is 4.33:1, so the text steps slightly darker.
			danger:  ui.Hex("#D10014"),
			warning: ui.Hex("#C93400"), // increased-contrast system orange
		}
	}
	return textInk{
		// #409CFF is the increased-contrast blue. On the resolved chip
		// wash it is 3.91:1, so the text steps lighter. The red is
		// #FF6961 stepped lighter for the same reason.
		link:    ui.Hex("#5BAAFF"),
		danger:  ui.Hex("#FF7A73"),
		warning: ui.Hex("#FFB340"), // increased-contrast system orange
	}
}

// contrastPair is one text color on one background the theme paints.
type contrastPair struct {
	name  string
	fg    ui.Color
	bg    ui.Color
	large bool
}

// contrastPairs lists every text-on-background pair the theme paints, in
// one appearance. Chip states and tinted rows are included, not only the
// plain surfaces. large is body text at 18pt or more, or 14pt bold, which
// WCAG scores at 3:1. Nothing here is that large.
func contrastPairs(dark bool) []contrastPair {
	t := appleTheme(dark)
	ink := inkFor(dark)
	side := sidebarSolid(dark)
	marked := coverTint(t.Accent, 0.16, t.Background)
	resolved := coverTint(t.Accent, 0.18, t.Surface)
	broken := coverTint(t.Danger, 0.16, t.Surface)
	surfaces := []struct {
		name string
		bg   ui.Color
	}{
		{"background", t.Background},
		{"surface", t.Surface},
		{"sidebar", side},
		{"marked", marked},
	}
	var out []contrastPair
	add := func(name string, fg, bg ui.Color) {
		out = append(out, contrastPair{name: name, fg: fg, bg: bg})
	}
	for _, s := range surfaces {
		add("text on "+s.name, t.Text, s.bg)
		add("muted on "+s.name, t.TextMuted, s.bg)
		add("link on "+s.name, ink.link, s.bg)
	}
	// Danger and warning are not painted on the blue marked row.
	for _, s := range surfaces[:3] {
		add("danger on "+s.name, ink.danger, s.bg)
		add("warning on "+s.name, ink.warning, s.bg)
	}
	add("chip resolved", ink.link, resolved)
	add("chip broken", ink.danger, broken)
	add("chip error", ink.danger, t.Background)
	add("button label", t.AccentText, t.Accent)
	add("button label hover", t.AccentText, t.AccentHover)
	add("button label pressed", t.AccentText, t.AccentPressed)
	add("tooltip", t.InverseText, t.Inverse)
	return out
}

// contrastRatio is the WCAG 2 contrast of fg on bg. A translucent color is
// composited over the other first.
func contrastRatio(fg, bg ui.Color) float64 {
	if bg.A != 255 {
		bg = bg.Over(ui.Hex("#FFFFFF"))
	}
	if fg.A != 255 {
		fg = fg.Over(bg)
	}
	lighter, darker := relativeLuminance(fg), relativeLuminance(bg)
	if lighter < darker {
		lighter, darker = darker, lighter
	}
	return (lighter + 0.05) / (darker + 0.05)
}

func relativeLuminance(c ui.Color) float64 {
	ch := func(v uint8) float64 {
		s := float64(v) / 255
		if s <= 0.04045 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	return 0.2126*ch(c.R) + 0.7152*ch(c.G) + 0.0722*ch(c.B)
}
