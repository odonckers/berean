package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/odonckers/berean/internal/cite"
)

// ResolveError is a citation that could not be resolved.
// Result is ok's counterpart: wrong_page, missing_publication, or parse_error.
type ResolveError struct {
	Result string
	msg    string
	Err    error
}

func (e *ResolveError) Error() string { return e.msg }

func (e *ResolveError) Unwrap() error { return e.Err }

// Resolve parses citation and returns the stored text it points at.
// It logs one structured result: ok, wrong_page, missing_publication,
// parse_error, or error.
func (l *Library) Resolve(ctx context.Context, citation string) ([]Hit, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	hits, err := l.resolve(ctx, citation)
	l.logResolve(citation, hits, err)
	return hits, err
}

func (l *Library) resolve(ctx context.Context, citation string) ([]Hit, error) {
	c, err := cite.Parse(citation)
	if err != nil {
		return nil, &ResolveError{Result: "parse_error", Err: err, msg: fmt.Sprintf("Couldn't read the citation %q.", citation)}
	}
	switch c.Kind {
	case cite.KindPub:
		return l.resolvePub(ctx, c)
	case cite.KindBible:
		return l.resolveBible(ctx, c, false)
	case cite.KindStudyNote:
		return l.resolveBible(ctx, c, true)
	default:
		return nil, fmt.Errorf("unsupported citation %s", c)
	}
}

type pubRow struct {
	ID               int64
	Symbol           string
	Title            string
	IssueTitle       string
	Year, Month, Day int
}

func (l *Library) resolvePub(ctx context.Context, c cite.Citation) ([]Hit, error) {
	q := `SELECT id, symbol, title, issue_title, year, month, day
		FROM publication WHERE meps_language=? AND cite_symbol=?`
	args := []any{resolveLanguage, c.Symbol}
	if c.Year != 0 {
		q += ` AND year=?`
		args = append(args, c.Year)
	}
	if c.Month != 0 {
		q += ` AND month=?`
		args = append(args, c.Month)
	}
	if c.Day != 0 {
		q += ` AND day=?`
		args = append(args, c.Day)
	}
	q += ` ORDER BY year, issue_tag, symbol`
	pubs, err := l.queryPubs(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	if len(pubs) == 0 {
		return nil, &ResolveError{Result: "missing_publication", msg: importHint(c)}
	}
	if len(c.Pages) == 0 || len(c.Pars) == 0 {
		return nil, fmt.Errorf("%s needs a page and a paragraph", pubLabel(c))
	}
	var hits []Hit
	err = eachNumber(c.Pars, func(n int) error {
		found := false
		sawParagraph := false
		var onFirst, onLast int
		for _, pub := range pubs {
			rows, err := l.paragraphs(ctx, pub.ID, n)
			if err != nil {
				return err
			}
			if len(rows) > 0 && !sawParagraph {
				// The paragraph exists. Its stored pages are the right ones
				// when the citation named a different page.
				sawParagraph = true
				onFirst, onLast = rows[0].first, rows[0].last
			}
			for _, row := range rows {
				if !overlaps(row.first, row.last, c.Pages) {
					continue
				}
				found = true
				hits = append(hits, Hit{
					Kind:           cite.KindPub,
					Publication:    displayTitle(pub.IssueTitle, pub.Title),
					Symbol:         pub.Symbol,
					Document:       row.title,
					Text:           row.text,
					Year:           pub.Year,
					Month:          pub.Month,
					Day:            pub.Day,
					Page:           citedPage(row.first, row.last, c.Pages),
					Paragraph:      n,
					PubID:          pub.ID,
					DocumentID:     row.docID,
					ParagraphIndex: row.index,
				})
			}
		}
		if !found {
			if sawParagraph {
				return wrongPage(n, onFirst, onLast, c.Pages)
			}
			return fmt.Errorf("par. %d was not found in %s", n, pubLabel(c))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return hits, nil
}

type paraRow struct {
	docID, index int
	title        string
	text         string
	first, last  int
}

func (l *Library) paragraphs(ctx context.Context, pubID int64, number int) ([]paraRow, error) {
	rows, err := l.db.QueryContext(ctx, `
		SELECT d.document_id, p.paragraph_index, d.title, p.text, p.first_page, p.last_page
		FROM paragraph p
		JOIN document d
		  ON d.publication_id = p.publication_id AND d.document_id = p.document_id
		WHERE p.publication_id=? AND p.paragraph_number=?
		ORDER BY d.document_id, p.paragraph_index`, pubID, number)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []paraRow
	for rows.Next() {
		var r paraRow
		if err := rows.Scan(&r.docID, &r.index, &r.title, &r.text, &r.first, &r.last); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (l *Library) resolveBible(ctx context.Context, c cite.Citation, studyNote bool) ([]Hit, error) {
	pubs, err := l.queryPubs(ctx, `
		SELECT id, symbol, title, issue_title, year, month, day
		FROM publication
		WHERE meps_language=? AND pub_type='Bible'
		ORDER BY symbol`, resolveLanguage)
	if err != nil {
		return nil, err
	}
	if len(pubs) == 0 {
		return nil, fmt.Errorf("no Bible in the library")
	}
	kind := cite.KindBible
	if studyNote {
		kind = cite.KindStudyNote
	}
	var hits []Hit
	var missing error
	for _, pub := range pubs {
		pubHits, err := l.bibleHits(ctx, pub, c, kind)
		if err != nil {
			if missing == nil {
				missing = err
			}
			continue
		}
		hits = append(hits, pubHits...)
	}
	if len(hits) == 0 {
		if missing != nil {
			return nil, missing
		}
		return nil, fmt.Errorf("%s was not found", scriptureLabel(c))
	}
	return hits, nil
}

func (l *Library) bibleHits(ctx context.Context, pub pubRow, c cite.Citation, kind cite.Kind) ([]Hit, error) {
	var hits []Hit
	for _, sp := range c.Spans {
		if len(sp.Verses) == 0 {
			rows, err := l.chapter(ctx, pub.ID, c.Book, sp.Chapter, kind)
			if err != nil {
				return nil, err
			}
			if len(rows) == 0 {
				return nil, fmt.Errorf("%s %d was not found", cite.BookName(c.Book), sp.Chapter)
			}
			hits = append(hits, rows...)
			continue
		}
		for _, r := range sp.Verses {
			for v := r.From; v <= r.To; v++ {
				h, err := l.oneVerse(ctx, pub, c.Book, sp.Chapter, v, kind)
				if err != nil {
					return nil, err
				}
				hits = append(hits, h)
			}
		}
	}
	for i := range hits {
		hits[i].Publication = displayTitle(pub.IssueTitle, pub.Title)
		hits[i].Symbol = pub.Symbol
		hits[i].Year, hits[i].Month, hits[i].Day = pub.Year, pub.Month, pub.Day
		hits[i].Kind = kind
		hits[i].PubID = pub.ID
	}
	return hits, nil
}

func (l *Library) oneVerse(ctx context.Context, pub pubRow, book, chapter, verse int, kind cite.Kind) (Hit, error) {
	h := Hit{Book: book, Chapter: chapter, Verse: verse}
	var err error
	if kind == cite.KindStudyNote {
		err = l.db.QueryRowContext(ctx, `
			SELECT text FROM study_note
			WHERE publication_id=? AND book=? AND chapter=? AND verse=?
			LIMIT 1`, pub.ID, book, chapter, verse).Scan(&h.Text)
	} else {
		err = l.db.QueryRowContext(ctx, `
			SELECT text FROM verse
			WHERE publication_id=? AND book=? AND chapter=? AND verse=?`,
			pub.ID, book, chapter, verse).Scan(&h.Text)
	}
	if err == sql.ErrNoRows {
		if kind == cite.KindStudyNote {
			return Hit{}, fmt.Errorf("no study note for %s %d:%d", cite.BookName(book), chapter, verse)
		}
		return Hit{}, fmt.Errorf("%s %d:%d was not found", cite.BookName(book), chapter, verse)
	}
	if err != nil {
		return Hit{}, err
	}
	return h, nil
}

func (l *Library) chapter(ctx context.Context, pubID int64, book, chapter int, kind cite.Kind) ([]Hit, error) {
	q := `SELECT verse, text FROM verse WHERE publication_id=? AND book=? AND chapter=? ORDER BY verse`
	if kind == cite.KindStudyNote {
		q = `SELECT verse, text FROM study_note WHERE publication_id=? AND book=? AND chapter=? ORDER BY verse`
	}
	rows, err := l.db.QueryContext(ctx, q, pubID, book, chapter)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Hit
	for rows.Next() {
		var h Hit
		h.Book, h.Chapter = book, chapter
		if err := rows.Scan(&h.Verse, &h.Text); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (l *Library) queryPubs(ctx context.Context, q string, args ...any) ([]pubRow, error) {
	rows, err := l.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []pubRow
	for rows.Next() {
		var p pubRow
		if err := rows.Scan(&p.ID, &p.Symbol, &p.Title, &p.IssueTitle, &p.Year, &p.Month, &p.Day); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func eachNumber(rs []cite.Range, fn func(int) error) error {
	for _, r := range rs {
		for n := r.From; n <= r.To; n++ {
			if err := fn(n); err != nil {
				return err
			}
		}
	}
	return nil
}

func overlaps(first, last int, pages []cite.Range) bool {
	for _, r := range pages {
		if first <= r.To && last >= r.From {
			return true
		}
	}
	return false
}

func citedPage(first, last int, pages []cite.Range) int {
	for _, r := range pages {
		for p := r.From; p <= r.To; p++ {
			if p >= first && p <= last {
				return p
			}
		}
	}
	return first
}

func pagePhrase(pages []cite.Range) string {
	parts := make([]string, len(pages))
	for i, r := range pages {
		parts[i] = r.String()
	}
	return strings.Join(parts, ", ")
}

func pubLabel(c cite.Citation) string {
	s := c.Symbol
	if c.Year != 0 {
		s += fmt.Sprintf(" %d", c.Year)
		if c.Month != 0 {
			s += fmt.Sprintf("-%02d", c.Month)
		}
		if c.Day != 0 {
			s += fmt.Sprintf("-%02d", c.Day)
		}
	}
	return s
}

func wrongPage(n, first, last int, cited []cite.Range) error {
	where := fmt.Sprintf("p. %d", first)
	if last > first {
		where = fmt.Sprintf("pp. %d-%d", first, last)
	}
	return &ResolveError{
		Result: "wrong_page",
		msg:    fmt.Sprintf("par. %d is on %s, not p. %s", n, where, pagePhrase(cited)),
	}
}

func (l *Library) logResolve(citation string, hits []Hit, err error) {
	if err == nil {
		l.log.Info("citation", "result", "ok", "citation", citation, "hits", len(hits))
		return
	}
	result := "error"
	var re *ResolveError
	if errors.As(err, &re) {
		result = re.Result
	}
	if re != nil && re.Err != nil {
		l.log.Error("citation", "result", result, "citation", citation, "err", err, "detail", re.Err)
		return
	}
	l.log.Error("citation", "result", result, "citation", citation, "err", err)
}

func scriptureLabel(c cite.Citation) string {
	if len(c.Spans) == 0 {
		return cite.BookName(c.Book)
	}
	sp := c.Spans[0]
	if len(sp.Verses) == 0 {
		return fmt.Sprintf("%s %d", cite.BookName(c.Book), sp.Chapter)
	}
	return fmt.Sprintf("%s %d:%s", cite.BookName(c.Book), sp.Chapter, sp.Verses[0])
}
