package library

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/odonckers/berean/internal/cite"
)

// LinkKind is what a publication href resolves to.
type LinkKind int

const (
	// LinkBad is a href this library does not understand.
	LinkBad LinkKind = iota
	// LinkVerse is a scripture the Bible pane can open.
	LinkVerse
	// LinkDocument is an article already stored in the library.
	LinkDocument
	// LinkMissing is a publication link whose document is not imported.
	LinkMissing
	// LinkExternal is a web address, not a library document.
	LinkExternal
)

// LinkTarget is a Research Guide (or any publication) href, resolved.
type LinkTarget struct {
	Kind                          LinkKind
	Href                          string
	Book, Chapter, Verse          int
	EndBook, EndChapter, EndVerse int
	PubID                         int64
	Symbol                        string
	Year, Issue                   int
	DocumentID, MepsDocumentID    int
	Document, Publication         string
	ParFrom, ParTo                int
}

func (t LinkTarget) String() string {
	switch t.Kind {
	case LinkVerse:
		s := fmt.Sprintf("%s %d:%d", cite.BookTitle(t.Book), t.Chapter, t.Verse)
		if t.EndVerse != t.Verse || t.EndChapter != t.Chapter || t.EndBook != t.Book {
			if t.EndChapter == t.Chapter && t.EndBook == t.Book {
				s += fmt.Sprintf("-%d", t.EndVerse)
			} else {
				s += fmt.Sprintf("–%s %d:%d", cite.BookTitle(t.EndBook), t.EndChapter, t.EndVerse)
			}
		}
		return s
	case LinkDocument:
		s := fmt.Sprintf("%s (%s) %q", t.Publication, t.Symbol, t.Document)
		if t.ParFrom > 0 {
			s += fmt.Sprintf(" paragraphs %d-%d", t.ParFrom, t.ParTo)
		}
		return s
	case LinkMissing:
		s := fmt.Sprintf("meps document %d is not in the library", t.MepsDocumentID)
		if t.ParFrom > 0 {
			s += fmt.Sprintf(", paragraphs %d-%d", t.ParFrom, t.ParTo)
		}
		return s
	case LinkExternal:
		return "web link"
	default:
		return "unrecognized link"
	}
}

var (
	bibleHref = regexp.MustCompile(`^jwpub://b/[^/]+/(\d+):(\d+):(\d+)(?:-(\d+):(\d+):(\d+))?$`)
	pubHref   = regexp.MustCompile(`^(?:jwpub://)?p/[A-Za-z0-9]+:(\d+)(?:/(\d+)-(\d+))?/?$`)
	chapHref  = regexp.MustCompile(`^(?:jwpub://)?c/[A-Za-z0-9]+:(\d+)/(\d+):(\d+)$`)
)

// ResolveLink maps a document href onto a stored document or a verse.
// Bible hrefs carry book, chapter, and verse themselves. Publication hrefs
// carry a Meps document id and, sometimes, a paragraph-index range.
func (l *Library) ResolveLink(ctx context.Context, href string) (LinkTarget, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	href = strings.TrimSpace(href)
	t := LinkTarget{Href: href}
	switch {
	case strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://"):
		t.Kind = LinkExternal
		return t, nil
	case bibleHref.MatchString(href):
		return parseBibleHref(href), nil
	case chapHref.MatchString(href):
		return l.resolveChapterHref(ctx, href)
	case pubHref.MatchString(href):
		return l.resolvePubHref(ctx, href)
	default:
		t.Kind = LinkBad
		return t, fmt.Errorf("unrecognized link %q", href)
	}
}

func parseBibleHref(href string) LinkTarget {
	m := bibleHref.FindStringSubmatch(href)
	t := LinkTarget{Kind: LinkVerse, Href: href}
	t.Book, _ = strconv.Atoi(m[1])
	t.Chapter, _ = strconv.Atoi(m[2])
	t.Verse, _ = strconv.Atoi(m[3])
	if m[4] != "" {
		t.EndBook, _ = strconv.Atoi(m[4])
		t.EndChapter, _ = strconv.Atoi(m[5])
		t.EndVerse, _ = strconv.Atoi(m[6])
	} else {
		t.EndBook, t.EndChapter, t.EndVerse = t.Book, t.Chapter, t.Verse
	}
	return t
}

func (l *Library) resolveChapterHref(ctx context.Context, href string) (LinkTarget, error) {
	m := chapHref.FindStringSubmatch(href)
	meps, _ := strconv.Atoi(m[1])
	ch, _ := strconv.Atoi(m[2])
	vs, _ := strconv.Atoi(m[3])
	doc, err := l.docByMeps(ctx, meps)
	if err == sql.ErrNoRows {
		return LinkTarget{Kind: LinkMissing, Href: href, MepsDocumentID: meps, Chapter: ch, Verse: vs}, nil
	}
	if err != nil {
		return LinkTarget{}, err
	}
	if doc.pubType != "Bible" {
		return LinkTarget{Kind: LinkMissing, Href: href, MepsDocumentID: meps, Document: doc.docTitle}, nil
	}
	book, ok := cite.BookByName(doc.docTitle)
	if !ok {
		return LinkTarget{Kind: LinkBad, Href: href, MepsDocumentID: meps, Document: doc.docTitle}, fmt.Errorf("bible document %q is not a book", doc.docTitle)
	}
	return LinkTarget{
		Kind: LinkVerse, Href: href,
		Book: book, Chapter: ch, Verse: vs,
		EndBook: book, EndChapter: ch, EndVerse: vs,
		PubID: doc.pubID, Symbol: doc.symbol, Year: doc.year, Issue: doc.issue,
		DocumentID: doc.docID, MepsDocumentID: meps,
		Document: doc.docTitle, Publication: doc.pubTitle,
	}, nil
}

func (l *Library) resolvePubHref(ctx context.Context, href string) (LinkTarget, error) {
	m := pubHref.FindStringSubmatch(href)
	meps, _ := strconv.Atoi(m[1])
	t := LinkTarget{Kind: LinkMissing, Href: href, MepsDocumentID: meps}
	if m[2] != "" {
		t.ParFrom, _ = strconv.Atoi(m[2])
		t.ParTo, _ = strconv.Atoi(m[3])
	}
	doc, err := l.docByMeps(ctx, meps)
	if err == sql.ErrNoRows {
		return t, nil
	}
	if err != nil {
		return LinkTarget{}, err
	}
	t.Kind = LinkDocument
	t.PubID = doc.pubID
	t.Symbol = doc.symbol
	t.Year = doc.year
	t.Issue = doc.issue
	t.DocumentID = doc.docID
	t.Document = doc.docTitle
	t.Publication = doc.pubTitle
	return t, nil
}

type mepsDoc struct {
	pubID       int64
	symbol      string
	year, issue int
	pubTitle    string
	pubType     string
	docID       int
	docTitle    string
}

func (l *Library) docByMeps(ctx context.Context, meps int) (mepsDoc, error) {
	var d mepsDoc
	var issueTitle, title string
	err := l.db.QueryRowContext(ctx, `
		SELECT p.id, p.symbol, p.year, p.issue_tag, p.title, p.issue_title, p.pub_type,
		       d.document_id, d.title
		FROM document d
		JOIN publication p ON p.id = d.publication_id
		WHERE d.meps_document_id = ? AND p.meps_language = ?
		ORDER BY p.id
		LIMIT 1`, meps, resolveLanguage).Scan(
		&d.pubID, &d.symbol, &d.year, &d.issue, &title, &issueTitle, &d.pubType,
		&d.docID, &d.docTitle)
	if err != nil {
		return mepsDoc{}, err
	}
	d.pubTitle = displayTitle(issueTitle, title)
	return d, nil
}
