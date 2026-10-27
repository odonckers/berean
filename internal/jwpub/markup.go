package jwpub

import (
	"encoding/json"
	"strings"
	"unicode"

	"golang.org/x/net/html"
)

// Run is one styled span of a paragraph or verse.
// Href is set when the span is a link, usually a jwpub:// reference.
// Sup is a footnote marker (class fn) or a superscript, drawn above the line.
// Break is a line break. Bible poetry uses one so a clip can keep the lines.
type Run struct {
	Text   string `json:"t,omitempty"`
	Bold   bool   `json:"b,omitempty"`
	Italic bool   `json:"i,omitempty"`
	Href   string `json:"href,omitempty"`
	Sup    bool   `json:"s,omitempty"`
	Break  bool   `json:"br,omitempty"`
}

// Mark is the readable form of a paragraph or verse: an optional heading
// level and the styled runs. The plain citation text stays separate.
type Mark struct {
	Heading int   `json:"h,omitempty"`
	Runs    []Run `json:"r,omitempty"`
}

// EncodeMark serializes a mark. An empty mark is an empty string.
func EncodeMark(m Mark) string {
	if m.Heading == 0 && len(m.Runs) == 0 {
		return ""
	}
	b, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	return string(b)
}

// DecodeMark parses a mark produced by EncodeMark.
// An empty string is an empty mark.
func DecodeMark(s string) (Mark, error) {
	if s == "" {
		return Mark{}, nil
	}
	var m Mark
	err := json.Unmarshal([]byte(s), &m)
	return m, err
}

// markupNode is the mark for a data-pid element. The printed paragraph
// number (class parNum) and page markers are left out; the number is stored
// on the paragraph itself.
func markupNode(n *html.Node) string {
	m := markFrom(n, true)
	return EncodeMark(m)
}

// markupFragment is the mark for a verse or other HTML snippet.
func markupFragment(src string) string {
	if strings.TrimSpace(src) == "" {
		return ""
	}
	doc, err := html.Parse(strings.NewReader(src))
	if err != nil {
		return ""
	}
	return EncodeMark(markFrom(doc, false))
}

type runStyle struct {
	bold, italic bool
	href         string
	sup          bool
}

type marker struct {
	heading int
	runs    []Run
	gap     bool // a space is owed before the next word
	any     bool
}

func markFrom(n *html.Node, root bool) Mark {
	var m marker
	m.walk(n, runStyle{}, root)
	m.trim()
	return Mark{Heading: m.heading, Runs: m.runs}
}

func (m *marker) walk(n *html.Node, st runStyle, root bool) {
	if n.Type == html.TextNode {
		m.write(n.Data, st)
		return
	}
	if n.Type != html.ElementNode {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			m.walk(c, st, false)
		}
		return
	}
	if hasClass(n, "pageNum") || hasClass(n, "parNum") || hasClass(n, "tt") {
		return
	}
	if root {
		m.heading = headingLevel(n)
	}
	if blockTag(n.Data) && m.any {
		m.addBreak()
	}
	switch n.Data {
	case "em", "i":
		st.italic = true
	case "strong", "b":
		st.bold = true
	case "a":
		if href, ok := attr(n, "href"); ok {
			st.href = href
		}
	case "br":
		m.addBreak()
		return
	}
	if hasClass(n, "em") {
		st.italic = true
	}
	// class fn is a footnote marker ("b"); fn-symbol is that letter in the
	// note itself. The paragraph number's sup lives inside parNum, already
	// skipped, so a remaining sup is a real superscript.
	if n.Data == "sup" || hasClass(n, "fn") || hasClass(n, "fn-symbol") {
		st.sup = true
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		m.walk(c, st, false)
	}
}

func headingLevel(n *html.Node) int {
	switch n.Data {
	case "h1":
		return 1
	case "h2":
		return 2
	case "h3":
		return 3
	case "h4":
		return 4
	case "h5":
		return 5
	case "h6":
		return 6
	default:
		return 0
	}
}

func (m *marker) write(s string, st runStyle) {
	if s == "" {
		return
	}
	s = strings.ReplaceAll(s, "\u00a0", " ")
	s = strings.ReplaceAll(s, "\u2009", " ")
	var b strings.Builder
	for _, r := range s {
		if unicode.IsSpace(r) {
			b.WriteByte(' ')
		} else {
			b.WriteRune(r)
		}
	}
	s = b.String()
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	if strings.TrimSpace(s) == "" {
		if m.any {
			m.gap = true
		}
		return
	}
	lead := strings.HasPrefix(s, " ") || m.gap
	trail := strings.HasSuffix(s, " ")
	s = strings.TrimSpace(s)
	if lead && m.any {
		m.addSpace()
	}
	m.add(s, st)
	m.gap = trail
	m.any = true
}

func (m *marker) addSpace() {
	if len(m.runs) == 0 {
		return
	}
	last := &m.runs[len(m.runs)-1]
	if !strings.HasSuffix(last.Text, " ") {
		last.Text += " "
	}
	m.gap = false
}

func (m *marker) addBreak() {
	if !m.any {
		return
	}
	if n := len(m.runs); n > 0 && m.runs[n-1].Break {
		return
	}
	m.runs = append(m.runs, Run{Break: true})
	m.gap = false
	m.any = true
}

func blockTag(tag string) bool {
	switch tag {
	case "p", "div", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6":
		return true
	default:
		return false
	}
}

func (m *marker) add(text string, st runStyle) {
	if text == "" {
		return
	}
	if n := len(m.runs); n > 0 {
		last := &m.runs[n-1]
		if !last.Break && last.Bold == st.bold && last.Italic == st.italic && last.Href == st.href && last.Sup == st.sup {
			last.Text += text
			return
		}
	}
	m.runs = append(m.runs, Run{Text: text, Bold: st.bold, Italic: st.italic, Href: st.href, Sup: st.sup})
}

func (m *marker) trim() {
	for len(m.runs) > 0 && m.runs[len(m.runs)-1].Break {
		m.runs = m.runs[:len(m.runs)-1]
	}
	if len(m.runs) == 0 {
		return
	}
	last := &m.runs[len(m.runs)-1]
	last.Text = strings.TrimRightFunc(last.Text, unicode.IsSpace)
	if last.Text == "" {
		m.runs = m.runs[:len(m.runs)-1]
	}
}
