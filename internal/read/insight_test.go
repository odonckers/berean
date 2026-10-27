package read

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/library"

	_ "modernc.org/sqlite"
)

func TestLinkInsightTitle(t *testing.T) {
	for _, citation := range []string{
		"it-2 Sovereignty",
		"it-2 “Sovereignty”",
		"it-2 \"Sovereignty\"",
		"it-1 “Aaron”",
	} {
		in := "See " + citation + " today."
		got := linkCitations(in)
		want := "See [" + citation + "](jwcite:" + url.PathEscape(citation) + ") today."
		if got != want {
			t.Fatalf("linkCitations(%q) = %s", in, got)
		}
	}
	joined := linkCitations("it-2 Sovereignty and it-1 Guard.")
	if !strings.Contains(joined, "[it-2 Sovereignty](jwcite:"+url.PathEscape("it-2 Sovereignty")+")") ||
		!strings.Contains(joined, "[it-1 Guard](jwcite:"+url.PathEscape("it-1 Guard")+")") {
		t.Fatalf("two titles = %s", joined)
	}
	multi := "Read it-1 Guard, Gate of the today."
	linked := linkCitations(multi)
	title := "it-1 Guard, Gate of the"
	if !strings.Contains(linked, "["+title+"](jwcite:"+url.PathEscape(title)+")") || strings.Contains(linked, "today)") {
		t.Fatalf("multi-word title = %s", linked)
	}
	plain := "See it Sovereignty today."
	if linkCitations(plain) != plain {
		t.Fatalf("plain it was linked: %s", linkCitations(plain))
	}
	plainQuoted := "See it “Sovereignty” today."
	if linkCitations(plainQuoted) != plainQuoted {
		t.Fatalf("plain it quote was linked: %s", linkCitations(plainQuoted))
	}
	page := linkCitations("See it p. 1011 today.")
	if !strings.Contains(page, "[it p. 1011](jwcite:"+url.PathEscape("it p. 1011")+")") {
		t.Fatalf("plain it page = %s", page)
	}
}

func TestInsightImportHintChip(t *testing.T) {
	lib := openEmpty(t)
	app := newTestApp(t, lib)
	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	writeNote(t, tt, "it-2 Sovereignty. it-1 Guard.")
	const hint = "Import Insight on the Scriptures (it)."
	if !tt.HasText(hint) {
		t.Fatalf("editor missing %q; problems %q", hint, app.problems)
	}
	if tt.HasText("Volume 1") || tt.HasText("Volume 2") {
		t.Fatal("import hint asks for a separate volume file")
	}
}

func TestInsightPageChipBreaksWithoutVolume(t *testing.T) {
	path := filepath.Join(t.TempDir(), "berean.db")
	lib, err := library.Open(path, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	if err := lib.Close(); err != nil {
		t.Fatal(err)
	}
	insertPlainInsight(t, path)
	lib, err = library.Open(path, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	app := newTestApp(t, lib)
	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	started := app.docID
	writeNote(t, tt, "See it-2 p. 1011 now.")
	const broken = "it-2 p. 1011: the file does not say which volume this page is in"
	if !tt.HasText(broken) {
		t.Fatalf("editor missing %q; problems %q", broken, app.problems)
	}
	if err := tt.Click("Done"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("it-2 p. 1011"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText(broken) {
		t.Fatalf("broken chip did not show the volume error; open=%v", app.openChip)
	}
	if tt.HasText("Open source") {
		t.Fatal("broken chip offered to open a page")
	}
	if app.docID != started || app.title == "Sovereignty" {
		t.Fatalf("broken chip opened doc=%d title=%q", app.docID, app.title)
	}
}

func TestInsightChipsOpenTheArticle(t *testing.T) {
	ctx := context.Background()
	path := mustFixture(t, "it", "", "it_E.jwpub", "b8d2145ef9ab7fff7c9ab3050ab4763f")
	before := sha256File(t, path)
	lib := openEmpty(t)
	if _, err := lib.Import(ctx, path); err != nil {
		t.Fatal(err)
	}
	if sha256File(t, path) != before {
		t.Fatal("it_E.jwpub changed during import")
	}

	sov := mustOne(t, lib, "it-2 Sovereignty")
	curly := mustOne(t, lib, "it-2 “Sovereignty”")
	straight := mustOne(t, lib, "it-2 \"Sovereignty\"")
	guard := mustOne(t, lib, "it-1 Guard")
	aaron := mustOne(t, lib, "it-1 “Aaron”")
	page := mustOne(t, lib, "it-2 p. 1011")
	if sov.Document != "Sovereignty" || sov.Symbol != "it" || page.DocumentID != sov.DocumentID {
		t.Fatalf("sovereignty=%+v page=%+v", sov, page)
	}
	if curly.DocumentID != sov.DocumentID || straight.DocumentID != sov.DocumentID {
		t.Fatalf("quoted sovereignty curly=%+v straight=%+v bare=%+v", curly, straight, sov)
	}
	if aaron.Document != "Aaron" || aaron.DocumentID == sov.DocumentID {
		t.Fatalf("aaron=%+v", aaron)
	}
	if guard.Document != "Guard" || guard.DocumentID == sov.DocumentID {
		t.Fatalf("guard=%+v", guard)
	}
	vol1 := mustResolve(t, lib, "it-1 p. 1011")
	for _, h := range vol1 {
		if h.DocumentID == sov.DocumentID || h.Document == "Sovereignty" {
			t.Fatalf("it-1 page opened volume 2: %+v", h)
		}
	}
	if vol1[0].DocumentID != guard.DocumentID {
		t.Fatalf("it-1 p. 1011 opened %q, want Guard", vol1[0].Document)
	}
	if _, err := lib.Resolve(ctx, "it p. 1011"); err == nil || err.Error() != "it needs a page and a paragraph" {
		t.Fatalf("plain it page: %v", err)
	}

	app := newTestApp(t, lib)
	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	started := app.docID
	writeNote(t, tt, "it-2 “Sovereignty”. it-2 \"Sovereignty\". it-2 Sovereignty. it-1 “Aaron”. it-1 Guard. it-2 p. 1011. it p. 1011.")
	if len(app.problems) != 1 || app.problems[0] != "it p. 1011: it needs a page and a paragraph" {
		t.Fatalf("editor problems = %q", app.problems)
	}
	if err := tt.Click("Done"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()

	openChip := func(citation string, doc library.Hit) {
		t.Helper()
		if err := tt.Click(citation); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
		if !tt.HasText(doc.Document) {
			t.Fatalf("chip %s did not show %s", citation, doc.Document)
		}
		if err := tt.Click("Open source"); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
		if app.docID != doc.DocumentID || app.title != doc.Document {
			t.Fatalf("%s opened doc=%d title=%q, want %d %s", citation, app.docID, app.title, doc.DocumentID, doc.Document)
		}
		if !tt.HasText(doc.Document) || !tt.HasText(fmt.Sprintf("doc=%d", doc.DocumentID)) {
			t.Fatalf("%s article is not on screen", citation)
		}
		if err := tt.Click(citation); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
	}
	if err := tt.Click("it p. 1011"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("it needs a page and a paragraph") || tt.HasText("Open source") || app.docID != started {
		t.Fatalf("plain it chip opened doc=%d", app.docID)
	}
	if err := tt.Click("it p. 1011"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	openChip("it-2 “Sovereignty”", sov)
	openChip("it-2 \"Sovereignty\"", sov)
	openChip("it-2 Sovereignty", sov)
	openChip("it-1 “Aaron”", aaron)
	openChip("it-1 Guard", guard)
	openChip("it-2 p. 1011", page)
	if app.docID == guard.DocumentID {
		t.Fatal("it-2 page stayed on the volume 1 article")
	}
}

func openEmpty(t *testing.T) *library.Library {
	t.Helper()
	lib, err := library.Open(filepath.Join(t.TempDir(), "berean.db"), slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	return lib
}

func newTestApp(t *testing.T, lib *library.Library) *App {
	t.Helper()
	app, err := New(lib, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func writeNote(t *testing.T, tt *ui.Tester, text string) {
	t.Helper()
	if err := tt.Click("New note"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("Note editor"); err != nil {
		t.Fatal(err)
	}
	tt.Type(text)
	tt.Frame()
}

func insertPlainInsight(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		INSERT INTO publication (
			meps_language, symbol, cite_symbol, year, issue_tag, month, day,
			title, short_title, issue_title, pub_type, file_hash
		) VALUES (0, 'it', 'it', 2018, 0, 0, 0,
			'Insight on the Scriptures', 'Insight', '', 'Book', 'test');
		INSERT INTO document (publication_id, document_id, meps_document_id, title, first_page, last_page, volume)
		VALUES
			(1, 1, 1, 'Guard', 1011, 1011, 0),
			(1, 2, 2, 'Sovereignty', 1011, 1011, 0);
		INSERT INTO paragraph (
			publication_id, document_id, paragraph_index, ordinal, paragraph_number,
			first_page, last_page, text, markup
		) VALUES
			(1, 1, 1, 0, NULL, 1011, 1011, 'guard page', ''),
			(1, 2, 1, 0, NULL, 1011, 1011, 'sovereignty page', '');
	`)
	if err != nil {
		t.Fatal(err)
	}
}

func mustOne(t *testing.T, lib *library.Library, citation string) library.Hit {
	t.Helper()
	hits := mustResolve(t, lib, citation)
	if len(hits) != 1 {
		t.Fatalf("%s hits = %d", citation, len(hits))
	}
	return hits[0]
}

func mustResolve(t *testing.T, lib *library.Library, citation string) []library.Hit {
	t.Helper()
	hits, err := lib.Resolve(context.Background(), citation)
	if err != nil {
		t.Fatalf("%s: %v", citation, err)
	}
	return hits
}

func sha256File(t *testing.T, path string) string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(h.Sum(nil))
}
