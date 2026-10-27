package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/odonckers/berean/internal/cite"
	"github.com/odonckers/berean/internal/library"
	"github.com/odonckers/berean/internal/read"
)

const usageText = `berean is a personal study library.

Usage:
  berean [-db berean.db]
  berean [-db berean.db] open
  berean [-db berean.db] import <file.jwpub>
  berean [-db berean.db] cite <citation>
  berean [-db berean.db] bench
  berean version

With no command, berean opens the study window.
The default database is berean.db in the current directory.
bench prints p50, p95, and max frame time for pan and zoom with 200 cards.
version prints the version linked in at build time.
`

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(os.Args[1:], logger); err != nil {
		logger.Error("command failed", "err", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, usageText)
	os.Exit(2)
}

func run(args []string, logger *slog.Logger) error {
	dbPath := "berean.db"
	var rest []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-db" || a == "--db":
			if i+1 >= len(args) {
				usage()
			}
			i++
			dbPath = args[i]
		case strings.HasPrefix(a, "-db="):
			dbPath = strings.TrimPrefix(a, "-db=")
		case a == "-h" || a == "--help" || a == "help":
			usage()
		default:
			rest = append(rest, a)
		}
	}
	if len(rest) == 0 {
		return openStudy(dbPath, logger)
	}
	switch rest[0] {
	case "import":
		if len(rest) != 2 {
			usage()
		}
		lib, err := library.Open(dbPath, logger)
		if err != nil {
			return err
		}
		defer lib.Close()
		_, err = lib.Import(context.Background(), rest[1])
		return err
	case "cite":
		if len(rest) < 2 {
			usage()
		}
		q := strings.Join(rest[1:], " ")
		lib, err := library.Open(dbPath, logger)
		if err != nil {
			return err
		}
		defer lib.Close()
		start := time.Now()
		hits, err := lib.Resolve(context.Background(), q)
		if err != nil {
			return fmt.Errorf("%w (%s)", err, time.Since(start))
		}
		logger.Info("resolved", "citation", q, "hits", len(hits), "duration", time.Since(start))
		printHits(os.Stdout, hits)
		return nil
	case "open":
		if len(rest) != 1 {
			usage()
		}
		return openStudy(dbPath, logger)
	case "bench":
		if len(rest) != 1 {
			usage()
		}
		return read.CommandBench(os.Stdout, logger, dbPath)
	case "version":
		if len(rest) != 1 {
			usage()
		}
		fmt.Println(read.Version)
		return nil
	default:
		usage()
	}
	return nil
}

func openStudy(dbPath string, logger *slog.Logger) error {
	lib, err := library.Open(dbPath, logger)
	if err != nil {
		return err
	}
	defer lib.Close()
	return read.Run(lib, logger)
}

func printHits(w *os.File, hits []library.Hit) {
	prev := ""
	for _, h := range hits {
		key := h.Symbol + "\x00" + h.Publication
		if key != prev {
			if prev != "" {
				fmt.Fprintln(w)
			}
			prev = key
			fmt.Fprintf(w, "%s (%s)\n", h.Publication, h.Symbol)
		}
		switch h.Kind {
		case cite.KindPub:
			fmt.Fprintf(w, "%s · p. %d par. %d\n%s\n", h.Document, h.Page, h.Paragraph, h.Text)
		case cite.KindStudyNote:
			fmt.Fprintf(w, "%s %d:%d study note\n%s\n", cite.BookName(h.Book), h.Chapter, h.Verse, h.Text)
		default:
			fmt.Fprintf(w, "%s %d:%d\n%s\n", cite.BookName(h.Book), h.Chapter, h.Verse, h.Text)
		}
	}
}
