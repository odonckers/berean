package read

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/library"
)

func TestAppleThemeFollowsAppearance(t *testing.T) {
	light, dark := appleTheme(false), appleTheme(true)
	if light.Dark || !dark.Dark {
		t.Fatalf("light dark=%v, dark dark=%v", light.Dark, dark.Dark)
	}
	if light.Font != systemFont || dark.Font != systemFont {
		t.Fatalf("font light %q dark %q, want %s", light.Font, dark.Font, systemFont)
	}
	if light.FontSize != systemFontSize() || dark.FontSize != systemFontSize() {
		t.Fatalf("font size light %v dark %v, want %v", light.FontSize, dark.FontSize, systemFontSize())
	}
	if light.Background != ui.Hex("#FFFFFF") || light.Accent != ui.Hex("#0088FF") || light.Danger != ui.Hex("#FF383C") {
		t.Fatalf("light palette: background %v accent %v danger %v", light.Background, light.Accent, light.Danger)
	}
	if dark.Background != ui.Hex("#1E1E1E") || dark.Accent != ui.Hex("#0091FF") || dark.Danger != ui.Hex("#FF4245") {
		t.Fatalf("dark palette: background %v accent %v danger %v", dark.Background, dark.Accent, dark.Danger)
	}
	if light.Text != (ui.RGBA(0, 0, 0, 0.85)) || dark.Text != (ui.RGBA(255, 255, 255, 0.85)) {
		t.Fatalf("label light %v dark %v", light.Text, dark.Text)
	}
	if light.Background == dark.Background || light.Accent == dark.Accent || sidebarSolid(false) == sidebarSolid(true) {
		t.Fatal("light and dark tokens did not switch")
	}

	var logBuf bytes.Buffer
	app := newLookApp(t, &logBuf)
	tt := newLookTester(app, false, false)
	if got := tt.Image().RGBAAt(1000, 400); got != rgbaOf(light.Background) {
		t.Fatalf("light content pixel %v, want %v", got, rgbaOf(light.Background))
	}
	if got := tt.Image().RGBAAt(4, 4); got != rgbaOf(sidebarSolid(false)) {
		t.Fatalf("light sidebar pixel %v, want solid %v", got, rgbaOf(sidebarSolid(false)))
	}

	tt.SetDark(true)
	tt.Frame()
	if got := tt.Image().RGBAAt(1000, 400); got != rgbaOf(dark.Background) {
		t.Fatalf("dark content pixel %v, want %v", got, rgbaOf(dark.Background))
	}
	if got := tt.Image().RGBAAt(4, 4); got != rgbaOf(sidebarSolid(true)) {
		t.Fatalf("dark sidebar pixel %v, want solid %v", got, rgbaOf(sidebarSolid(true)))
	}
	log := logBuf.String()
	if !strings.Contains(log, "theme=apple") || !strings.Contains(log, "mode=light") || !strings.Contains(log, "mode=dark") || !strings.Contains(log, "font="+systemFont) {
		t.Fatalf("appearance log:\n%s", log)
	}
}

func TestSidebarSolidWhenReduceTransparency(t *testing.T) {
	var logBuf bytes.Buffer
	app := newLookApp(t, &logBuf)
	app.reduceTransparency = true
	// The window would be showing a material. Reduce Transparency still
	// paints the sidebar solid.
	tt := newLookTester(app, false, true)

	solid := rgbaOf(sidebarSolid(false))
	content := rgbaOf(appleTheme(false).Background)
	img := tt.Image()
	if got := img.RGBAAt(4, 4); got != solid {
		t.Fatalf("sidebar under reduce transparency %v, want solid %v", got, solid)
	}
	if got := img.RGBAAt(1000, 400); got != content {
		t.Fatalf("content under reduce transparency %v, want %v", got, content)
	}
	if got := img.RGBAAt(200, 220); got != content {
		t.Fatalf("reading surface under reduce transparency %v, want opaque content %v", got, content)
	}
	log := logBuf.String()
	if !strings.Contains(log, "reduce_transparency=true") || !strings.Contains(log, "vibrancy=none") {
		t.Fatalf("expected a solid vibrancy choice:\n%s", log)
	}
	if strings.Contains(log, "material did not apply") {
		t.Fatalf("reduce transparency was logged as a failed material:\n%s", log)
	}
	if sidebarMaterial(true) != mygo.VibrancyNone || sidebarClear(true, true) {
		t.Fatal("reduce transparency still asked for a material")
	}
}

func TestSidebarSolidWhenVibrancyDoesNotApply(t *testing.T) {
	var logBuf bytes.Buffer
	app := newLookApp(t, &logBuf)
	tt := newLookTester(app, false, false)

	solid := rgbaOf(sidebarSolid(false))
	content := rgbaOf(appleTheme(false).Background)
	img := tt.Image()
	if got := img.RGBAAt(4, 4); got != solid {
		t.Fatalf("sidebar without a material %v, want solid %v", got, solid)
	}
	if got := img.RGBAAt(1000, 400); got != content {
		t.Fatalf("content without a material %v, want %v", got, content)
	}
	log := logBuf.String()
	if !strings.Contains(log, "reduce_transparency=false") || !strings.Contains(log, "vibrancy=sidebar") {
		t.Fatalf("expected a sidebar material to be requested:\n%s", log)
	}
	if !strings.Contains(log, "msg=vibrancy") || !strings.Contains(log, "applied=false") || !strings.Contains(log, "material did not apply") {
		t.Fatalf("expected a vibrancy failure:\n%s", log)
	}
	if sidebarMaterial(false) != mygo.VibrancySidebar || sidebarClear(false, false) {
		t.Fatal("a platform without a material was treated as clear")
	}
}

func TestSidebarClearOnlyOverMaterial(t *testing.T) {
	var logBuf bytes.Buffer
	app := newLookApp(t, &logBuf)
	tt := newLookTester(app, false, true)

	content := rgbaOf(appleTheme(false).Background)
	img := tt.Image()
	if got := img.RGBAAt(4, 4); got.A != 0 {
		t.Fatalf("sidebar over a material %v, want unpainted", got)
	}
	if got := img.RGBAAt(1000, 400); got != content {
		t.Fatalf("canvas over a material %v, want opaque content %v", got, content)
	}
	if got := img.RGBAAt(200, 220); got != content {
		t.Fatalf("reading surface over a material %v, want opaque content %v", got, content)
	}
	log := logBuf.String()
	if !strings.Contains(log, "material=sidebar") || !strings.Contains(log, "applied=true") {
		t.Fatalf("expected the sidebar material to apply:\n%s", log)
	}
	if strings.Contains(log, "material did not apply") {
		t.Fatalf("applied material was logged as a failure:\n%s", log)
	}
}

func TestWindowKeepsNativeControls(t *testing.T) {
	a := &App{}
	opts := a.windowOptions()
	if opts.TitleBarStyle != mygo.TitleBarHiddenInset {
		t.Fatalf("title bar %q", opts.TitleBarStyle)
	}
	if opts.Frameless || opts.HideWindowButtons {
		t.Fatalf("window draws its own controls: frameless %v hide %v", opts.Frameless, opts.HideWindowButtons)
	}
	if opts.Vibrancy != mygo.VibrancySidebar {
		t.Fatalf("vibrancy %q", opts.Vibrancy)
	}
	a.reduceTransparency = true
	if got := a.windowOptions().Vibrancy; got != mygo.VibrancyNone {
		t.Fatalf("vibrancy with reduce transparency %q", got)
	}
}

func TestLookShots(t *testing.T) {
	dir := os.Getenv("BEREAN_SHOTS")
	if dir == "" {
		t.Skip("BEREAN_SHOTS is unset")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	save := func(name string, img *image.RGBA) {
		t.Helper()
		f, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if err := png.Encode(f, img); err != nil {
			t.Fatal(err)
		}
	}
	render := func(dark, reduce, vibrancy bool) *image.RGBA {
		t.Helper()
		app := newLookApp(t, &bytes.Buffer{})
		app.reduceTransparency = reduce
		return newLookTester(app, dark, vibrancy).Image()
	}
	save("light.png", render(false, false, false))
	save("dark.png", render(true, false, false))
	save("solid-fallback.png", render(false, true, true))
	// The headless renderer has no desktop behind a clear sidebar. Composite
	// one so the unpainted sidebar is visible in the picture.
	save("light-material.png", compositeClear(render(false, false, true), color.RGBA{R: 186, G: 214, B: 232, A: 255}))
	save("dark-material.png", compositeClear(render(true, false, true), color.RGBA{R: 70, G: 92, B: 110, A: 255}))
}

// newLookTester paints app once, after dark and vibrancy are set. The
// tester's own first frame happens before those calls, so the view waits.
func newLookTester(app *App, dark, vibrancy bool) *ui.Tester {
	show := false
	tt := ui.NewTester(func(c *ui.Context) {
		if show {
			app.View(c)
		}
	}, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.SetDark(dark)
	tt.SetVibrancy(vibrancy)
	show = true
	tt.Frame()
	return tt
}

func newLookApp(t *testing.T, logBuf *bytes.Buffer) *App {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(logBuf, nil))
	lib, err := library.Open(filepath.Join(t.TempDir(), "berean.db"), logger)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	app, err := New(lib, logger)
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func rgbaOf(c ui.Color) color.RGBA {
	return color.RGBA{R: c.R, G: c.G, B: c.B, A: c.A}
}

// compositeClear lays wallpaper under pixels the view left unpainted.
func compositeClear(img *image.RGBA, wallpaper color.RGBA) *image.RGBA {
	out := image.NewRGBA(img.Bounds())
	for y := 0; y < img.Bounds().Dy(); y++ {
		for x := 0; x < img.Bounds().Dx(); x++ {
			p := img.RGBAAt(x, y)
			if p.A == 255 {
				out.SetRGBA(x, y, p)
				continue
			}
			a := float32(p.A) / 255
			out.SetRGBA(x, y, color.RGBA{
				R: uint8(float32(p.R)*a + float32(wallpaper.R)*(1-a) + 0.5),
				G: uint8(float32(p.G)*a + float32(wallpaper.G)*(1-a) + 0.5),
				B: uint8(float32(p.B)*a + float32(wallpaper.B)*(1-a) + 0.5),
				A: 255,
			})
		}
	}
	return out
}
