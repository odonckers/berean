// Package library stores decrypted publications in a local SQLite file and
// resolves citations against that file. The driver is modernc.org/sqlite:
// pure Go, so Berean stays cgo-free and the library is a single file.
package library

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
	"sync"
	"time"

	"github.com/odonckers/berean/internal/cite"
	"github.com/odonckers/berean/internal/jwpub"

	_ "modernc.org/sqlite"
)

// resolveLanguage is the Meps language index used for citations.
// English publications are 0.
const resolveLanguage = 0

const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS publication (
	id INTEGER PRIMARY KEY,
	meps_language INTEGER NOT NULL,
	symbol TEXT NOT NULL,
	cite_symbol TEXT NOT NULL,
	year INTEGER NOT NULL,
	issue_tag INTEGER NOT NULL,
	month INTEGER NOT NULL,
	day INTEGER NOT NULL,
	title TEXT NOT NULL,
	short_title TEXT NOT NULL,
	issue_title TEXT NOT NULL,
	pub_type TEXT NOT NULL,
	file_hash TEXT NOT NULL,
	UNIQUE (meps_language, symbol, year, issue_tag)
);

CREATE TABLE IF NOT EXISTS document (
	publication_id INTEGER NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
	document_id INTEGER NOT NULL,
	meps_document_id INTEGER NOT NULL,
	title TEXT NOT NULL,
	first_page INTEGER,
	last_page INTEGER,
	PRIMARY KEY (publication_id, document_id)
);

CREATE TABLE IF NOT EXISTS paragraph (
	publication_id INTEGER NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
	document_id INTEGER NOT NULL,
	paragraph_index INTEGER NOT NULL,
	ordinal INTEGER NOT NULL,
	paragraph_number INTEGER,
	first_page INTEGER NOT NULL,
	last_page INTEGER NOT NULL,
	text TEXT NOT NULL,
	PRIMARY KEY (publication_id, document_id, paragraph_index, ordinal),
	FOREIGN KEY (publication_id, document_id) REFERENCES document(publication_id, document_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS paragraph_lookup
	ON paragraph(publication_id, paragraph_number, first_page, last_page);

CREATE TABLE IF NOT EXISTS verse (
	publication_id INTEGER NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
	book INTEGER NOT NULL,
	chapter INTEGER NOT NULL,
	verse INTEGER NOT NULL,
	text TEXT NOT NULL,
	PRIMARY KEY (publication_id, book, chapter, verse)
);

CREATE TABLE IF NOT EXISTS study_note (
	publication_id INTEGER NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
	book INTEGER NOT NULL,
	chapter INTEGER NOT NULL,
	verse INTEGER NOT NULL,
	label TEXT NOT NULL,
	text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS study_note_verse
	ON study_note(publication_id, book, chapter, verse);

CREATE TABLE IF NOT EXISTS cross_reference (
	publication_id INTEGER NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
	book INTEGER NOT NULL,
	chapter INTEGER NOT NULL,
	verse INTEGER NOT NULL,
	target_book INTEGER NOT NULL,
	target_chapter INTEGER NOT NULL,
	target_verse INTEGER NOT NULL,
	target_end_book INTEGER NOT NULL,
	target_end_chapter INTEGER NOT NULL,
	target_end_verse INTEGER NOT NULL,
	block_number INTEGER NOT NULL,
	element_number INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cross_reference_src
	ON cross_reference(publication_id, book, chapter, verse);
`

// Library is Berean's local store.
type Library struct {
	db  *sql.DB
	log *slog.Logger
	mu  sync.Mutex
}

// ImportResult counts what an import wrote, or what was already stored.
type ImportResult struct {
	Symbol     string
	CiteSymbol string
	Title      string
	Year       int
	IssueTag   int
	Documents  int
	Paragraphs int
	Verses     int
	StudyNotes int
	CrossRefs  int
	Duration   time.Duration
	// AlreadyImported is set when the same file was imported before.
	AlreadyImported bool
}

// Hit is one paragraph, verse, or study note a citation resolved to.
type Hit struct {
	Kind        cite.Kind
	Publication string
	Symbol      string
	Document    string
	Text        string
	Year        int
	Month       int
	Day         int
	Page        int
	Paragraph   int
	Book        int
	Chapter     int
	Verse       int
}

// Stats is a row count of the whole library.
type Stats struct {
	Publications int
	Documents    int
	Paragraphs   int
	Verses       int
	StudyNotes   int
	CrossRefs    int
}

// CrossRef is a stored marginal reference in book, chapter, verse form.
type CrossRef struct {
	Book, Chapter, Verse                            int
	TargetBook, TargetChapter, TargetVerse          int
	TargetEndBook, TargetEndChapter, TargetEndVerse int
}

// Open opens or creates the library at path.
func Open(path string, logger *slog.Logger) (*Library, error) {
	if logger == nil {
		logger = slog.Default()
	}
	u := url.URL{Scheme: "file", Path: path, RawQuery: "mode=rwc"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	l := &Library{db: db, log: logger}
	if err := l.init(); err != nil {
		db.Close()
		return nil, err
	}
	return l, nil
}

func (l *Library) init() error {
	if _, err := l.db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		return err
	}
	var fk int
	if err := l.db.QueryRow(`PRAGMA foreign_keys`).Scan(&fk); err != nil {
		return err
	}
	if fk != 1 {
		return fmt.Errorf("sqlite foreign keys are off")
	}
	if _, err := l.db.Exec(schema); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	return nil
}

// Close closes the database.
func (l *Library) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.db.Close()
}

// Import reads a .jwpub and stores its text. Importing the same file again
// does not add rows. A changed file with the same publication card replaces
// the stored one.
func (l *Library) Import(ctx context.Context, path string) (ImportResult, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	start := time.Now()
	base := filepath.Base(path)

	sum, err := fileSHA256(path)
	if err != nil {
		return ImportResult{}, err
	}
	pub, err := jwpub.Open(path)
	if err != nil {
		return ImportResult{}, err
	}
	defer pub.Close()
	meta := pub.Meta()

	var existingID int64
	var existingHash string
	err = l.db.QueryRowContext(ctx, `
		SELECT id, file_hash FROM publication
		WHERE meps_language=? AND symbol=? AND year=? AND issue_tag=?`,
		meta.Language, meta.Symbol, meta.Year, meta.IssueTag).Scan(&existingID, &existingHash)
	if err != nil && err != sql.ErrNoRows {
		return ImportResult{}, err
	}
	if err == nil && existingHash == sum {
		res, err := l.storedResult(ctx, existingID, meta, time.Since(start))
		if err != nil {
			return ImportResult{}, err
		}
		res.AlreadyImported = true
		l.log.Info("import skipped",
			"file", base,
			"symbol", res.Symbol,
			"cite_symbol", res.CiteSymbol,
			"year", res.Year,
			"issue", res.IssueTag,
			"reason", "already stored",
			"documents", res.Documents,
			"paragraphs", res.Paragraphs,
			"verses", res.Verses,
			"study_notes", res.StudyNotes,
			"cross_references", res.CrossRefs,
			"duration", res.Duration,
		)
		return res, nil
	}

	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return ImportResult{}, err
	}
	defer tx.Rollback()
	if existingID != 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM publication WHERE id=?`, existingID); err != nil {
			return ImportResult{}, err
		}
	}
	title := meta.Title
	resExec, err := tx.ExecContext(ctx, `
		INSERT INTO publication (
			meps_language, symbol, cite_symbol, year, issue_tag, month, day,
			title, short_title, issue_title, pub_type, file_hash
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.Language, meta.Symbol, meta.CiteSymbol, meta.Year, meta.IssueTag, meta.Month, meta.Day,
		meta.Title, meta.ShortTitle, meta.IssueTitle, meta.Type, sum)
	if err != nil {
		return ImportResult{}, err
	}
	pubID, err := resExec.LastInsertId()
	if err != nil {
		return ImportResult{}, err
	}
	counts, err := insertContent(ctx, tx, pub, pubID)
	if err != nil {
		return ImportResult{}, fmt.Errorf("import %s: %w", base, err)
	}
	if err := tx.Commit(); err != nil {
		return ImportResult{}, err
	}
	res := ImportResult{
		Symbol: meta.Symbol, CiteSymbol: meta.CiteSymbol, Title: title,
		Year: meta.Year, IssueTag: meta.IssueTag,
		Documents: counts.docs, Paragraphs: counts.paras,
		Verses: counts.verses, StudyNotes: counts.notes, CrossRefs: counts.refs,
		Duration: time.Since(start),
	}
	l.log.Info("imported",
		"file", base,
		"symbol", res.Symbol,
		"cite_symbol", res.CiteSymbol,
		"year", res.Year,
		"issue", res.IssueTag,
		"title", res.Title,
		"documents", res.Documents,
		"paragraphs", res.Paragraphs,
		"verses", res.Verses,
		"study_notes", res.StudyNotes,
		"cross_references", res.CrossRefs,
		"duration", res.Duration,
	)
	return res, nil
}

type counts struct {
	docs, paras, verses, notes, refs int
}

func insertContent(ctx context.Context, tx *sql.Tx, pub *jwpub.Publication, pubID int64) (counts, error) {
	var c counts
	docStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO document (publication_id, document_id, meps_document_id, title, first_page, last_page)
		VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return c, err
	}
	defer docStmt.Close()
	parStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO paragraph (
			publication_id, document_id, paragraph_index, ordinal, paragraph_number, first_page, last_page, text
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return c, err
	}
	defer parStmt.Close()
	err = pub.ForEachDocument(ctx, func(d jwpub.Document) error {
		var first, last any
		if d.HasPages {
			first, last = d.FirstPage, d.LastPage
		}
		if _, err := docStmt.ExecContext(ctx, pubID, d.ID, d.MepsDocumentID, d.Title, first, last); err != nil {
			return fmt.Errorf("document %d: %w", d.ID, err)
		}
		c.docs++
		// Outline documents repeat a data-pid for the chapter line and the
		// first entry under it. ordinal keeps both texts.
		seen := map[int]int{}
		for _, para := range d.Paragraphs {
			ord := seen[para.Index]
			seen[para.Index]++
			var num any
			if para.Numbered {
				num = para.Number
			}
			if _, err := parStmt.ExecContext(ctx, pubID, d.ID, para.Index, ord, num, para.FirstPage, para.LastPage, para.Text); err != nil {
				return fmt.Errorf("document %d paragraph %d: %w", d.ID, para.Index, err)
			}
			c.paras++
		}
		return nil
	})
	if err != nil {
		return c, err
	}

	if !pub.Meta().Bible() {
		return c, nil
	}
	verseStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO verse (publication_id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return c, err
	}
	defer verseStmt.Close()
	err = pub.ForEachVerse(ctx, func(v jwpub.Verse) error {
		if _, err := verseStmt.ExecContext(ctx, pubID, v.Book, v.Chapter, v.Verse, v.Text); err != nil {
			return fmt.Errorf("verse %d:%d:%d: %w", v.Book, v.Chapter, v.Verse, err)
		}
		c.verses++
		return nil
	})
	if err != nil {
		return c, err
	}
	noteStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO study_note (publication_id, book, chapter, verse, label, text) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return c, err
	}
	defer noteStmt.Close()
	err = pub.ForEachStudyNote(ctx, func(n jwpub.StudyNote) error {
		if _, err := noteStmt.ExecContext(ctx, pubID, n.Book, n.Chapter, n.Verse, n.Label, n.Text); err != nil {
			return err
		}
		c.notes++
		return nil
	})
	if err != nil {
		return c, err
	}
	refStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO cross_reference (
			publication_id, book, chapter, verse,
			target_book, target_chapter, target_verse,
			target_end_book, target_end_chapter, target_end_verse,
			block_number, element_number
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return c, err
	}
	defer refStmt.Close()
	err = pub.ForEachCrossRef(ctx, func(r jwpub.CrossRef) error {
		_, err := refStmt.ExecContext(ctx, pubID,
			r.Book, r.Chapter, r.Verse,
			r.TargetBook, r.TargetChapter, r.TargetVerse,
			r.TargetEndBook, r.TargetEndChapter, r.TargetEndVerse,
			r.Block, r.Element)
		if err != nil {
			return err
		}
		c.refs++
		return nil
	})
	return c, err
}

func (l *Library) storedResult(ctx context.Context, id int64, meta jwpub.Meta, d time.Duration) (ImportResult, error) {
	var c counts
	err := l.db.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM document WHERE publication_id=?),
			(SELECT COUNT(*) FROM paragraph WHERE publication_id=?),
			(SELECT COUNT(*) FROM verse WHERE publication_id=?),
			(SELECT COUNT(*) FROM study_note WHERE publication_id=?),
			(SELECT COUNT(*) FROM cross_reference WHERE publication_id=?)`,
		id, id, id, id, id).Scan(&c.docs, &c.paras, &c.verses, &c.notes, &c.refs)
	if err != nil {
		return ImportResult{}, err
	}
	return ImportResult{
		Symbol: meta.Symbol, CiteSymbol: meta.CiteSymbol, Title: meta.Title,
		Year: meta.Year, IssueTag: meta.IssueTag,
		Documents: c.docs, Paragraphs: c.paras, Verses: c.verses,
		StudyNotes: c.notes, CrossRefs: c.refs, Duration: d,
	}, nil
}

// Stats counts every stored row.
func (l *Library) Stats(ctx context.Context) (Stats, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var s Stats
	err := l.db.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM publication),
			(SELECT COUNT(*) FROM document),
			(SELECT COUNT(*) FROM paragraph),
			(SELECT COUNT(*) FROM verse),
			(SELECT COUNT(*) FROM study_note),
			(SELECT COUNT(*) FROM cross_reference)`).Scan(
		&s.Publications, &s.Documents, &s.Paragraphs, &s.Verses, &s.StudyNotes, &s.CrossRefs)
	return s, err
}

// CrossRefs returns the marginal references stored for one verse of one publication.
// symbol matches either the file symbol or the citation symbol.
func (l *Library) CrossRefs(ctx context.Context, symbol string, book, chapter, verse int) ([]CrossRef, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var id int64
	err := l.db.QueryRowContext(ctx, `
		SELECT id FROM publication
		WHERE meps_language=? AND (symbol=? OR cite_symbol=?)`,
		resolveLanguage, symbol, symbol).Scan(&id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("no publication %s", symbol)
	}
	if err != nil {
		return nil, err
	}
	rows, err := l.db.QueryContext(ctx, `
		SELECT target_book, target_chapter, target_verse,
		       target_end_book, target_end_chapter, target_end_verse
		FROM cross_reference
		WHERE publication_id=? AND book=? AND chapter=? AND verse=?
		ORDER BY block_number, element_number`, id, book, chapter, verse)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CrossRef
	for rows.Next() {
		var r CrossRef
		r.Book, r.Chapter, r.Verse = book, chapter, verse
		if err := rows.Scan(&r.TargetBook, &r.TargetChapter, &r.TargetVerse, &r.TargetEndBook, &r.TargetEndChapter, &r.TargetEndVerse); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func displayTitle(issue, title string) string {
	if issue != "" {
		return issue
	}
	return title
}
