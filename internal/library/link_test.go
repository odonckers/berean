package library

import (
	"context"
	"log/slog"
	"path/filepath"
	"testing"
)

func TestResolveLinkShape(t *testing.T) {
	ctx := context.Background()
	lib, err := Open(filepath.Join(t.TempDir(), "berean.db"), slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })

	bible, err := lib.ResolveLink(ctx, "jwpub://b/NWTR/20:2:1-20:2:5")
	if err != nil {
		t.Fatal(err)
	}
	if bible.Kind != LinkVerse || bible.Book != 20 || bible.Chapter != 2 || bible.Verse != 1 || bible.EndVerse != 5 {
		t.Fatalf("bible = %+v", bible)
	}
	if bible.String() != "Proverbs 2:1-5" {
		t.Fatalf("bible string = %q", bible.String())
	}

	missing, err := lib.ResolveLink(ctx, "jwpub://p/E:1200001287/1-10")
	if err != nil {
		t.Fatal(err)
	}
	if missing.Kind != LinkMissing || missing.MepsDocumentID != 1200001287 || missing.ParFrom != 1 || missing.ParTo != 10 {
		t.Fatalf("missing = %+v", missing)
	}

	web, err := lib.ResolveLink(ctx, "https://www.jw.org/finder?lank=pub-patv_2_VIDEO")
	if err != nil || web.Kind != LinkExternal {
		t.Fatalf("web = %+v err=%v", web, err)
	}
	if _, err := lib.ResolveLink(ctx, "jwpub://nope"); err == nil {
		t.Fatal("unrecognized link returned no error")
	}
}
