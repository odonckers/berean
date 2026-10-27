package read

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/library"
)

func TestCitationFormat(t *testing.T) {
	pub := library.PublicationInfo{Symbol: "w23", Month: 1}
	if got := publicationCitation(pub, 2, 3, 3); got != "w23.01 p. 2 par. 3" {
		t.Fatalf("publication citation %q", got)
	}
	if got := scriptureCitation(40, 24, 14, 14); got != "Matt. 24:14" {
		t.Fatalf("verse citation %q", got)
	}
	if got := scriptureCitation(20, 2, 1, 5); got != "Prov. 2:1-5" {
		t.Fatalf("range citation %q", got)
	}
	if got := superscript("b"); got != "ᵇ" {
		t.Fatalf("superscript %q", got)
	}
	clip := Clip{
		ID: 1, Kind: kindPublication, Citation: "w23.01 p. 2 par. 3", Text: "truth",
		X: 12, Y: 24, PubID: 7, Symbol: "w23", Year: 2023, Month: 1, Issue: 20230100,
		DocID: 2, PID: 8, PIDTo: 8, Page: 2, Paragraph: 3, ParagraphTo: 3,
	}
	raw, err := json.Marshal(clip)
	if err != nil {
		t.Fatal(err)
	}
	var back Clip
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	if back != clip {
		t.Fatalf("clip json round trip %+v", back)
	}
}

func TestCanvasAndHistory(t *testing.T) {
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
		if _, err := lib.Import(ctx, path); err != nil {
			t.Fatal(err)
		}
	}

	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	app, err := New(lib, logger)
	if err != nil {
		t.Fatal(err)
	}
	w, nwt, sty, rsg := pubsBySymbol(t, app)
	if !containsExact(app.bibleLabels, "NWT") || !containsExact(app.bibleLabels, "Study Bible") {
		t.Fatalf("bible picker labels %q, want NWT and Study Bible", app.bibleLabels)
	}

	app.pubID = w.ID
	app.docID = 2
	app.book = 40
	app.chapter = 24
	app.trans[0], app.trans[1] = nwt.ID, sty.ID
	app.transChoice[0], app.transChoice[1] = "", ""

	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	if img := tt.Image(); img.Bounds().Dx() != 1440 || img.Bounds().Dy() != 900 {
		t.Fatalf("window %dx%d", img.Bounds().Dx(), img.Bounds().Dy())
	}
	// The closed field keeps its value in the text editor, which Texts does
	// not list. Opening the menu shows the short names as options.
	if err := tt.Click("First translation"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("NWT") || !tt.HasText("Study Bible") {
		t.Fatalf("translation menu options %q", sampleTexts(tt, "NWT"))
	}
	tt.Key(0, ui.KeyEscape)
	tt.Frame()

	sup := false
	for _, b := range app.blocks {
		for _, r := range b.runs {
			if r.Sup && strings.TrimSpace(r.Text) == "b" {
				sup = true
			}
		}
	}
	if !sup || !tt.HasText("ᵇ") {
		t.Fatal("footnote marker b is not a superscript in the study article")
	}

	const par3 = "How can we help others to have the same confidence"
	parSrc := fmt.Sprintf("src pub=%s year=%d issue=%d doc=2 pid=8", w.Symbol, w.Year, w.Issue)
	if !tt.HasText(par3) || !tt.HasText(parSrc) {
		t.Fatalf("paragraph 3 not showing")
	}
	matt, err := lib.Resolve(ctx, "Matt. 24:14")
	if err != nil || len(matt) == 0 {
		t.Fatal(err)
	}
	verse := matt[0].Text
	verseSnippet := verse
	if len([]rune(verseSnippet)) > 48 {
		verseSnippet = string([]rune(verseSnippet)[:48])
	}

	app.focusPar = true
	app.focusParFrom, app.focusParTo = 8, 8
	app.focusVerse = 14
	app.focusVerseTo = 14
	app.focusVerseOn = true
	tt.Frame()

	parBefore := countContains(tt, par3)
	verseBefore := countContains(tt, verseSnippet)
	dragText(t, tt, labelWith(t, tt, parSrc), 1100, 280)
	dragText(t, tt, labelWith(t, tt, fmt.Sprintf("src bible=%s year=%d book=40 chapter=24 verse=14", nwt.Symbol, nwt.Year)), 1120, 460)
	tt.Frame()

	const pubCite = "w23.01 p. 2 par. 3"
	const bibleCite = "Matt. 24:14"
	if !tt.HasText(pubCite) || !tt.HasText(bibleCite) {
		t.Fatalf("cards missing, citations %q, cards %+v", sampleTexts(tt, "p. "), app.cards)
	}
	if countContains(tt, par3) < parBefore+1 {
		t.Fatalf("publication card text missing, count %d", countContains(tt, par3))
	}
	if countContains(tt, verseSnippet) < verseBefore+1 {
		t.Fatalf("bible card text missing, count %d", countContains(tt, verseSnippet))
	}
	if !strings.Contains(logBuf.String(), "clip created") {
		t.Fatal("clip created was not logged")
	}
	var pubCard, bibleCard Clip
	for _, c := range app.cards {
		switch c.Citation {
		case pubCite:
			pubCard = c
		case bibleCite:
			bibleCard = c
		}
	}
	if pubCard.Kind != kindPublication || pubCard.DocID != 2 || pubCard.PID != 8 || pubCard.Paragraph != 3 || pubCard.Page != 2 {
		t.Fatalf("publication clip %+v", pubCard)
	}
	if !strings.Contains(pubCard.Text, par3) {
		t.Fatalf("publication clip text %q", pubCard.Text)
	}
	if bibleCard.Kind != kindBible || bibleCard.Book != 40 || bibleCard.Chapter != 24 || bibleCard.Verse != 14 || bibleCard.BibleID != nwt.ID {
		t.Fatalf("bible clip %+v", bibleCard)
	}
	if !strings.Contains(bibleCard.Text, verseSnippet) {
		t.Fatalf("bible clip text %q", bibleCard.Text)
	}

	app.goBible(40, 1, 0, 0, 0, "open", "")
	tt.Frame()
	if app.chapter == 24 {
		t.Fatal("bible pane stayed on Matthew 24")
	}
	bringOnScreen(t, tt, app, bibleCite)
	if err := tt.Click(bibleCite); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	marked14 := fmt.Sprintf("src bible=%s year=%d book=40 chapter=24 verse=14 marked", nwt.Symbol, nwt.Year)
	if app.book != 40 || app.chapter != 24 || !tt.HasText(marked14) {
		t.Fatalf("citation opened book=%d chapter=%d marked=%v", app.book, app.chapter, tt.HasText(marked14))
	}
	plain14 := fmt.Sprintf("src bible=%s year=%d book=40 chapter=24 verse=15 marked", nwt.Symbol, nwt.Year)
	if tt.HasText(plain14) {
		t.Fatal("verse 15 was marked with verse 14")
	}

	app.goPublication(rsg.ID, 3, 0, 0, false, "open", "")
	tt.Frame()
	bringOnScreen(t, tt, app, pubCite)
	if err := tt.Click(pubCite); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if app.pubID != w.ID || app.docID != 2 || !markedLabel(tt, parSrc) {
		t.Fatalf("publication citation opened pub=%d doc=%d marked=%v", app.pubID, app.docID, markedLabel(tt, parSrc))
	}
	if !strings.Contains(logBuf.String(), "msg=navigation") {
		t.Fatal("navigation was not logged")
	}

	// Research Guide, scrolled, then a document link, then Back.
	app.goPublication(rsg.ID, 3, 0, 0, false, "open", "")
	tt.Frame()
	if app.pubScroll.MaxY < 80 {
		t.Fatalf("Aaron does not scroll (max %.0f)", app.pubScroll.MaxY)
	}
	wantY := float32(280)
	if wantY > app.pubScroll.MaxY {
		wantY = app.pubScroll.MaxY
	}
	app.pubScroll.Y = wantY
	tt.Frame()
	scrolled := app.pubScroll.Y
	aaron := app.docID
	app.follow("jwpub://p/E:1200029221/")
	tt.Frame()
	if app.docID == aaron {
		t.Fatal("Jochebed link did not leave Aaron")
	}
	if err := tt.Click("Back"); err != nil {
		t.Fatal(err)
	}
	if app.docID != aaron || math.Abs(float64(app.pubScroll.Y-scrolled)) > 1.5 {
		t.Fatalf("Back restored doc=%d scroll=%.1f, want doc=%d scroll=%.1f", app.docID, app.pubScroll.Y, aaron, scrolled)
	}
	if !strings.Contains(logBuf.String(), "action=back") {
		t.Fatal("Back was not logged")
	}

	// Bible pane keeps its own scroll.
	app.goBible(40, 24, 0, 0, 0, "open", "")
	tt.Frame()
	if app.bibleScroll.MaxY < 80 {
		t.Fatalf("Matthew 24 does not scroll (max %.0f)", app.bibleScroll.MaxY)
	}
	bibleY := float32(220)
	if bibleY > app.bibleScroll.MaxY {
		bibleY = app.bibleScroll.MaxY
	}
	app.bibleScroll.Y = bibleY
	tt.Frame()
	bibleScrolled := app.bibleScroll.Y
	app.follow("jwpub://b/NWTR/20:2:1-20:2:5")
	tt.Frame()
	if app.book != 20 || app.chapter != 2 {
		t.Fatalf("Proverbs link left the bible at %d:%d", app.book, app.chapter)
	}
	clickLower(t, tt, "Back")
	if app.book != 40 || app.chapter != 24 || math.Abs(float64(app.bibleScroll.Y-bibleScrolled)) > 1.5 {
		t.Fatalf("Bible Back restored %d:%d scroll=%.1f, want 40:24 scroll=%.1f", app.book, app.chapter, app.bibleScroll.Y, bibleScrolled)
	}

	// Research Guide with Back enabled, then the linked verses marked.
	app.goPublication(rsg.ID, 2, 0, 0, false, "open", "")
	tt.Frame()
	if len(app.pubBack) == 0 {
		t.Fatal("publication Back is empty on the Research Guide")
	}
	// The document field keeps "Introduction" in its editor, which Texts
	// does not list. A second drawn title would be another text node.
	intro := countExact(tt, "Introduction")
	if intro != 1 {
		t.Fatalf("Introduction drawn %d times, want the heading only; sample %q title %q", intro, sampleTexts(tt, "Introduction"), app.title)
	}
	saveShot(t, tt, "research-guide-back.png")

	var prov string
	for _, b := range app.blocks {
		for _, r := range b.runs {
			if strings.Contains(r.Href, "20:2:1-20:2:5") {
				prov = strings.TrimSpace(showRun(r))
			}
		}
	}
	if prov == "" {
		t.Fatal("introduction has no Proverbs 2:1-5 link")
	}
	if err := tt.Click(prov); err != nil {
		t.Fatalf("click %q: %v", prov, err)
	}
	tt.Frame()
	for _, p := range []library.PublicationInfo{nwt, sty} {
		for v := 1; v <= 5; v++ {
			src := fmt.Sprintf("src bible=%s year=%d book=20 chapter=2 verse=%d marked", p.Symbol, p.Year, v)
			if !tt.HasText(src) {
				t.Fatalf("verse %d of %s is not marked", v, p.Symbol)
			}
		}
		src6 := fmt.Sprintf("src bible=%s year=%d book=20 chapter=2 verse=6", p.Symbol, p.Year)
		if !tt.HasText(src6) || tt.HasText(src6+" marked") {
			t.Fatalf("verse 6 of %s marked=%v present=%v", p.Symbol, tt.HasText(src6+" marked"), tt.HasText(src6))
		}
	}
	v1, ok := tt.Find(fmt.Sprintf("src bible=%s year=%d book=20 chapter=2 verse=1 marked", nwt.Symbol, nwt.Year))
	if !ok || v1.Y < 0 || v1.Y > 900 {
		t.Fatalf("Proverbs 2:1 is not in the window (%v %+v)", ok, v1)
	}
	saveShot(t, tt, "proverbs-2-marked.png")

	var v1Text, v5Text string
	for _, line := range app.lines {
		if len(line.cells) == 0 {
			continue
		}
		switch line.verse {
		case 1:
			v1Text = runText(line.cells[0].runs)
		case 5:
			v5Text = runText(line.cells[0].runs)
		}
	}
	if v1Text == "" || v5Text == "" {
		t.Fatal("Proverbs 2:1 or 2:5 has no text")
	}
	dragText(t, tt, fmt.Sprintf("src bible=%s year=%d book=20 chapter=2 verse=1 marked", nwt.Symbol, nwt.Year), 1040, 300)
	tt.Frame()
	const rangeCite = "Prov. 2:1-5"
	if !tt.HasText(rangeCite) {
		t.Fatalf("range card missing, cards %+v", app.cards)
	}
	var rangeCard Clip
	for _, c := range app.cards {
		if c.Citation == rangeCite {
			rangeCard = c
		}
	}
	if rangeCard.Verse != 1 || rangeCard.VerseTo != 5 || !strings.Contains(rangeCard.Text, firstWords(v1Text)) || !strings.Contains(rangeCard.Text, firstWords(v5Text)) {
		t.Fatalf("range clip %+v", rangeCard)
	}
	if !strings.Contains(rangeCard.Text, "1 ") || !strings.Contains(rangeCard.Text, "\n5 ") {
		t.Fatalf("range clip lost verse numbers or line breaks: %q", rangeCard.Text)
	}
	saveShot(t, tt, "bible-verse-numbers.png")

	// Park the publication card where no other card covers it, and press
	// its paragraph rather than the citation line.
	for i := range app.cards {
		if app.cards[i].ID == pubCard.ID {
			app.cards[i].X, app.cards[i].Y = 24, 24
			pubCard = app.cards[i]
		}
	}
	app.panX, app.panY, app.zoom = 0, 0, 1
	tt.Frame()
	panBeforeX, panBeforeY := app.panX, app.panY
	tt.Press(820, 80)
	tt.Move(880, 120)
	tt.Release(920, 160)
	if app.panX != panBeforeX || app.panY != panBeforeY {
		t.Fatalf("dragging a card panned the canvas to %.1f,%.1f from %.1f,%.1f", app.panX, app.panY, panBeforeX, panBeforeY)
	}
	moved := false
	for _, c := range app.cards {
		if c.ID == pubCard.ID && (math.Abs(float64(c.X-pubCard.X)) > 20 || math.Abs(float64(c.Y-pubCard.Y)) > 15) {
			moved = true
		}
	}
	if !moved {
		t.Fatalf("card did not follow the pointer, was %+v now %+v", pubCard, app.cards)
	}

	// Look at empty canvas so the gesture cannot land on a card.
	app.panX, app.panY = -2500, -2500
	tt.Frame()
	emptyX, emptyY := float32(1000), float32(500)
	tt.Press(emptyX, emptyY)
	tt.Move(emptyX-40, emptyY-30)
	tt.Release(emptyX-80, emptyY-50)
	if app.panX == -2500 && app.panY == -2500 {
		t.Fatal("dragging the canvas background did not pan")
	}
	zoomed := app.zoom
	tt.Pinch(emptyX, emptyY, 1.25)
	if app.zoom <= zoomed {
		t.Fatalf("pinch left zoom at %v", app.zoom)
	}
	beforeWheel := app.panY
	tt.Wheel(emptyX, emptyY, 0, 40)
	if app.panY == beforeWheel {
		t.Fatalf("wheel left panY at %.1f", app.panY)
	}

	app.panX, app.panY, app.zoom = 30, 10, 1
	tt.Frame()
	saveShot(t, tt, "canvas-cards.png")

	div, ok := tt.Find("Divider")
	if !ok {
		t.Fatal("no divider between the panes")
	}
	splitBefore := app.paneSplit
	dx, dy := div.X+div.W/2, div.Y+div.H/2
	tt.Press(dx, dy)
	tt.Move(dx, dy+70)
	tt.Release(dx, dy+120)
	tt.Frame()
	if app.paneSplit <= splitBefore+2 {
		t.Fatalf("divider did not move, split %.1f -> %.1f", splitBefore, app.paneSplit)
	}
	saveShot(t, tt, "divider-resized.png")

	// Pack all 200 into the viewport so the frames paint them, overlapping,
	// rather than leaving most of the grid outside the clip. Every fifth
	// card is a note whose citation chip stays closed.
	const noteMD = "A note on [Matt. 24:14](jwcite:Matt.%2024%3A14)."
	app.cards = make([]Clip, 200)
	app.editingNote = 0
	for i := range app.cards {
		app.cards[i] = Clip{
			ID: int64(i + 1), Kind: kindBible, Citation: bibleCite,
			Text: verseSnippet, X: float32(i%20) * 32, Y: float32(i/20) * 36,
			BibleID: nwt.ID, Book: 40, Chapter: 24, Verse: 14, VerseTo: 14,
		}
		if i%5 == 0 {
			app.cards[i].Kind = kindNote
			app.cards[i].Citation = ""
			app.cards[i].Text = ""
			app.cards[i].Markdown = noteMD
		}
	}
	app.nextClip = 200
	app.panX, app.panY, app.zoom = 0, 0, 1
	layoutStart := time.Now()
	tt.Frame()
	t.Logf("200 cards first layout: %s", time.Since(layoutStart))
	measureFrames(t, "200 cards pan", 60, func() {
		app.panX += 18
		app.panY += 11
	}, tt)
	measureFrames(t, "200 cards zoom", 60, func() {
		app.zoom += 0.04
		if app.zoom > 2.4 {
			app.zoom = 0.55
		}
	}, tt)
}

func dragText(t *testing.T, tt *ui.Tester, label string, x, y float32) {
	t.Helper()
	r, ok := tt.Find(label)
	if !ok {
		t.Fatalf("no element shows %q", label)
	}
	if r.W < 4 || r.H < 4 {
		t.Fatalf("%q has no visible box %+v", label, r)
	}
	fromX, fromY := r.X+min(r.W/2, 48), r.Y+min(r.H/2, 18)
	if fromX < 4 || fromY < 4 || fromX >= 1436 || fromY >= 896 {
		t.Fatalf("%q is at (%.0f, %.0f), outside the window (%+v)", label, fromX, fromY, r)
	}
	tt.Press(fromX, fromY)
	tt.Move(fromX+12, fromY+10)
	tt.Move(x, y)
	tt.Release(x, y)
}

func bringOnScreen(t *testing.T, tt *ui.Tester, app *App, label string) {
	t.Helper()
	for i := 0; i < 5; i++ {
		r, ok := tt.Find(label)
		if !ok {
			t.Fatalf("no element shows %q", label)
		}
		cx, cy := r.X+r.W/2, r.Y+r.H/2
		if cx >= 12 && cy >= 12 && cx < 1428 && cy < 888 {
			return
		}
		app.panX += 720 - cx
		app.panY += 420 - cy
		tt.Frame()
	}
	t.Fatalf("%q stayed outside the window", label)
}

func clickLower(t *testing.T, tt *ui.Tester, label string) {
	t.Helper()
	rects := findAll(tt, label)
	if len(rects) < 2 {
		t.Fatalf("%q has %d controls, want the publication and Bible buttons", label, len(rects))
	}
	lower := rects[0]
	for _, r := range rects[1:] {
		if r.Y > lower.Y {
			lower = r
		}
	}
	x, y := lower.X+lower.W/2, lower.Y+lower.H/2
	if x < 0 || y < 0 || x >= 1440 || y >= 900 {
		t.Fatalf("%q is at (%.0f, %.0f)", label, x, y)
	}
	tt.ClickAt(x, y)
}

func findAll(tt *ui.Tester, want string) []ui.Rect {
	rv := reflect.ValueOf(tt).Elem().FieldByName("rt")
	if rv.Kind() == reflect.Pointer || rv.Kind() == reflect.Interface {
		rv = rv.Elem()
	}
	labels := rv.FieldByName("labels")
	var out []ui.Rect
	for i := 0; i < labels.Len(); i++ {
		n := labels.Index(i)
		if n.FieldByName("text").String() != want {
			continue
		}
		r := n.FieldByName("r")
		out = append(out, ui.Rect{
			X: float32(r.FieldByName("X").Float()),
			Y: float32(r.FieldByName("Y").Float()),
			W: float32(r.FieldByName("W").Float()),
			H: float32(r.FieldByName("H").Float()),
		})
	}
	return out
}

func labelWith(t *testing.T, tt *ui.Tester, prefix string) string {
	t.Helper()
	for _, s := range tt.Texts() {
		if strings.Contains(s, prefix) {
			return s
		}
	}
	t.Fatalf("no label contains %q", prefix)
	return ""
}

func markedLabel(tt *ui.Tester, prefix string) bool {
	for _, s := range tt.Texts() {
		if strings.Contains(s, prefix) && strings.HasSuffix(s, " marked") {
			return true
		}
	}
	return false
}

func countContains(tt *ui.Tester, s string) int {
	n := 0
	for _, text := range tt.Texts() {
		if strings.Contains(text, s) {
			n++
		}
	}
	return n
}

func countExact(tt *ui.Tester, s string) int {
	n := 0
	for _, text := range tt.Texts() {
		if text == s {
			n++
		}
	}
	return n
}

func containsExact(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

func firstWords(s string) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) > 24 {
		return string([]rune(s)[:24])
	}
	return s
}

func measureFrames(t *testing.T, label string, n int, step func(), tt *ui.Tester) {
	t.Helper()
	d := make([]time.Duration, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		step()
		tt.Frame()
		d[i] = time.Since(start)
	}
	sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
	p50, p95, maxd := d[n/2], d[(n*95)/100], d[n-1]
	t.Logf("%s: %d frames (CPU software renderer, no GPU, 1440x900) p50=%s p95=%s max=%s", label, n, p50, p95, maxd)
	if p95 > 167*time.Millisecond/10 || maxd > 33*time.Millisecond {
		t.Fatalf("%s too slow: p95=%s max=%s (limits p95<=16.7ms and no frame over 33ms)", label, p95, maxd)
	}
}
