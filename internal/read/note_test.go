package read

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"net/url"

	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/library"
)

func TestLinkCitations(t *testing.T) {
	in := "See w23.01 p. 2 par. 3 and Matt. 24:14 today."
	got := linkCitations(in)
	if !strings.Contains(got, "[w23.01 p. 2 par. 3](jwcite:w23.01%20p.%202%20par.%203)") {
		t.Fatalf("publication link: %s", got)
	}
	if !strings.Contains(got, "[Matt. 24:14](jwcite:Matt.%2024:14)") {
		t.Fatalf("scripture link: %s", got)
	}
	if linkCitations(got) != got {
		t.Fatalf("link twice changed %s", linkCitations(got))
	}
	if unlinkCitations(got) != in {
		t.Fatalf("unlink = %q", unlinkCitations(got))
	}

	broken := "w23.13 p. 2 par. 1"
	linked := linkCitations(broken)
	if linked != "[w23.13 p. 2 par. 1](jwcite:w23.13%20p.%202%20par.%201)" {
		t.Fatalf("broken month = %s", linked)
	}

	code := "Keep `w23.01 p. 2 par. 3` in code."
	if linkCitations(code) != code {
		t.Fatalf("code was linked: %s", linkCitations(code))
	}
	plain := "How can we help others."
	if linkCitations(plain) != plain {
		t.Fatalf("prose was linked: %s", linkCitations(plain))
	}

	paras := parseNote(got)
	var chips int
	for _, p := range paras {
		for _, seg := range p.segs {
			if seg.kind == segChip {
				chips++
			}
		}
	}
	if chips != 2 {
		t.Fatalf("chips = %d in %+v", chips, paras)
	}
}

func TestCitationStopsBeforeTrailingText(t *testing.T) {
	cases := []struct {
		in, cite, rest string
	}{
		{"See Matt. 24:14, the sign.", "Matt. 24:14", ", the sign."},
		{"See Matt. 24:14 - the sign.", "Matt. 24:14", " - the sign."},
		{"See Matt. 24:14 15 times.", "Matt. 24:14", " 15 times."},
		{"See w23.01 p. 2 par. 3, which says.", "w23.01 p. 2 par. 3", ", which says."},
	}
	for _, c := range cases {
		got := linkCitations(c.in)
		want := "See [" + c.cite + "](jwcite:" + url.PathEscape(c.cite) + ")" + c.rest
		if got != want {
			t.Fatalf("linkCitations(%q) = %s, want %s", c.in, got, want)
		}
	}
}

func TestOpenDraftIsKept(t *testing.T) {
	app := &App{
		zoom: 1, log: slog.Default(),
		boxes: map[int64]cardBox{}, citeCache: map[string]citeMemo{},
		noteCache: map[string][]notePara{}, openChip: map[string]bool{},
		cards: []Clip{
			{ID: 1, Kind: kindNote},
			{ID: 2, Kind: kindNote, Markdown: "Already saved."},
		},
		nextClip:    2,
		editingNote: 1,
		noteDraft:   "See Matt. 24:14 before switching.",
	}
	app.editNote(2)
	if !strings.Contains(app.cards[0].Markdown, "jwcite:Matt.%2024:14") {
		t.Fatalf("Edit dropped the open draft: %q", app.cards[0].Markdown)
	}
	if app.editingNote != 2 || !strings.Contains(app.noteDraft, "Already saved.") {
		t.Fatalf("Edit did not open the other note: id=%d draft=%q", app.editingNote, app.noteDraft)
	}

	app.noteDraft = "A second thought, w23.01 p. 2 par. 3."
	app.addNote(nil)
	if !strings.Contains(app.cards[1].Markdown, "jwcite:w23.01%20p.%202%20par.%203") {
		t.Fatalf("New note dropped the open draft: %q", app.cards[1].Markdown)
	}
	if app.editingNote == 2 || app.noteDraft != "" {
		t.Fatalf("New note did not start empty: id=%d draft=%q", app.editingNote, app.noteDraft)
	}
}

func TestNotesAndClipPlacement(t *testing.T) {
	ctx := context.Background()
	wPath := mustFixture(t, "w", "202301", "w_E_202301.jwpub", "52e756833e0fcd9183eb5d2c0bcd3437")
	nwtPath := mustFixture(t, "nwt", "", "nwt_E.jwpub", "fe3ee3beb5e0605af2da1db7fd658e46")
	styPath := mustFixture(t, "nwtsty", "", "nwtsty_E.jwpub", "c15e1d9328ab11950cde1677c0aa0929")

	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	lib, err := library.Open(filepath.Join(t.TempDir(), "berean.db"), logger)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	for _, path := range []string{wPath, nwtPath, styPath} {
		if _, err := lib.Import(ctx, path); err != nil {
			t.Fatal(err)
		}
	}

	app, err := New(lib, logger)
	if err != nil {
		t.Fatal(err)
	}
	w := pubSymbol(t, app, "w23")
	nwt := pubSymbol(t, app, "nwt")
	app.pubID = w.ID
	app.docID = 2
	app.book = 40
	app.chapter = 24
	app.trans[0], app.trans[1] = nwt.ID, 0
	app.transChoice[0], app.transChoice[1] = "", ""

	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()

	const hint = "Drag a paragraph or verse onto the canvas."
	if !tt.HasText(hint) {
		t.Fatalf("empty canvas hint missing, texts %q", sampleTexts(tt, "Drag"))
	}
	saveShot(t, tt, "empty-canvas-hint.png")

	if err := tt.Click("New note"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if tt.HasText(hint) {
		t.Fatal("hint stayed after a card was added")
	}
	if err := tt.Click("Note editor"); err != nil {
		t.Fatal(err)
	}
	const (
		good   = "w23.01 p. 2 par. 3"
		wrong  = "w23.01 p. 5 par. 3: par. 3 is on pp. 2, 8-9, 14-15, 20, and 26-27, not p. 5"
		absent = "Import the August 2022 study edition of The Watchtower (w22.08)."
		broken = `Couldn't read the citation "w23.13 p. 2 par. 1".`
	)
	tt.Type("Note " + good + " then w23.01 p. 5 par. 3 then w22.08 p. 2 par. 1 then w23.13 p. 2 par. 1.")
	tt.Frame()
	for _, msg := range []string{wrong, absent, broken} {
		if !tt.HasText(msg) {
			t.Fatalf("editor missing %q; draft %q", msg, app.noteDraft)
		}
	}
	saveShot(t, tt, "note-wrong-page.png")
	logged := logBuf.String()
	for _, result := range []string{"result=ok", "result=wrong_page", "result=missing_publication", "result=parse_error"} {
		if !strings.Contains(logged, result) {
			t.Fatalf("log missing %s\n%s", result, logged)
		}
	}

	if err := tt.Click("Done"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	var saved string
	for _, card := range app.cards {
		if card.Kind == kindNote {
			saved = card.Markdown
		}
	}
	if !strings.Contains(saved, "[w23.01 p. 2 par. 3](jwcite:") || linkCitations(saved) != saved {
		t.Fatalf("saved markdown %s", saved)
	}

	const par3 = "How can we help others to have the same confidence"
	before := countContains(tt, par3)
	if err := tt.Click(good); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if countContains(tt, par3) < before+1 {
		t.Fatalf("chip did not show the paragraph, count %d", countContains(tt, par3))
	}
	saveShot(t, tt, "note-chip-expanded.png")
	if err := tt.Click("Open source"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	parSrc := "src pub=" + w.Symbol
	if app.docID != 2 || app.focusParFrom == 0 || !markedLabel(tt, parSrc) {
		t.Fatalf("open source doc=%d mark=%d marked=%v", app.docID, app.focusParFrom, markedLabel(tt, parSrc))
	}

	app.nextClip++
	app.cards = append(app.cards, Clip{
		ID: app.nextClip, Kind: kindNote, Markdown: saved, X: 36, Y: 420,
	})
	tt.Frame()
	if app.cards[len(app.cards)-1].Markdown != saved || !strings.Contains(saved, "jwcite:") {
		t.Fatal("loaded note lost the jwcite link")
	}
	if !tt.HasText(good) {
		t.Fatal("loaded note did not show the citation")
	}

	app.cards = nil
	app.editingNote = 0
	app.openChip = map[string]bool{}
	app.panX, app.panY, app.zoom = 0, 0, 1
	tt.Frame()

	app.focusPar = true
	app.focusParFrom, app.focusParTo = 8, 8
	app.focusVerse = 14
	app.focusVerseTo = 14
	app.focusVerseOn = true
	tt.Frame()
	parLabel := labelWith(t, tt, fmt.Sprintf("src pub=%s year=%d issue=%d doc=2 pid=8", w.Symbol, w.Year, w.Issue))
	verse14 := labelWith(t, tt, fmt.Sprintf("src bible=%s year=%d book=40 chapter=24 verse=14", nwt.Symbol, nwt.Year))
	drops := []struct {
		label string
		x, y  float32
	}{
		{parLabel, 1080, 150},
		{verse14, 1094, 162},
		{parLabel, 1108, 174},
		{verse14, 1086, 158},
		{parLabel, 1100, 170},
	}
	for _, d := range drops {
		dragText(t, tt, d.label, d.x, d.y)
		tt.Frame()
	}
	if len(app.cards) != 5 {
		t.Fatalf("cards = %d", len(app.cards))
	}
	pubs, bibles := 0, 0
	for _, card := range app.cards {
		switch card.Kind {
		case kindPublication:
			pubs++
		case kindBible:
			bibles++
		}
	}
	if pubs == 0 || bibles == 0 {
		t.Fatalf("drops from one source only: %+v", app.cards)
	}
	headers := assertCardHeaders(t, tt, app)
	assertNoFullOverlap(t, app)
	saveShot(t, tt, "five-clips.png")

	back := app.cards[0].ID
	h := headers[0]
	tt.ClickAt(h.X+h.W/2, h.Y+h.H/2)
	tt.Frame()
	if app.cards[len(app.cards)-1].ID != back {
		t.Fatalf("click left card %d in front, want %d", app.cards[len(app.cards)-1].ID, back)
	}
}

func pubSymbol(t *testing.T, app *App, symbol string) library.PublicationInfo {
	t.Helper()
	for _, p := range append(append([]library.PublicationInfo{}, app.articles...), app.bibles...) {
		if p.Symbol == symbol {
			return p
		}
	}
	t.Fatalf("publication %s is not in the catalog", symbol)
	return library.PublicationInfo{}
}

func assertCardHeaders(t *testing.T, tt *ui.Tester, app *App) []ui.Rect {
	t.Helper()
	const canvasLeft = leftWidth + 1
	z := app.zoom
	if z == 0 {
		z = 1
	}
	out := make([]ui.Rect, len(app.cards))
	for i, card := range app.cards {
		rects := findAll(tt, card.Citation)
		wx := canvasLeft + app.panX + card.X*z
		wy := app.panY + card.Y*z
		var found ui.Rect
		ok := false
		for _, r := range rects {
			if r.W < 4 || r.H < 4 {
				continue
			}
			if r.X >= wx-6 && r.X <= wx+cardWidth*z && r.Y >= wy-6 && r.Y <= wy+80*z {
				found = r
				ok = true
				break
			}
		}
		if !ok {
			t.Fatalf("card %d %q header not near (%.0f, %.0f)", card.ID, card.Citation, wx, wy)
		}
		if found.X <= canvasLeft+0.5 || found.Y <= 0.5 || found.X+found.W >= 1439.5 || found.Y+found.H >= 899.5 {
			t.Fatalf("header %q is clipped: %+v", card.Citation, found)
		}
		for j := i + 1; j < len(app.cards); j++ {
			later := app.cards[j]
			box := app.boxes[later.ID]
			h := box.h
			if h < 1 {
				h = 180
			}
			lr := ui.Rect{
				X: canvasLeft + app.panX + later.X*z,
				Y: app.panY + later.Y*z,
				W: cardWidth * z,
				H: h * z,
			}
			if rectsOverlap(found, lr) {
				t.Fatalf("header of card %d covered by card %d: header %+v later %+v", card.ID, later.ID, found, lr)
			}
		}
		out[i] = found
	}
	return out
}

func assertNoFullOverlap(t *testing.T, app *App) {
	t.Helper()
	for i, card := range app.cards {
		box := app.boxes[card.ID]
		ra := frect{card.X, card.Y, cardWidth, box.h}
		for j := i + 1; j < len(app.cards); j++ {
			other := app.cards[j]
			ob := app.boxes[other.ID]
			rb := frect{other.X, other.Y, cardWidth, ob.h}
			if containsRect(ra, rb) || containsRect(rb, ra) {
				t.Fatalf("card %d fully overlaps card %d (%+v vs %+v)", card.ID, other.ID, ra, rb)
			}
		}
	}
}

func rectsOverlap(a, b ui.Rect) bool {
	return a.W > 0 && a.H > 0 && b.W > 0 && b.H > 0 &&
		a.X < b.X+b.W && b.X < a.X+a.W && a.Y < b.Y+b.H && b.Y < a.Y+a.H
}
