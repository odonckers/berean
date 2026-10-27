package read

import (
	"fmt"
	"strings"

	"github.com/odonckers/berean/internal/cite"
	"github.com/odonckers/berean/internal/jwpub"
	"github.com/odonckers/berean/internal/library"
)

const (
	kindPublication = "publication"
	kindBible       = "bible"
	kindNote        = "note"
)

// Clip is one passage sitting on the canvas. It is plain data, the shape a
// later change can store: where it came from, the text, the citation, and
// its place on the canvas. Nothing here is view state.
type Clip struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"` // "publication", "bible", or "note"
	Citation string `json:"citation"`
	Text     string `json:"text"`
	// Markdown is the note, with citations stored as jwcite: links.
	Markdown string  `json:"markdown,omitempty"`
	X        float32 `json:"x"`
	Y        float32 `json:"y"`

	// Publication. PubID is the library row. DocID and PID are the document
	// and the paragraph index (data-pid). Paragraph is the printed number.
	PubID       int64  `json:"pub_id,omitempty"`
	Symbol      string `json:"symbol,omitempty"`
	Year        int    `json:"year,omitempty"`
	Month       int    `json:"month,omitempty"`
	Issue       int    `json:"issue,omitempty"`
	DocID       int    `json:"doc_id,omitempty"`
	PID         int    `json:"pid,omitempty"`
	PIDTo       int    `json:"pid_to,omitempty"`
	Page        int    `json:"page,omitempty"`
	Paragraph   int    `json:"paragraph,omitempty"`
	ParagraphTo int    `json:"paragraph_to,omitempty"`

	// Bible. BibleID is the translation the text was copied from.
	BibleID int64 `json:"bible_id,omitempty"`
	Book    int   `json:"book,omitempty"`
	Chapter int   `json:"chapter,omitempty"`
	Verse   int   `json:"verse,omitempty"`
	VerseTo int   `json:"verse_to,omitempty"`
}

// passage is what a pane drags onto the canvas. Drop reads it back.
type passage struct {
	Clip Clip
}

func publicationCitation(p library.PublicationInfo, page, parFrom, parTo int) string {
	sym := p.Symbol
	if p.Month > 0 {
		sym = fmt.Sprintf("%s.%02d", p.Symbol, p.Month)
	}
	if parFrom <= 0 {
		if page > 0 {
			return fmt.Sprintf("%s p. %d", sym, page)
		}
		if sym == "" {
			return p.Display()
		}
		return sym
	}
	if parTo > parFrom {
		return fmt.Sprintf("%s p. %d pars. %d-%d", sym, page, parFrom, parTo)
	}
	return fmt.Sprintf("%s p. %d par. %d", sym, page, parFrom)
}

// clipHeader is the card's citation line. A Bible clip names the
// translation, as "Gen. 3:1-5 (nwtsty)" or "Gen. 3:1-5 (nwt)".
func clipHeader(clip Clip) string {
	if clip.Kind == kindBible && clip.Symbol != "" {
		return clip.Citation + " (" + clip.Symbol + ")"
	}
	return clip.Citation
}

func scriptureCitation(book, chapter, from, to int) string {
	name := cite.BookName(book)
	if from <= 0 {
		return fmt.Sprintf("%s %d", name, chapter)
	}
	if to > from {
		return fmt.Sprintf("%s %d:%d-%d", name, chapter, from, to)
	}
	return fmt.Sprintf("%s %d:%d", name, chapter, from)
}

func (a *App) paragraphPassage(pub library.PublicationInfo, b block) passage {
	return passage{Clip: Clip{
		Kind:        kindPublication,
		Citation:    publicationCitation(pub, b.page, b.number, b.number),
		Text:        runText(b.runs),
		PubID:       pub.ID,
		Symbol:      pub.Symbol,
		Year:        pub.Year,
		Month:       pub.Month,
		Issue:       pub.Issue,
		DocID:       a.docID,
		PID:         b.index,
		PIDTo:       b.index,
		Page:        b.page,
		Paragraph:   b.number,
		ParagraphTo: b.number,
	}}
}

// versePassage copies verse, or the whole marked span when verse sits in one.
func (a *App) versePassage(cell verseCell, verse int) passage {
	from, to := verse, verse
	if lo, hi, ok := a.markedVerseSpan(); ok && verse >= lo && verse <= hi && hi > lo {
		from, to = lo, hi
	}
	var parts []string
	for _, line := range a.lines {
		if line.verse < from || line.verse > to {
			continue
		}
		for _, c := range line.cells {
			if c.pub.ID != cell.pub.ID || !c.present {
				continue
			}
			if s := runsToClip(c.runs); s != "" {
				parts = append(parts, fmt.Sprintf("%d %s", line.verse, s))
			}
		}
	}
	return passage{Clip: Clip{
		Kind:     kindBible,
		Citation: scriptureCitation(a.book, a.chapter, from, to),
		Text:     strings.Join(parts, "\n"),
		BibleID:  cell.pub.ID,
		Symbol:   cell.pub.Symbol,
		Year:     cell.pub.Year,
		Book:     a.book,
		Chapter:  a.chapter,
		Verse:    from,
		VerseTo:  to,
	}}
}

func duplicateTitle(title string, blocks []block) bool {
	if title == "" || len(blocks) == 0 || blocks[0].heading == 0 {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(title), strings.TrimSpace(runText(blocks[0].runs)))
}

func runText(runs []jwpub.Run) string {
	var b strings.Builder
	for _, r := range runs {
		b.WriteString(showRun(r))
	}
	return strings.TrimSpace(b.String())
}

func showRun(r jwpub.Run) string {
	if r.Break {
		return " "
	}
	if r.Sup {
		return superscript(r.Text)
	}
	return r.Text
}

// runsToClip keeps poetry lines. The reading pane joins a break as a space
// so a verse still reads as one sentence there.
func runsToClip(runs []jwpub.Run) string {
	var b strings.Builder
	for _, r := range runs {
		if r.Break {
			b.WriteByte('\n')
			continue
		}
		b.WriteString(showRun(r))
	}
	lines := strings.Split(b.String(), "\n")
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	return strings.Trim(strings.Join(lines, "\n"), "\n")
}

// superscript lifts a footnote marker. MyGo has no baseline shift, and these
// Unicode superscripts already sit above the line.
func superscript(s string) string {
	var b strings.Builder
	for _, r := range s {
		if m, ok := superscripts[r]; ok {
			b.WriteRune(m)
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

var superscripts = map[rune]rune{
	'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ',
	'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ',
	'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ',
	'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
	'A': 'ᵃ', 'B': 'ᵇ', 'C': 'ᶜ', 'D': 'ᵈ', 'E': 'ᵉ', 'F': 'ᶠ', 'G': 'ᵍ',
	'H': 'ʰ', 'I': 'ⁱ', 'J': 'ʲ', 'K': 'ᵏ', 'L': 'ˡ', 'M': 'ᵐ', 'N': 'ⁿ',
	'O': 'ᵒ', 'P': 'ᵖ', 'R': 'ʳ', 'S': 'ˢ', 'T': 'ᵗ', 'U': 'ᵘ', 'V': 'ᵛ',
	'W': 'ʷ', 'X': 'ˣ', 'Y': 'ʸ', 'Z': 'ᶻ',
	'0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶',
	'7': '⁷', '8': '⁸', '9': '⁹',
}
