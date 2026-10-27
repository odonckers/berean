package read

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/library"
)

func TestCanvasRoundTrip(t *testing.T) {
	dir := t.TempDir()
	lib, err := library.Open(filepath.Join(dir, "berean.db"), slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	app, err := New(lib, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	note := "See [Gen. 3:1-5](jwcite:Gen.%203%3A1-5) again."
	app.cards = []Clip{
		{ID: 2, Kind: kindNote, Markdown: note, X: 40, Y: 90},
		{ID: 1, Kind: kindBible, Citation: "Gen. 3:1-5", Symbol: "nwt", Text: "synthetic verse", X: 12, Y: 24, Book: 1, Chapter: 3, Verse: 1, VerseTo: 5},
	}
	app.nextClip = 2
	app.saveCanvas()

	again, err := New(lib, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	if again.nextClip != 2 || len(again.cards) != 2 {
		t.Fatalf("reloaded next=%d cards=%d", again.nextClip, len(again.cards))
	}
	if again.cards[0].Kind != kindNote || again.cards[0].Markdown != note || again.cards[0].X != 40 || again.cards[0].Y != 90 {
		t.Fatalf("note card %+v", again.cards[0])
	}
	if again.cards[1].Citation != "Gen. 3:1-5" || again.cards[1].Symbol != "nwt" || again.cards[1].X != 12 || again.cards[1].ID != 1 {
		t.Fatalf("bible card %+v", again.cards[1])
	}
	if again.editingNote != 0 {
		t.Fatal("editing state was stored")
	}

	tt := ui.NewTester(again.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	if !tt.HasText("Gen. 3:1-5 (nwt)") || !tt.HasText("Gen. 3:1-5") {
		t.Fatal("reopened canvas did not draw the saved cards")
	}
	saveShot(t, tt, "canvas-reopened.png")

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".tmp-") {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
	}

	path := siblingPath(lib.Path(), ".canvas.json")
	if err := os.WriteFile(path, []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	var logBuf bytes.Buffer
	broken, err := New(lib, slog.New(slog.NewTextHandler(&logBuf, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if len(broken.cards) != 0 {
		t.Fatalf("corrupt canvas loaded %d cards", len(broken.cards))
	}
	if !strings.Contains(logBuf.String(), "canvas load") {
		t.Fatalf("corrupt canvas was not logged: %s", logBuf.String())
	}
}
