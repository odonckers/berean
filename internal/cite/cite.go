// Package cite parses a study citation into a publication locator or a
// scripture reference.
package cite

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// Range is an inclusive span. From == To for a single number.
type Range struct{ From, To int }

func (r Range) String() string {
	if r.From == r.To {
		return strconv.Itoa(r.From)
	}
	return fmt.Sprintf("%d-%d", r.From, r.To)
}

// VerseSpan is one chapter and the verses cited in it.
// An empty Verses list means the whole chapter.
type VerseSpan struct {
	Chapter int
	Verses  []Range
}

// Kind is what a citation points at.
type Kind int

const (
	KindPub Kind = iota + 1
	KindBible
	KindStudyNote
)

// Citation is one parsed reference.
type Citation struct {
	Kind Kind

	// Publication.
	Symbol      string
	Year        int
	Month, Day  int
	Pages, Pars []Range
	UnitKind    string
	Unit        int

	// Scripture or study note.
	Book  int
	Spans []VerseSpan
}

func (c Citation) String() string {
	switch c.Kind {
	case KindBible, KindStudyNote:
		var parts []string
		for _, sp := range c.Spans {
			p := strconv.Itoa(sp.Chapter)
			if len(sp.Verses) > 0 {
				p += ":" + rangesStr(sp.Verses)
			}
			parts = append(parts, p)
		}
		s := fmt.Sprintf("bible[%d %s %s]", c.Book, BookName(c.Book), strings.Join(parts, "; "))
		if c.Kind == KindStudyNote {
			s = "studynote(" + s + ")"
		}
		return s
	}
	s := "pub[" + c.Symbol
	if c.Year != 0 {
		s += fmt.Sprintf(" %d", c.Year)
		if c.Month != 0 {
			s += fmt.Sprintf("-%02d", c.Month)
		}
		if c.Day != 0 {
			s += fmt.Sprintf("-%02d", c.Day)
		}
	}
	if c.UnitKind != "" {
		s += fmt.Sprintf(" %s %d", c.UnitKind, c.Unit)
	}
	if len(c.Pages) > 0 {
		s += " p." + rangesStr(c.Pages)
	}
	if len(c.Pars) > 0 {
		s += " par." + rangesStr(c.Pars)
	}
	return s + "]"
}

func rangesStr(rs []Range) string {
	var s []string
	for _, r := range rs {
		s = append(s, r.String())
	}
	return strings.Join(s, ", ")
}

type parser struct {
	s   []rune
	pos int
}

func (p *parser) ws() {
	for p.pos < len(p.s) && unicode.IsSpace(p.s[p.pos]) {
		p.pos++
	}
}

func (p *parser) eof() bool {
	p.ws()
	return p.pos >= len(p.s)
}

func (p *parser) startsNumber() bool {
	save := p.pos
	p.ws()
	ok := p.pos < len(p.s) && unicode.IsDigit(p.s[p.pos])
	p.pos = save
	return ok
}

// lit consumes a case-insensitive literal. On failure the position is unchanged.
func (p *parser) lit(l string) bool {
	save := p.pos
	p.ws()
	r := []rune(l)
	if p.pos+len(r) <= len(p.s) && strings.EqualFold(string(p.s[p.pos:p.pos+len(r)]), l) {
		p.pos += len(r)
		return true
	}
	p.pos = save
	return false
}

func (p *parser) num() (int, bool) {
	save := p.pos
	p.ws()
	st := p.pos
	for p.pos < len(p.s) && unicode.IsDigit(p.s[p.pos]) {
		p.pos++
	}
	if st == p.pos {
		p.pos = save
		return 0, false
	}
	n, _ := strconv.Atoi(string(p.s[st:p.pos]))
	return n, true
}

func (p *parser) errf(f string, a ...any) error {
	rest := ""
	if p.pos < len(p.s) {
		rest = string(p.s[p.pos:])
	}
	return fmt.Errorf("at %d (%q): %s", p.pos, rest, fmt.Sprintf(f, a...))
}

// rangeList parses "3", "4-7", "4–7", or "19, 20".
func (p *parser) rangeList() ([]Range, error) {
	var out []Range
	for {
		a, ok := p.num()
		if !ok {
			if len(out) == 0 {
				return nil, p.errf("expected number")
			}
			return out, nil
		}
		r := Range{From: a, To: a}
		if p.lit("-") || p.lit("–") {
			b, ok := p.num()
			if !ok || b < a {
				return nil, p.errf("bad range end")
			}
			r.To = b
		}
		out = append(out, r)
		save := p.pos
		if !p.lit(",") || !p.startsNumber() {
			p.pos = save
			return out, nil
		}
	}
}

// Parse parses one citation. Trailing text is an error.
func Parse(in string) (Citation, error) {
	p := &parser{s: []rune(strings.TrimSpace(in))}
	var c Citation
	var err error
	switch {
	case p.lit("nwtsty study note on") || p.lit("study note on"):
		c, err = p.bible()
		c.Kind = KindStudyNote
	case p.lit("nwtsty "):
		c, err = p.bible()
		if err == nil && !(p.lit("note") || p.lit("study note")) {
			err = p.errf(`expected "note" after nwtsty verse`)
		}
		c.Kind = KindStudyNote
	default:
		save := p.pos
		c, err = p.bible()
		if err != nil {
			p.pos = save
			c, err = p.pub()
		}
	}
	if err != nil {
		return Citation{}, err
	}
	if !p.eof() {
		return Citation{}, p.errf("trailing input")
	}
	return c, nil
}

func (p *parser) bible() (Citation, error) {
	p.ws()
	best, bestEnd := 0, 0
	limit := p.pos + 32
	if limit > len(p.s) {
		limit = len(p.s)
	}
	for end := p.pos + 1; end <= limit; end++ {
		n, ok := bookByKey[normKey(string(p.s[p.pos:end]))]
		if !ok {
			continue
		}
		if end == len(p.s) || unicode.IsSpace(p.s[end]) || p.s[end] == '.' || unicode.IsDigit(p.s[end]) {
			best, bestEnd = n, end
		}
	}
	if best == 0 {
		return Citation{}, p.errf("unknown book")
	}
	p.pos = bestEnd
	p.lit(".")
	c := Citation{Kind: KindBible, Book: best}
	for {
		ch, ok := p.num()
		if !ok {
			return Citation{}, p.errf("expected chapter")
		}
		sp := VerseSpan{Chapter: ch}
		if p.lit(":") {
			vs, err := p.rangeList()
			if err != nil {
				return Citation{}, err
			}
			sp.Verses = vs
		}
		if len(sp.Verses) == 0 && singleChapter[best] {
			sp = VerseSpan{Chapter: 1, Verses: []Range{{From: ch, To: ch}}}
		}
		c.Spans = append(c.Spans, sp)
		save := p.pos
		if !p.lit(";") || !p.startsNumber() {
			p.pos = save
			break
		}
	}
	return c, nil
}

func (p *parser) pub() (Citation, error) {
	sym, ok := p.symbol()
	if !ok {
		return Citation{}, p.errf("expected publication symbol")
	}
	c := Citation{Kind: KindPub, Symbol: sym}
	if err := p.issue(&c); err != nil {
		return Citation{}, err
	}
	for !p.eof() {
		switch {
		case p.lit("pp.") || p.lit("p."):
			rs, err := p.rangeList()
			if err != nil {
				return Citation{}, err
			}
			c.Pages = rs
		case p.lit("pars.") || p.lit("par."):
			rs, err := p.rangeList()
			if err != nil {
				return Citation{}, err
			}
			c.Pars = rs
		case p.unit(&c):
		default:
			if len(c.Pages) == 0 && len(c.Pars) == 0 && p.startsNumber() {
				rs, err := p.rangeList()
				if err != nil {
					return Citation{}, err
				}
				c.Pages = rs
				continue
			}
			return c, nil
		}
		p.lit(",")
	}
	return c, nil
}

func (p *parser) symbol() (string, bool) {
	p.ws()
	st := p.pos
	if p.pos >= len(p.s) || !unicode.IsLetter(p.s[p.pos]) {
		return "", false
	}
	for p.pos < len(p.s) && unicode.IsLetter(p.s[p.pos]) {
		p.pos++
	}
	if p.pos < len(p.s) && p.s[p.pos] == '-' {
		if p.pos+1 < len(p.s) && unicode.IsDigit(p.s[p.pos+1]) {
			p.pos++
			for p.pos < len(p.s) && unicode.IsDigit(p.s[p.pos]) {
				p.pos++
			}
		}
	}
	if p.pos == st {
		return "", false
	}
	return strings.ToLower(string(p.s[st:p.pos])), true
}

// issue reads a year glued to the symbol, then ".MM" or " M/D".
func (p *parser) issue(c *Citation) error {
	if p.pos >= len(p.s) || !unicode.IsDigit(p.s[p.pos]) {
		return nil
	}
	save := p.pos
	y, ok := p.num()
	if !ok || p.pos-save != 2 {
		p.pos = save
		return nil
	}
	c.Year = expandYear(y)
	if p.pos < len(p.s) && p.s[p.pos] == '.' {
		p.pos++
		m, ok := p.num()
		if !ok || m < 1 || m > 12 {
			return p.errf("bad month")
		}
		c.Month = m
		return nil
	}
	save = p.pos
	m, ok := p.num()
	if ok && p.lit("/") {
		d, ok := p.num()
		if !ok || m < 1 || m > 12 || d < 1 || d > 31 {
			return p.errf("bad month/day")
		}
		c.Month, c.Day = m, d
		return nil
	}
	p.pos = save
	return nil
}

func (p *parser) unit(c *Citation) bool {
	for _, k := range []string{"chapter", "chap.", "lesson", "section", "story", "study", "box", "article"} {
		save := p.pos
		if p.lit(k) {
			if n, ok := p.num(); ok {
				c.UnitKind, c.Unit = k, n
				return true
			}
			p.pos = save
		}
	}
	return false
}

func expandYear(y int) int {
	if y >= 50 {
		return 1900 + y
	}
	return 2000 + y
}
