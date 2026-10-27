package library

import (
	"context"
	"database/sql"
)

// PublicationInfo is one stored publication, for the reading panes.
type PublicationInfo struct {
	ID                       int64
	Symbol, CiteSymbol       string
	Title, Short, IssueTitle string
	Year, Issue, Month, Day  int
	Type                     string
}

// Display is the name a person would recognize, with the file symbol.
func (p PublicationInfo) Display() string {
	name := p.IssueTitle
	if name == "" {
		name = p.Title
	}
	if name == "" {
		name = p.Symbol
	}
	return name
}

// DocInfo is one document in a publication.
type DocInfo struct {
	ID     int
	MepsID int
	Title  string
}

// Para is one stored paragraph, plain text and readable markup.
type Para struct {
	Index, Ordinal      int
	Number              int
	Numbered            bool
	FirstPage, LastPage int
	Text, Markup        string
}

// VerseText is one stored verse.
type VerseText struct {
	Verse        int
	Text, Markup string
}

// Publications lists every publication in citation language, English.
func (l *Library) Publications(ctx context.Context) ([]PublicationInfo, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rows, err := l.db.QueryContext(ctx, `
		SELECT id, symbol, cite_symbol, year, issue_tag, month, day,
		       title, short_title, issue_title, pub_type
		FROM publication
		WHERE meps_language = ?
		ORDER BY pub_type, symbol, year, issue_tag`, resolveLanguage)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PublicationInfo
	for rows.Next() {
		var p PublicationInfo
		if err := rows.Scan(&p.ID, &p.Symbol, &p.CiteSymbol, &p.Year, &p.Issue, &p.Month, &p.Day,
			&p.Title, &p.Short, &p.IssueTitle, &p.Type); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Documents lists the documents of one publication, in file order.
func (l *Library) Documents(ctx context.Context, pubID int64) ([]DocInfo, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.documents(ctx, pubID)
}

func (l *Library) documents(ctx context.Context, pubID int64) ([]DocInfo, error) {
	rows, err := l.db.QueryContext(ctx, `
		SELECT document_id, meps_document_id, title
		FROM document
		WHERE publication_id = ?
		ORDER BY document_id`, pubID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocInfo
	for rows.Next() {
		var d DocInfo
		if err := rows.Scan(&d.ID, &d.MepsID, &d.Title); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Paragraphs returns every paragraph of one document, in reading order.
func (l *Library) Paragraphs(ctx context.Context, pubID int64, docID int) ([]Para, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rows, err := l.db.QueryContext(ctx, `
		SELECT paragraph_index, ordinal, paragraph_number, first_page, last_page, text, markup
		FROM paragraph
		WHERE publication_id = ? AND document_id = ?
		ORDER BY paragraph_index, ordinal`, pubID, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Para
	for rows.Next() {
		var p Para
		var num sql.NullInt64
		if err := rows.Scan(&p.Index, &p.Ordinal, &num, &p.FirstPage, &p.LastPage, &p.Text, &p.Markup); err != nil {
			return nil, err
		}
		if num.Valid {
			p.Numbered = true
			p.Number = int(num.Int64)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ChapterVerses returns the verses of one chapter in one publication.
func (l *Library) ChapterVerses(ctx context.Context, pubID int64, book, chapter int) ([]VerseText, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rows, err := l.db.QueryContext(ctx, `
		SELECT verse, text, markup
		FROM verse
		WHERE publication_id = ? AND book = ? AND chapter = ?
		ORDER BY verse`, pubID, book, chapter)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VerseText
	for rows.Next() {
		var v VerseText
		if err := rows.Scan(&v.Verse, &v.Text, &v.Markup); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// MaxChapter is the last chapter stored for a book in one publication.
// It is 0 when that publication has no verses for the book.
func (l *Library) MaxChapter(ctx context.Context, pubID int64, book int) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var n int
	err := l.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(chapter), 0)
		FROM verse
		WHERE publication_id = ? AND book = ?`, pubID, book).Scan(&n)
	return n, err
}
