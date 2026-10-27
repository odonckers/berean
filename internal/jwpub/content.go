package jwpub

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// Document is one document and the paragraphs decrypted from its HTML.
type Document struct {
	ID             int
	MepsDocumentID int
	Title          string
	FirstPage      int
	LastPage       int
	HasPages       bool
	Paragraphs     []Paragraph
}

// Verse is one scripture verse already mapped to book, chapter, and verse.
// Verse 0 is a superscription, such as a psalm heading.
// Text is plain. Markup keeps emphasis when the verse has any.
type Verse struct {
	Book, Chapter, Verse int
	Text                 string
	Markup               string
}

// StudyNote is the study-note text for one verse.
type StudyNote struct {
	Book, Chapter, Verse int
	Label                string
	Text                 string
}

// CrossRef is one marginal cross-reference, in book/chapter/verse form.
type CrossRef struct {
	Book, Chapter, Verse                            int
	TargetBook, TargetChapter, TargetVerse          int
	TargetEndBook, TargetEndChapter, TargetEndVerse int
	Block, Element                                  int
}

// DocumentVolumes reports which volume each document belongs to, for the
// Insight publication that holds both volumes. The table of contents names
// "Volume 1" and "Volume 2" and points those headings at the endsheets that
// bracket each volume. Documents are stored in reading order, so a document
// id between those ends belongs to that volume. The map is empty when this
// file does not say, including every publication other than it.
func (p *Publication) DocumentVolumes(ctx context.Context) (map[int]int, error) {
	if p.meta.Symbol != "it" && p.meta.CiteSymbol != "it" {
		return nil, nil
	}
	var n int
	if err := p.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='PublicationViewItem'`).Scan(&n); err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, nil
	}
	rows, err := p.db.QueryContext(ctx, `
		SELECT PublicationViewItemId, ParentPublicationViewItemId, COALESCE(Title, ''), DefaultDocumentId
		FROM PublicationViewItem`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type item struct {
		parent, doc int
		title       string
	}
	items := map[int]item{}
	children := map[int][]int{}
	for rows.Next() {
		var id, parent, doc int
		var title string
		if err := rows.Scan(&id, &parent, &title, &doc); err != nil {
			return nil, err
		}
		items[id] = item{parent: parent, doc: doc, title: title}
		children[parent] = append(children[parent], id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	byVol := map[int][]int{}
	var walk func(int, *[]int)
	walk = func(id int, out *[]int) {
		it := items[id]
		if it.doc >= 0 {
			*out = append(*out, it.doc)
		}
		for _, child := range children[id] {
			walk(child, out)
		}
	}
	for id, it := range items {
		vol, ok := insightVolumeTitle(it.title)
		if !ok {
			continue
		}
		var docs []int
		walk(id, &docs)
		byVol[vol] = append(byVol[vol], docs...)
	}
	type span struct{ vol, min, max int }
	var spans []span
	for vol, ids := range byVol {
		if len(ids) == 0 {
			continue
		}
		min, max := ids[0], ids[0]
		for _, id := range ids {
			if id < min {
				min = id
			}
			if id > max {
				max = id
			}
		}
		spans = append(spans, span{vol, min, max})
	}
	for i := range spans {
		for j := i + 1; j < len(spans); j++ {
			if spans[i].min <= spans[j].max && spans[j].min <= spans[i].max {
				return nil, nil
			}
		}
	}
	if len(spans) == 0 {
		return nil, nil
	}
	idRows, err := p.db.QueryContext(ctx, `SELECT DocumentId FROM Document`)
	if err != nil {
		return nil, err
	}
	defer idRows.Close()
	out := map[int]int{}
	for idRows.Next() {
		var id int
		if err := idRows.Scan(&id); err != nil {
			return nil, err
		}
		vol, n := 0, 0
		for _, s := range spans {
			if id >= s.min && id <= s.max {
				vol = s.vol
				n++
			}
		}
		if n == 1 {
			out[id] = vol
		}
	}
	return out, idRows.Err()
}

func insightVolumeTitle(title string) (int, bool) {
	switch strings.ToLower(strings.TrimSpace(title)) {
	case "volume 1":
		return 1, true
	case "volume 2":
		return 2, true
	default:
		return 0, false
	}
}

// ForEachDocument decrypts every document and calls fn with its paragraphs.
func (p *Publication) ForEachDocument(ctx context.Context, fn func(Document) error) error {
	numbers, err := p.paragraphNumbers(ctx)
	if err != nil {
		return err
	}
	rows, err := p.db.QueryContext(ctx, `
		SELECT DocumentId, MepsDocumentId, COALESCE(Title, ''),
		       FirstPageNumber, LastPageNumber, Content
		FROM Document
		ORDER BY DocumentId`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := ctx.Err(); err != nil {
			return err
		}
		var (
			d           Document
			first, last sql.NullInt64
			blob        []byte
		)
		if err := rows.Scan(&d.ID, &d.MepsDocumentID, &d.Title, &first, &last, &blob); err != nil {
			return err
		}
		if first.Valid && last.Valid {
			d.HasPages = true
			d.FirstPage = int(first.Int64)
			d.LastPage = int(last.Int64)
		}
		if len(blob) > 0 {
			html, err := p.decrypt(blob)
			if err != nil {
				return fmt.Errorf("decrypt document %d: %w", d.MepsDocumentID, err)
			}
			paras, err := paragraphsFromHTML(html)
			if err != nil {
				return fmt.Errorf("document %d: %w", d.MepsDocumentID, err)
			}
			for i := range paras {
				if n, ok := numbers[[2]int{d.ID, paras[i].Index}]; ok {
					paras[i].Number = n
					paras[i].Numbered = true
				}
			}
			// Insight stores no paragraph labels. The Research Guide counts
			// the body paragraphs (class sb), skipping the title, subheadings,
			// and captions.
			if p.meta.Symbol == "it" || p.meta.CiteSymbol == "it" {
				numberInsightParagraphs(paras)
			}
			d.Paragraphs = paras
		}
		if err := fn(d); err != nil {
			return err
		}
	}
	return rows.Err()
}

func numberInsightParagraphs(paras []Paragraph) {
	n := 0
	for i := range paras {
		if paras[i].Numbered || !paras[i].body {
			continue
		}
		n++
		paras[i].Number = n
		paras[i].Numbered = true
	}
}

func (p *Publication) paragraphNumbers(ctx context.Context) (map[[2]int]int, error) {
	rows, err := p.db.QueryContext(ctx, `
		SELECT DocumentId, ParagraphIndex, ParagraphNumberLabel
		FROM DocumentParagraph
		WHERE ParagraphNumberLabel IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[[2]int]int{}
	for rows.Next() {
		var doc, idx, n int
		if err := rows.Scan(&doc, &idx, &n); err != nil {
			return nil, err
		}
		out[[2]int{doc, idx}] = n
	}
	return out, rows.Err()
}

// ForEachVerse maps each Bible verse id through this file's chapter table and
// calls fn with book, chapter, and verse. It does nothing for a non-Bible.
func (p *Publication) ForEachVerse(ctx context.Context, fn func(Verse) error) error {
	locs, err := p.locations(ctx)
	if err != nil || locs == nil {
		return err
	}
	rows, err := p.db.QueryContext(ctx, `SELECT BibleVerseId, Content FROM BibleVerse ORDER BY BibleVerseId`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := ctx.Err(); err != nil {
			return err
		}
		var id int
		var blob []byte
		if err := rows.Scan(&id, &blob); err != nil {
			return err
		}
		loc, ok := locs[id]
		if !ok {
			return fmt.Errorf("bible verse id %d is outside every chapter", id)
		}
		text, err := p.decrypt(blob)
		if err != nil {
			return fmt.Errorf("decrypt %d:%d:%d: %w", loc.Book, loc.Chapter, loc.Verse, err)
		}
		plain, err := plainHTML(text)
		if err != nil {
			return err
		}
		if err := fn(Verse{Book: loc.Book, Chapter: loc.Chapter, Verse: loc.Verse, Text: plain, Markup: markupFragment(text)}); err != nil {
			return err
		}
	}
	return rows.Err()
}

// ForEachStudyNote decrypts study notes and reports them by book, chapter, and verse.
func (p *Publication) ForEachStudyNote(ctx context.Context, fn func(StudyNote) error) error {
	locs, err := p.locations(ctx)
	if err != nil || locs == nil {
		return err
	}
	rows, err := p.db.QueryContext(ctx, `
		SELECT m.BibleVerseId, COALESCE(vc.Label, ''), vc.Content
		FROM VerseCommentaryMap m
		JOIN VerseCommentary vc ON vc.VerseCommentaryId = m.VerseCommentaryId
		ORDER BY m.BibleVerseId`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := ctx.Err(); err != nil {
			return err
		}
		var id int
		var label string
		var blob []byte
		if err := rows.Scan(&id, &label, &blob); err != nil {
			return err
		}
		loc, ok := locs[id]
		if !ok {
			return fmt.Errorf("study note verse id %d is outside every chapter", id)
		}
		text, err := p.decrypt(blob)
		if err != nil {
			return fmt.Errorf("decrypt study note %d:%d:%d: %w", loc.Book, loc.Chapter, loc.Verse, err)
		}
		plain, err := plainHTML(text)
		if err != nil {
			return err
		}
		labelPlain := label
		if strings.TrimSpace(label) != "" {
			labelPlain, err = plainHTML(label)
			if err != nil {
				return err
			}
		}
		if err := fn(StudyNote{
			Book: loc.Book, Chapter: loc.Chapter, Verse: loc.Verse,
			Label: labelPlain, Text: plain,
		}); err != nil {
			return err
		}
	}
	return rows.Err()
}

// ForEachCrossRef maps marginal cross-references to book, chapter, and verse.
// A null source verse is a citation inside a document, not a marginal reference,
// and is skipped. Verse id 0 is Genesis 1:1 in these files, so it is kept.
func (p *Publication) ForEachCrossRef(ctx context.Context, fn func(CrossRef) error) error {
	locs, err := p.locations(ctx)
	if err != nil || locs == nil {
		return err
	}
	rows, err := p.db.QueryContext(ctx, `
		SELECT BibleVerseId, FirstBibleVerseId, LastBibleVerseId,
		       COALESCE(BlockNumber, 0), COALESCE(ElementNumber, 0)
		FROM BibleCitation
		WHERE BibleVerseId IS NOT NULL
		ORDER BY BibleVerseId, ElementNumber`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := ctx.Err(); err != nil {
			return err
		}
		var src, first, last, block, elem int
		if err := rows.Scan(&src, &first, &last, &block, &elem); err != nil {
			return err
		}
		from, ok1 := locs[src]
		a, ok2 := locs[first]
		b, ok3 := locs[last]
		if !ok1 || !ok2 || !ok3 {
			return fmt.Errorf("cross-reference %d:%d-%d does not land on a verse", src, first, last)
		}
		if err := fn(CrossRef{
			Book: from.Book, Chapter: from.Chapter, Verse: from.Verse,
			TargetBook: a.Book, TargetChapter: a.Chapter, TargetVerse: a.Verse,
			TargetEndBook: b.Book, TargetEndChapter: b.Chapter, TargetEndVerse: b.Verse,
			Block: block, Element: elem,
		}); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (p *Publication) locations(ctx context.Context) (map[int]verseLoc, error) {
	if !p.meta.Bible() {
		return nil, nil
	}
	if p.loc != nil {
		return p.loc, nil
	}
	rows, err := p.db.QueryContext(ctx, `
		SELECT c.BookNumber, c.ChapterNumber, v.BibleVerseId, COALESCE(v.Label, '')
		FROM BibleChapter c
		JOIN BibleVerse v ON v.BibleVerseId BETWEEN c.FirstVerseId AND c.LastVerseId
		ORDER BY v.BibleVerseId`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	locs := map[int]verseLoc{}
	seen := map[verseLoc]int{}
	for rows.Next() {
		var book, chapter, id int
		var label string
		if err := rows.Scan(&book, &chapter, &id, &label); err != nil {
			return nil, err
		}
		n, err := verseNumber(label)
		if err != nil {
			return nil, fmt.Errorf("book %d chapter %d verse id %d: %w", book, chapter, id, err)
		}
		loc := verseLoc{Book: book, Chapter: chapter, Verse: n}
		if prev, ok := seen[loc]; ok {
			return nil, fmt.Errorf("book %d chapter %d verse %d comes from both verse ids %d and %d", book, chapter, n, prev, id)
		}
		seen[loc] = id
		locs[id] = loc
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var total int
	if err := p.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM BibleVerse`).Scan(&total); err != nil {
		return nil, err
	}
	if total != len(locs) {
		return nil, fmt.Errorf("mapped %d verses but the file has %d", len(locs), total)
	}
	p.loc = locs
	return locs, nil
}
