package library

import (
	"bytes"
	"context"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"github.com/odonckers/berean/internal/cite"
)

func TestImportHint(t *testing.T) {
	study := cite.Citation{Kind: cite.KindPub, Symbol: "w", Year: 2023, Month: 1}
	if got := importHint(study); got != "Import the January 2023 study edition of The Watchtower (w23.01)." {
		t.Fatalf("study edition %q", got)
	}
	dated := cite.Citation{Kind: cite.KindPub, Symbol: "w", Year: 2015, Month: 2, Day: 15}
	if got := importHint(dated); got != "Import the February 15, 2015 issue of The Watchtower (w15 2/15)." {
		t.Fatalf("dated issue %q", got)
	}
	missing := cite.Citation{Kind: cite.KindPub, Symbol: "zz", Year: 2020}
	if got := importHint(missing); !strings.Contains(got, "It is not in the library.") || strings.Contains(got, "no publication") {
		t.Fatalf("unknown publication %q", got)
	}
}

func TestResolveLogsOnEmptyLibrary(t *testing.T) {
	var buf bytes.Buffer
	lib, err := Open(filepath.Join(t.TempDir(), "empty.db"), slog.New(slog.NewTextHandler(&buf, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })

	_, err = lib.Resolve(context.Background(), "w23.01 p. 2 par. 3")
	const want = "Import the January 2023 study edition of The Watchtower (w23.01)."
	if err == nil || err.Error() != want {
		t.Fatalf("missing publication: %v", err)
	}
	if !strings.Contains(buf.String(), "result=missing_publication") {
		t.Fatalf("log = %s", buf.String())
	}

	buf.Reset()
	_, err = lib.Resolve(context.Background(), "w23.13 p. 2 par. 1")
	if err == nil || !strings.Contains(err.Error(), "Couldn't read the citation") {
		t.Fatalf("parse error: %v", err)
	}
	if !strings.Contains(buf.String(), "result=parse_error") {
		t.Fatalf("log = %s", buf.String())
	}
}
