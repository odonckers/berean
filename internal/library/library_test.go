package library

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportAndResolve(t *testing.T) {
	wPath := fetchFixture(t, fixture{pub: "w", issue: "202301", file: "w_E_202301.jwpub", sum: "52e756833e0fcd9183eb5d2c0bcd3437"})
	nwtPath := fetchFixture(t, fixture{pub: "nwt", file: "nwt_E.jwpub", sum: "fe3ee3beb5e0605af2da1db7fd658e46"})
	styPath := fetchFixture(t, fixture{pub: "nwtsty", file: "nwtsty_E.jwpub", sum: "c15e1d9328ab11950cde1677c0aa0929"})

	before := map[string]string{}
	for _, p := range []string{wPath, nwtPath, styPath} {
		before[p] = sha256File(t, p)
	}

	dir := t.TempDir()
	lib, err := Open(filepath.Join(dir, "berean.db"), slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	ctx := context.Background()

	w := mustImport(t, lib, wPath)
	if w.Symbol != "w23" || w.CiteSymbol != "w" || w.Year != 2023 || w.IssueTag != 20230100 {
		t.Fatalf("watchtower card = %+v", w)
	}
	if w.Documents != 8 || w.Verses != 0 || w.StudyNotes != 0 || w.CrossRefs != 0 {
		t.Fatalf("watchtower counts = %+v", w)
	}
	if w.Paragraphs == 0 {
		t.Fatal("watchtower imported no paragraphs")
	}

	nwt := mustImport(t, lib, nwtPath)
	if nwt.Symbol != "nwt" || nwt.Year != 2013 || nwt.Verses != 31194 || nwt.StudyNotes != 0 || nwt.CrossRefs != 63474 {
		t.Fatalf("nwt counts = %+v", nwt)
	}
	sty := mustImport(t, lib, styPath)
	if sty.Symbol != "nwtsty" || sty.Year != 2026 || sty.Verses != 31194 || sty.StudyNotes != 3783 || sty.CrossRefs != 65750 {
		t.Fatalf("nwtsty counts = %+v", sty)
	}

	stats, err := lib.Stats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := Stats{
		Publications: 3,
		Documents:    8 + 195 + 781,
		Paragraphs:   w.Paragraphs + nwt.Paragraphs + sty.Paragraphs,
		Verses:       31194 * 2,
		StudyNotes:   3783,
		CrossRefs:    63474 + 65750,
	}
	if stats != want {
		t.Fatalf("stats = %+v, want %+v", stats, want)
	}
	t.Logf("imported paragraphs=%d documents=%d verses=%d study_notes=%d cross_references=%d",
		stats.Paragraphs, stats.Documents, stats.Verses, stats.StudyNotes, stats.CrossRefs)

	t.Run("watchtower paragraph", func(t *testing.T) {
		hits, err := lib.Resolve(ctx, "w23.01 p. 2 par. 3")
		if err != nil {
			t.Fatal(err)
		}
		if len(hits) != 1 {
			t.Fatalf("hits = %d, want 1", len(hits))
		}
		const prefix = "3 How can we help others to have the same confidence"
		if !strings.HasPrefix(hits[0].Text, prefix) {
			t.Fatalf("text = %q", hits[0].Text)
		}
		if hits[0].Page != 2 || hits[0].Paragraph != 3 || hits[0].Symbol != "w23" {
			t.Fatalf("hit = %+v", hits[0])
		}
		if hits[0].PubID == 0 || hits[0].DocumentID == 0 || hits[0].ParagraphIndex == 0 {
			t.Fatalf("hit location = %+v", hits[0])
		}
	})

	t.Run("paragraph on the wrong page", func(t *testing.T) {
		_, err := lib.Resolve(ctx, "w23.01 p. 5 par. 3")
		if err == nil {
			t.Fatal("expected par. 3 to be rejected on p. 5")
		}
		const want = "w23.01 p. 5 par. 3: par. 3 is on pp. 2, 8-9, 14-15, 20, and 26-27, not p. 5"
		if err.Error() != want {
			t.Fatalf("error = %q", err.Error())
		}
	})

	t.Run("paragraph number in several articles", func(t *testing.T) {
		_, err := lib.Resolve(ctx, "w23.01 p. 16 par. 3")
		if err == nil {
			t.Fatal("expected par. 3 to be rejected on p. 16")
		}
		msg := err.Error()
		if !strings.HasPrefix(msg, "w23.01 p. 16 par. 3") {
			t.Fatalf("error %q does not start with the citation", msg)
		}
		for _, part := range []string{"2", "8-9", "14-15", "20", "26-27", "not p. 16"} {
			if !strings.Contains(msg, part) {
				t.Fatalf("error %q missing %q", msg, part)
			}
		}
	})

	t.Run("paragraph that spans pages", func(t *testing.T) {
		hits, err := lib.Resolve(ctx, "w23.01 p. 4 par. 8")
		if err != nil {
			t.Fatal(err)
		}
		if len(hits) != 1 || !strings.HasPrefix(hits[0].Text, "8 Early Christians followed") {
			t.Fatalf("hits = %+v", hits)
		}
		_, err = lib.Resolve(ctx, "w23.01 p. 2 par. 8")
		const want = "w23.01 p. 2 par. 8: par. 8 is on pp. 3-4, 10, 16, 22, and 29, not p. 2"
		if err == nil || err.Error() != want {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("matthew 24:14 in both translations", func(t *testing.T) {
		hits, err := lib.Resolve(ctx, "Matt. 24:14")
		if err != nil {
			t.Fatal(err)
		}
		if len(hits) != 2 {
			t.Fatalf("hits = %d, want 2", len(hits))
		}
		const text = "And this good news of the Kingdom will be preached in all the inhabited earth for a witness to all the nations, and then the end will come."
		by := map[string]Hit{}
		for _, h := range hits {
			if h.Book != 40 || h.Chapter != 24 || h.Verse != 14 {
				t.Fatalf("location = %d:%d:%d", h.Book, h.Chapter, h.Verse)
			}
			if h.Text != text {
				t.Fatalf("%s text = %q", h.Symbol, h.Text)
			}
			by[h.Symbol] = h
		}
		if by["nwt"].Text != by["nwtsty"].Text {
			t.Fatal("translations disagree at Matthew 24:14")
		}
	})

	t.Run("verse range", func(t *testing.T) {
		hits, err := lib.Resolve(ctx, "1 Cor. 13:4-7")
		if err != nil {
			t.Fatal(err)
		}
		if len(hits) != 8 {
			t.Fatalf("hits = %d, want 8 (4 verses in 2 Bibles)", len(hits))
		}
		for _, h := range hits {
			if h.Book != 46 || h.Chapter != 13 || h.Verse < 4 || h.Verse > 7 {
				t.Fatalf("location = %+v", h)
			}
			if h.Verse == 4 && !strings.HasPrefix(h.Text, "Love is patient and kind.") {
				t.Fatalf("%s 13:4 = %q", h.Symbol, h.Text)
			}
		}
	})

	t.Run("chapter label is verse 1", func(t *testing.T) {
		hits, err := lib.Resolve(ctx, "Ps. 3:1")
		if err != nil {
			t.Fatal(err)
		}
		if len(hits) != 2 {
			t.Fatalf("hits = %d", len(hits))
		}
		for _, h := range hits {
			if h.Book != 19 || h.Chapter != 3 || h.Verse != 1 {
				t.Fatalf("location = %d %d:%d", h.Book, h.Chapter, h.Verse)
			}
			if !strings.HasPrefix(h.Text, "O Jehovah, why have my adversaries") {
				t.Fatalf("%s Ps. 3:1 = %q", h.Symbol, h.Text)
			}
		}
	})

	t.Run("john 8 starts at verse 12", func(t *testing.T) {
		hits, err := lib.Resolve(ctx, "John 8:12")
		if err != nil {
			t.Fatal(err)
		}
		if len(hits) != 2 {
			t.Fatalf("hits = %d", len(hits))
		}
		for _, h := range hits {
			if h.Verse != 12 || !strings.HasPrefix(h.Text, "Then Jesus spoke again to them, saying:") {
				t.Fatalf("%s John 8:12 = %q", h.Symbol, h.Text)
			}
		}
		if _, err := lib.Resolve(ctx, "John 8:1"); err == nil {
			t.Fatal("John 8:1 is not in these translations")
		}
	})

	t.Run("cross reference is book chapter verse", func(t *testing.T) {
		refs, err := lib.CrossRefs(ctx, "nwtsty", 40, 24, 14)
		if err != nil {
			t.Fatal(err)
		}
		if len(refs) != 7 {
			t.Fatalf("Matt. 24:14 cross-references = %d, want 7", len(refs))
		}
		if refs[0].TargetBook != 40 || refs[0].TargetChapter != 9 || refs[0].TargetVerse != 35 {
			t.Fatalf("first target = %d %d:%d", refs[0].TargetBook, refs[0].TargetChapter, refs[0].TargetVerse)
		}
		last := refs[len(refs)-1]
		if last.TargetBook != 66 || last.TargetChapter != 14 || last.TargetVerse != 6 {
			t.Fatalf("last target = %d %d:%d", last.TargetBook, last.TargetChapter, last.TargetVerse)
		}
	})

	t.Run("reimport does not duplicate", func(t *testing.T) {
		before, err := lib.Stats(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{wPath, nwtPath, styPath} {
			res := mustImport(t, lib, path)
			if !res.AlreadyImported {
				t.Fatalf("%s was imported again", path)
			}
		}
		after, err := lib.Stats(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if before != after {
			t.Fatalf("re-import changed rows: before %+v after %+v", before, after)
		}
		hits, err := lib.Resolve(ctx, "w23.01 p. 2 par. 3")
		if err != nil || len(hits) != 1 {
			t.Fatalf("after re-import: %v hits=%d", err, len(hits))
		}
	})

	for _, p := range []string{wPath, nwtPath, styPath} {
		if sha256File(t, p) != before[p] {
			t.Fatalf("%s changed during import", p)
		}
	}
}

func mustImport(t *testing.T, lib *Library, path string) ImportResult {
	t.Helper()
	res, err := lib.Import(context.Background(), path)
	if err != nil {
		t.Fatalf("import %s: %v", path, err)
	}
	t.Logf("import %s already=%v documents=%d paragraphs=%d verses=%d notes=%d refs=%d duration=%s",
		filepath.Base(path), res.AlreadyImported, res.Documents, res.Paragraphs, res.Verses, res.StudyNotes, res.CrossRefs, res.Duration)
	return res
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
