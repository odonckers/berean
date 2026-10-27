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
		return l.resolvePub(ctx, citation, c)
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

func (l *Library) resolvePub(ctx context.Context, citation string, c cite.Citation) ([]Hit, error) {
	pubs, err := l.pubsForCite(ctx, c)
	if err != nil {
		return nil, err
	}
	if len(pubs) == 0 {
		return nil, &ResolveError{Result: "missing_publication", msg: importHint(c)}
	}
	if c.Title != "" {
		return l.resolveTitle(ctx, citation, c, pubs)
	}
	vol := insightVolume(c.Symbol)
	if vol != 0 && len(c.Pages) > 0 {
		known, err := l.volumesKnown(ctx, pubs)
		if err != nil {
			return nil, err
		}
		if !known {
			return nil, fmt.Errorf("%s: the file does not say which volume this page is in", citation)
		}
		if len(c.Pars) == 0 {
			return l.resolveVolumePage(ctx, citation, c, pubs, vol)
		}
	}
	if len(c.Pages) == 0 || len(c.Pars) == 0 {
		return nil, fmt.Errorf("%s needs a page and a paragraph", pubLabel(c))
	}
	var hits []Hit
	err = eachNumber(c.Pars, func(n int) error {
		found := false
		var spans []pageSpan
		seen := map[[2]int]bool{}
		for _, pub := range pubs {
			rows, err := l.paragraphs(ctx, pub.ID, n, vol)
			if err != nil {
				return err
			}
			for _, row := range rows {
				key := [2]int{row.first, row.last}
				if !seen[key] {
					seen[key] = true
					spans = append(spans, pageSpan{row.first, row.last})
				}
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
			if len(spans) > 0 {
				return wrongPage(citation, n, spans, c.Pages)
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

func (l *Library) paragraphs(ctx context.Context, pubID int64, number, volume int) ([]paraRow, error) {
	q := `
		SELECT d.document_id, p.paragraph_index, d.title, p.text, p.first_page, p.last_page
		FROM paragraph p
		JOIN document d
		  ON d.publication_id = p.publication_id AND d.document_id = p.document_id
		WHERE p.publication_id=? AND p.paragraph_number=?`
	args := []any{pubID, number}
	if volume != 0 {
		q += ` AND d.volume=?`
		args = append(args, volume)
	}
	q += ` ORDER BY d.document_id, p.paragraph_index`
	rows, err := l.db.QueryContext(ctx, q, args...)
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

// pubsForCite matches cite_symbol. it-1 and it-2 fall back to the one Insight
// file, whose citation symbol is it, when no volume file is stored.
func (l *Library) pubsForCite(ctx context.Context, c cite.Citation) ([]pubRow, error) {
	pubs, err := l.queryCitePubs(ctx, c, c.Symbol)
	if err != nil || len(pubs) > 0 || insightVolume(c.Symbol) == 0 {
		return pubs, err
	}
	return l.queryCitePubs(ctx, c, "it")
}

func (l *Library) queryCitePubs(ctx context.Context, c cite.Citation, symbol string) ([]pubRow, error) {
	q := `SELECT id, symbol, title, issue_title, year, month, day
		FROM publication WHERE meps_language=? AND cite_symbol=?`
	args := []any{resolveLanguage, symbol}
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
	return l.queryPubs(ctx, q, args...)
}

func insightVolume(symbol string) int {
	switch symbol {
	case "it-1":
		return 1
	case "it-2":
		return 2
	default:
		return 0
	}
}

func (l *Library) volumesKnown(ctx context.Context, pubs []pubRow) (bool, error) {
	for _, pub := range pubs {
		var n int
		if err := l.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM document WHERE publication_id=? AND volume!=0`, pub.ID).Scan(&n); err != nil {
			return false, err
		}
		if n > 0 {
			return true, nil
		}
	}
	return false, nil
}

type docVol struct {
	id, volume, first, last int
	title                   string
	hasPages                bool
}

func (l *Library) docVolumes(ctx context.Context, pubID int64) ([]docVol, error) {
	rows, err := l.db.QueryContext(ctx, `
		SELECT document_id, title, volume, first_page, last_page
		FROM document WHERE publication_id=? ORDER BY document_id`, pubID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []docVol
	for rows.Next() {
		var d docVol
		var first, last sql.NullInt64
		if err := rows.Scan(&d.id, &d.title, &d.volume, &first, &last); err != nil {
			return nil, err
		}
		if first.Valid && last.Valid {
			d.hasPages = true
			d.first = int(first.Int64)
			d.last = int(last.Int64)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (l *Library) resolveTitle(ctx context.Context, citation string, c cite.Citation, pubs []pubRow) ([]Hit, error) {
	vol := insightVolume(c.Symbol)
	known, err := l.volumesKnown(ctx, pubs)
	if err != nil {
		return nil, err
	}
	want := normTitle(c.Title)
	var hits []Hit
	for _, pub := range pubs {
		docs, err := l.docVolumes(ctx, pub.ID)
		if err != nil {
			return nil, err
		}
		for _, d := range docs {
			if normTitle(d.title) != want {
				continue
			}
			if known && d.volume != vol {
				continue
			}
			hits = append(hits, docHit(pub, d, 0))
		}
	}
	if len(hits) == 1 {
		if len(c.Pars) == 0 {
			return hits, nil
		}
		return l.resolveTitleParagraphs(ctx, citation, c, hits[0])
	}
	if len(hits) == 0 {
		return nil, fmt.Errorf("%s was not found", citation)
	}
	return nil, fmt.Errorf("%s matches more than one article", citation)
}

func (l *Library) resolveTitleParagraphs(ctx context.Context, citation string, c cite.Citation, article Hit) ([]Hit, error) {
	var hits []Hit
	err := eachNumber(c.Pars, func(n int) error {
		rows, err := l.db.QueryContext(ctx, `
			SELECT paragraph_index, text, first_page
			FROM paragraph
			WHERE publication_id=? AND document_id=? AND paragraph_number=?
			ORDER BY paragraph_index, ordinal`, article.PubID, article.DocumentID, n)
		if err != nil {
			return err
		}
		defer rows.Close()
		found := false
		for rows.Next() {
			h := article
			if err := rows.Scan(&h.ParagraphIndex, &h.Text, &h.Page); err != nil {
				return err
			}
			h.Paragraph = n
			hits = append(hits, h)
			found = true
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("%s: par. %d was not found", citation, n)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return hits, nil
}

func (l *Library) resolveVolumePage(ctx context.Context, citation string, c cite.Citation, pubs []pubRow, vol int) ([]Hit, error) {
	var hits []Hit
	for _, pub := range pubs {
		docs, err := l.docVolumes(ctx, pub.ID)
		if err != nil {
			return nil, err
		}
		for _, d := range docs {
			if d.volume != vol || !d.hasPages || !overlaps(d.first, d.last, c.Pages) {
				continue
			}
			hits = append(hits, docHit(pub, d, citedPage(d.first, d.last, c.Pages)))
		}
	}
	if len(hits) == 0 {
		return nil, fmt.Errorf("%s was not found in volume %d", citation, vol)
	}
	return hits, nil
}

func docHit(pub pubRow, d docVol, page int) Hit {
	return Hit{
		Kind:        cite.KindPub,
		Publication: displayTitle(pub.IssueTitle, pub.Title),
		Symbol:      pub.Symbol,
		Document:    d.title,
		Text:        d.title,
		Year:        pub.Year,
		Month:       pub.Month,
		Day:         pub.Day,
		Page:        page,
		PubID:       pub.ID,
		DocumentID:  d.id,
	}
}

func normTitle(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Map(func(r rune) rune {
		switch r {
		case '\'', '’', '‘', 'ʼ':
			return '\''
		default:
			return r
		}
	}, s)
	return strings.ToLower(s)
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

type pageSpan struct{ first, last int }

func wrongPage(citation string, n int, spans []pageSpan, cited []cite.Range) error {
	return &ResolveError{
		Result: "wrong_page",
		msg:    fmt.Sprintf("%s: par. %d is on %s, not p. %s", citation, n, formatSpans(spans), pagePhrase(cited)),
	}
}

// formatSpans lists every page span of a paragraph. One span stays "p. 2"
// or "pp. 3-4". Several spans read "pp. 2, 8-9, and 14-15".
func formatSpans(spans []pageSpan) string {
	if len(spans) == 1 {
		return oneSpan(spans[0], true)
	}
	parts := make([]string, len(spans))
	for i, s := range spans {
		parts[i] = oneSpan(s, false)
	}
	return "pp. " + joinAnd(parts)
}

func oneSpan(s pageSpan, label bool) string {
	if s.last > s.first {
		if label {
			return fmt.Sprintf("pp. %d-%d", s.first, s.last)
		}
		return fmt.Sprintf("%d-%d", s.first, s.last)
	}
	if label {
		return fmt.Sprintf("p. %d", s.first)
	}
	return fmt.Sprintf("%d", s.first)
}

func joinAnd(parts []string) string {
	switch len(parts) {
	case 0:
		return ""
	case 1:
		return parts[0]
	case 2:
		return parts[0] + " and " + parts[1]
	default:
		return strings.Join(parts[:len(parts)-1], ", ") + ", and " + parts[len(parts)-1]
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
