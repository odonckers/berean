package library

import (
	"context"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"github.com/odonckers/berean/internal/jwpub"
)

func TestInsightCitationRules(t *testing.T) {
	ctx := context.Background()
	lib := openTestLib(t)
	execSQL(t, lib, `
		INSERT INTO publication (
			meps_language, symbol, cite_symbol, year, issue_tag, month, day,
			title, short_title, issue_title, pub_type, file_hash
		) VALUES (0, 'it', 'it', 2018, 0, 0, 0,
			'Insight on the Scriptures', 'Insight', '', 'Book', 'test')`)
	execSQL(t, lib, `
		INSERT INTO document (publication_id, document_id, meps_document_id, title, first_page, last_page, volume)
		VALUES
			(1, 10, 10, 'Guard', 1010, 1011, 1),
			(1, 20, 20, 'Sovereignty', 1008, 1012, 2),
			(1, 30, 30, 'Jehovah’s Day', 22, 22, 2)`)
	execSQL(t, lib, `
		INSERT INTO paragraph (
			publication_id, document_id, paragraph_index, ordinal, paragraph_number,
			first_page, last_page, text, markup
		) VALUES (1, 10, 4, 0, 3, 5, 5, 'plain it paragraph', '')`)

	t.Run("title opens the named volume", func(t *testing.T) {
		hits := mustResolve(t, lib, "it-2 Sovereignty")
		if len(hits) != 1 || hits[0].Document != "Sovereignty" || hits[0].DocumentID != 20 || hits[0].Symbol != "it" {
			t.Fatalf("hits = %+v", hits)
		}
		hits = mustResolve(t, lib, "it-1 Guard")
		if len(hits) != 1 || hits[0].Document != "Guard" || hits[0].DocumentID != 10 {
			t.Fatalf("hits = %+v", hits)
		}
		// The file stores a curly apostrophe. A typed ASCII apostrophe still matches.
		hits = mustResolve(t, lib, "it-2 Jehovah's Day")
		if len(hits) != 1 || hits[0].DocumentID != 30 {
			t.Fatalf("hits = %+v", hits)
		}
		if _, err := lib.Resolve(ctx, "it-1 Sovereignty"); err == nil || !strings.Contains(err.Error(), "was not found") {
			t.Fatalf("volume 1 must not open the volume 2 article: %v", err)
		}
	})

	t.Run("page stays in the named volume", func(t *testing.T) {
		hits := mustResolve(t, lib, "it-2 p. 1011")
		if len(hits) != 1 || hits[0].Document != "Sovereignty" || hits[0].DocumentID != 20 {
			t.Fatalf("hits = %+v", hits)
		}
		hits = mustResolve(t, lib, "it-1 p. 1011")
		if len(hits) != 1 || hits[0].Document != "Guard" || hits[0].DocumentID != 10 {
			t.Fatalf("hits = %+v", hits)
		}
		if _, err := lib.Resolve(ctx, "it-2 p. 5 par. 3"); err == nil || !strings.Contains(err.Error(), "was not found") {
			t.Fatalf("volume 2 page opened the volume 1 paragraph: %v", err)
		}
	})

	t.Run("plain it is unchanged", func(t *testing.T) {
		hits := mustResolve(t, lib, "it p. 5 par. 3")
		if len(hits) != 1 || hits[0].Text != "plain it paragraph" || hits[0].DocumentID != 10 {
			t.Fatalf("hits = %+v", hits)
		}
		_, err := lib.Resolve(ctx, "it p. 1011")
		if err == nil || err.Error() != "it needs a page and a paragraph" {
			t.Fatalf("plain page citation: %v", err)
		}
		_, err = lib.Resolve(ctx, "it Sovereignty")
		if err == nil || !strings.Contains(err.Error(), "Couldn't read the citation") {
			t.Fatalf("plain it title: %v", err)
		}
	})
}

func TestInsightPageBreaksWhenVolumeIsUnknown(t *testing.T) {
	ctx := context.Background()
	lib := openTestLib(t)
	execSQL(t, lib, `
		INSERT INTO publication (
			meps_language, symbol, cite_symbol, year, issue_tag, month, day,
			title, short_title, issue_title, pub_type, file_hash
		) VALUES (0, 'it', 'it', 2018, 0, 0, 0,
			'Insight on the Scriptures', 'Insight', '', 'Book', 'test')`)
	execSQL(t, lib, `
		INSERT INTO document (publication_id, document_id, meps_document_id, title, first_page, last_page, volume)
		VALUES
			(1, 10, 10, 'Guard', 1011, 1011, 0),
			(1, 20, 20, 'Sovereignty', 1011, 1011, 0)`)

	_, err := lib.Resolve(ctx, "it-2 p. 1011")
	if err == nil || err.Error() != "it-2 p. 1011: the file does not say which volume this page is in" {
		t.Fatalf("unknown volume: %v", err)
	}
	// The title is unique, so it still opens when the file has no volume marks.
	hits := mustResolve(t, lib, "it-2 Sovereignty")
	if len(hits) != 1 || hits[0].DocumentID != 20 {
		t.Fatalf("title hits = %+v", hits)
	}
}

func TestInsightFileVolumes(t *testing.T) {
	path := fetchFixture(t, fixture{pub: "it", file: "it_E.jwpub", sum: "b8d2145ef9ab7fff7c9ab3050ab4763f"})
	pub, err := jwpub.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pub.Close() })
	if pub.Meta().Symbol != "it" || pub.Meta().CiteSymbol != "it" || pub.Meta().Title != "Insight on the Scriptures" {
		t.Fatalf("card = %+v", pub.Meta())
	}
	vols, err := pub.DocumentVolumes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// These document ids are the Guard and Sovereignty articles in this file.
	// Page 1011 falls in both; the volume mark is what keeps them apart.
	if vols[1776] != 1 || vols[4198] != 2 {
		t.Fatalf("Guard volume=%d Sovereignty volume=%d", vols[1776], vols[4198])
	}
}

func TestMissingInsightHint(t *testing.T) {
	lib := openTestLib(t)
	for _, citation := range []string{"it-2 Sovereignty", "it-1 Guard", "it-2 p. 1011"} {
		_, err := lib.Resolve(context.Background(), citation)
		if err == nil || err.Error() != "Import Insight on the Scriptures (it)." {
			t.Fatalf("%s: %v", citation, err)
		}
	}
}

func openTestLib(t *testing.T) *Library {
	t.Helper()
	lib, err := Open(filepath.Join(t.TempDir(), "berean.db"), slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	return lib
}

func execSQL(t *testing.T, lib *Library, q string) {
	t.Helper()
	if _, err := lib.db.Exec(q); err != nil {
		t.Fatal(err)
	}
}

func mustResolve(t *testing.T, lib *Library, citation string) []Hit {
	t.Helper()
	hits, err := lib.Resolve(context.Background(), citation)
	if err != nil {
		t.Fatalf("%s: %v", citation, err)
	}
	return hits
}
