package read

import (
	"bytes"
	"context"
	"fmt"
	"image/png"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/library"
)

func TestReadingPanes(t *testing.T) {
	ctx := context.Background()
	wPath := mustFixture(t, "w", "202301", "w_E_202301.jwpub", "52e756833e0fcd9183eb5d2c0bcd3437")
	nwtPath := mustFixture(t, "nwt", "", "nwt_E.jwpub", "fe3ee3beb5e0605af2da1db7fd658e46")
	styPath := mustFixture(t, "nwtsty", "", "nwtsty_E.jwpub", "c15e1d9328ab11950cde1677c0aa0929")
	rsgPath := mustFixture(t, "rsg", "", "rsg_E.jwpub", "1620026ee09080eb2e33b383b6467d6b")

	lib, err := library.Open(filepath.Join(t.TempDir(), "berean.db"), slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	for _, path := range []string{wPath, nwtPath, styPath, rsgPath} {
		start := time.Now()
		res, err := lib.Import(ctx, path)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("import %s documents=%d paragraphs=%d verses=%d duration=%s", res.Symbol, res.Documents, res.Paragraphs, res.Verses, time.Since(start))
	}

	examples := []struct {
		href string
		kind library.LinkKind
		want string
	}{
		{"jwpub://b/NWTR/20:2:1-20:2:5", library.LinkVerse, "Proverbs 2:1-5"},
		{"jwpub://p/E:1200029221/", library.LinkDocument, "Jochebed"},
		{"jwpub://p/E:1200029218/", library.LinkDocument, "Moses"},
		{"jwpub://c/E:1001070144/24:12", library.LinkVerse, "Matthew 24:12"},
		{"jwpub://p/E:1200001287/1-10", library.LinkMissing, "meps document 1200001287 is not in the library, paragraphs 1-10"},
	}
	for _, ex := range examples {
		got, err := lib.ResolveLink(ctx, ex.href)
		if err != nil {
			t.Fatalf("%s: %v", ex.href, err)
		}
		if got.Kind != ex.kind || !strings.Contains(got.String(), ex.want) {
			t.Fatalf("%s resolved to %s (%v), want kind %v containing %q", ex.href, got.String(), got.Kind, ex.kind, ex.want)
		}
		t.Logf("link %s -> %s", ex.href, got.String())
	}

	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	app, err := New(lib, logger)
	if err != nil {
		t.Fatal(err)
	}
	w, nwt, sty, rsg := pubsBySymbol(t, app)
	app.pubID = w.ID
	app.docID = 2
	app.book = 40
	app.chapter = 24
	app.trans[0], app.trans[1] = nwt.ID, sty.ID
	app.transChoice[0], app.transChoice[1] = "", ""

	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()

	const par3 = "How can we help others to have the same confidence"
	if !tt.HasText(par3) {
		t.Fatalf("paragraph 3 text missing, sample %q", sampleTexts(tt, "How can"))
	}
	wantSrc := fmt.Sprintf("src pub=%s year=%d issue=%d doc=2 pid=8", w.Symbol, w.Year, w.Issue)
	if !tt.HasText(wantSrc) {
		t.Fatalf("source label %q missing", wantSrc)
	}
	if !tt.HasText("ACCURATELY PRESERVED") {
		t.Fatal("study-article heading is missing")
	}
	boldHeading := false
	italic := false
	for _, b := range app.blocks {
		for _, r := range b.runs {
			if r.Bold && strings.Contains(r.Text, "ACCURATELY PRESERVED") {
				boldHeading = true
			}
			if r.Italic && strings.TrimSpace(r.Text) != "" {
				italic = true
			}
		}
	}
	if !boldHeading {
		t.Fatal("heading run is not bold")
	}
	t.Logf("study article has an italic run: %v", italic)

	matt, err := lib.Resolve(ctx, "Matt. 24:14")
	if err != nil || len(matt) != 2 {
		t.Fatalf("Matt. 24:14 hits: %v %d", err, len(matt))
	}
	verse := matt[0].Text
	shown := 0
	for _, s := range tt.Texts() {
		if strings.Contains(s, verse) {
			shown++
		}
	}
	if shown < 2 {
		t.Fatalf("verse 14 shown in %d texts, want both translations", shown)
	}
	for _, p := range []library.PublicationInfo{nwt, sty} {
		src := fmt.Sprintf("src bible=%s year=%d book=40 chapter=24 verse=14", p.Symbol, p.Year)
		if !tt.HasText(src) {
			t.Fatalf("verse source %q missing", src)
		}
	}

	app.focusPar = true
	app.focusParFrom, app.focusParTo = 8, 8
	tt.Frame()
	saveShot(t, tt, "publication-w23.png")

	app.pubScroll.Y = 0
	tt.Frame()
	frameStats(t, "study article scroll", 60, func() { app.pubScroll.Y += 40 }, tt)
	t.Logf("study article scroll max Y after 60 steps: %.0f (CPU software renderer)", app.pubScroll.MaxY)

	app.focusVerse = 14
	app.focusVerseOn = true
	tt.Frame()
	saveShot(t, tt, "bible-matthew-24.png")

	app.pubID = rsg.ID
	app.docID = 2
	tt.Frame()
	saveShot(t, tt, "research-guide.png")
	var prov string
	var provPID int
	for _, b := range app.blocks {
		for _, r := range b.runs {
			if strings.Contains(r.Href, "20:2:1-20:2:5") {
				prov = r.Text
				provPID = b.index
			}
		}
	}
	if prov == "" {
		t.Fatal("introduction has no Proverbs 2:1-5 link")
	}
	app.focusPar = true
	app.focusParFrom, app.focusParTo = provPID, provPID
	tt.Frame()
	if err := tt.Click(prov); err != nil {
		t.Fatalf("click %q: %v", prov, err)
	}
	provHits, err := lib.Resolve(ctx, "Prov. 2:1")
	if err != nil || len(provHits) == 0 {
		t.Fatal(err)
	}
	if !tt.HasText(provHits[0].Text) {
		t.Fatalf("Proverbs 2:1 not open after the link, book=%d chapter=%d", app.book, app.chapter)
	}
	if app.book != 20 || app.chapter != 2 {
		t.Fatalf("bible pane at %d:%d, want Proverbs 2", app.book, app.chapter)
	}
	saveShot(t, tt, "research-guide-link.png")

	app.pubID = rsg.ID
	app.docID = 3
	tt.Frame()
	var jochebed string
	var jochebedPID int
	for _, b := range app.blocks {
		for _, r := range b.runs {
			if r.Href == "jwpub://p/E:1200029221/" {
				jochebed = r.Text
				jochebedPID = b.index
			}
		}
	}
	if jochebed == "" {
		t.Fatal("Aaron has no Jochebed link")
	}
	target, err := lib.ResolveLink(ctx, "jwpub://p/E:1200029221/")
	if err != nil {
		t.Fatal(err)
	}
	app.focusPar = true
	app.focusParFrom, app.focusParTo = jochebedPID, jochebedPID
	tt.Frame()
	// The paragraph is only the link word, so the element named with that
	// word is the full-width line. The word itself starts at the left.
	clickAtTextStart(t, tt, jochebed)
	wantDoc := fmt.Sprintf("doc=%d", target.DocumentID)
	if app.docID != target.DocumentID || !tt.HasText(wantDoc) {
		t.Fatalf("Jochebed link left doc=%d, source present=%v", app.docID, tt.HasText(wantDoc))
	}
	if !tt.HasText("Jochebed") {
		t.Fatal("Jochebed article title is missing")
	}

	before := app.docID
	app.follow("jwpub://p/E:1200001287/1-10")
	tt.Frame()
	if app.docID != before {
		t.Fatalf("missing link changed the document to %d", app.docID)
	}
	if !strings.Contains(logBuf.String(), "not in the library") {
		t.Fatal("missing link was not logged")
	}
	for _, line := range strings.Split(logBuf.String(), "\n") {
		if strings.Contains(line, "pane open") || strings.Contains(line, "document load") || strings.Contains(line, "msg=link") || strings.Contains(line, "msg=\"link") {
			t.Log(line)
		}
	}
}

func mustFixture(t *testing.T, pub, issue, file, sum string) string {
	t.Helper()
	path, err := library.FetchFixture(pub, issue, file, sum)
	if err != nil {
		t.Skip(err)
	}
	return path
}

func pubsBySymbol(t *testing.T, app *App) (w, nwt, sty, rsg library.PublicationInfo) {
	t.Helper()
	find := func(symbol string) library.PublicationInfo {
		t.Helper()
		for _, p := range append(append([]library.PublicationInfo{}, app.articles...), app.bibles...) {
			if p.Symbol == symbol {
				return p
			}
		}
		t.Fatalf("publication %s is not in the catalog", symbol)
		return library.PublicationInfo{}
	}
	return find("w23"), find("nwt"), find("nwtsty"), find("rsg")
}

func clickAtTextStart(t *testing.T, tt *ui.Tester, s string) {
	t.Helper()
	r, ok := tt.Find(s)
	if !ok {
		t.Fatalf("no element shows %q", s)
	}
	x, y := r.X+6, r.Y+r.H/2
	if x < 0 || y < 0 || x >= 1440 || y >= 900 {
		t.Fatalf("%q starts at (%.0f, %.0f), outside the window", s, x, y)
	}
	tt.ClickAt(x, y)
}

func sampleTexts(tt *ui.Tester, containing string) []string {
	var out []string
	for _, s := range tt.Texts() {
		if strings.Contains(s, containing) && len(out) < 8 {
			out = append(out, s)
		}
	}
	return out
}

func saveShot(t *testing.T, tt *ui.Tester, name string) {
	t.Helper()
	dir := os.Getenv("BEREAN_SHOTS")
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img := tt.Image()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	t.Logf("saved %s (%dx%d, CPU software renderer)", name, img.Bounds().Dx(), img.Bounds().Dy())
}

func frameStats(t *testing.T, label string, n int, step func(), tt *ui.Tester) {
	t.Helper()
	d := make([]time.Duration, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		step()
		tt.Frame()
		d[i] = time.Since(start)
	}
	sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
	t.Logf("%s: %d frames (CPU software renderer, no GPU, 1440x900) p50=%s p95=%s max=%s",
		label, n, d[n/2], d[(n*95)/100], d[n-1])
}
