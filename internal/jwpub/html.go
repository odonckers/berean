package jwpub

import (
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// Paragraph is one data-pid block of a document, with the printed page span.
// Text is the plain citation text, including the paragraph number when the
// publication prints one. Markup is the readable form: headings, emphasis,
// and links, without the paragraph-number span.
type Paragraph struct {
	Index     int
	Number    int
	Numbered  bool
	FirstPage int
	LastPage  int
	Text      string
	Markup    string
	// body is an Insight paragraph the Research Guide numbers: a class "sb"
	// paragraph, or an unclassed body paragraph. pronunciation is the
	// italic class "sn" line under the title, which is paragraph 1.
	// A later class "sn" is a subheading and stays unnumbered.
	body          bool
	pronunciation bool
}

func paragraphsFromHTML(src string) ([]Paragraph, error) {
	doc, err := html.Parse(strings.NewReader(src))
	if err != nil {
		return nil, err
	}
	page := 0
	var out []Paragraph
	// place is "body" for a direct child of body, "group" inside a pGroup,
	// and "skip" inside a heading, table, figure, or box.
	var walk func(*html.Node, string)
	walk = func(n *html.Node, place string) {
		if n.Type != html.ElementNode {
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c, place)
			}
			return
		}
		if no, ok := pageNumber(n); ok {
			page = no
		}
		next := place
		if n.Data == "body" {
			next = "body"
		} else if insightSkip(n.Data) {
			next = "skip"
		} else if hasClass(n, "pGroup") && place != "skip" {
			next = "group"
		} else if place == "body" {
			next = ""
		}
		if pid, ok := pidOf(n); ok {
			start := page
			if no, ok := firstPageBeforeText(n); ok {
				start = no
			}
			end := start
			if no, ok := lastPage(n); ok {
				end = no
			}
			if end < start {
				end = start
			}
			page = end
			text := plainText(n)
			para := Paragraph{
				Index: pid, FirstPage: start, LastPage: end,
				Text: text, Markup: markupNode(n),
			}
			markInsightParagraph(&para, n, text, place)
			out = append(out, para)
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, next)
		}
	}
	walk(doc, "")
	return out, nil
}

func insightSkip(tag string) bool {
	switch tag {
	case "figure", "figcaption", "aside", "table", "header", "thead", "tbody", "tr", "td", "th":
		return true
	default:
		return false
	}
}

// markInsightParagraph records whether the Research Guide numbers this block.
// Captions, tables, figures, and boxes are not numbered. A bold unclassed
// line is a mid-article subheading. The class "sn" line is the pronunciation
// when it leads the article, and a subheading when it comes later.
func markInsightParagraph(p *Paragraph, n *html.Node, text, place string) {
	if text == "" || n.Data != "p" || (place != "body" && place != "group") {
		return
	}
	switch {
	case hasClass(n, "sb"):
		p.body = true
	case classAttr(n) == "" && !insightSubhead(n):
		p.body = true
	case hasClass(n, "sn"):
		p.pronunciation = true
	}
}

func classAttr(n *html.Node) string {
	v, _ := attr(n, "class")
	return v
}

// insightSubhead is a paragraph whose words are a bold heading, not a
// sentence. An all-italic pronunciation line has no strong, so it is kept.
func insightSubhead(n *html.Node) bool {
	strong := false
	var walk func(*html.Node, bool) bool
	walk = func(n *html.Node, inMark bool) bool {
		if n.Type == html.TextNode {
			return inMark || strings.TrimSpace(n.Data) == ""
		}
		if n.Type != html.ElementNode {
			return true
		}
		if n.Data != "p" && n.Data != "strong" && n.Data != "em" {
			return false
		}
		if n.Data == "strong" {
			strong = true
		}
		mark := inMark || n.Data == "strong" || n.Data == "em"
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if !walk(c, mark) {
				return false
			}
		}
		return true
	}
	return walk(n, false) && strong
}

func pageNumber(n *html.Node) (int, bool) {
	if n.Type != html.ElementNode || !hasClass(n, "pageNum") {
		return 0, false
	}
	v, ok := attr(n, "data-no")
	if !ok {
		return 0, false
	}
	no, err := strconv.Atoi(v)
	if err != nil || no <= 0 {
		return 0, false
	}
	return no, true
}

func pidOf(n *html.Node) (int, bool) {
	if n.Type != html.ElementNode {
		return 0, false
	}
	v, ok := attr(n, "data-pid")
	if !ok {
		return 0, false
	}
	pid, err := strconv.Atoi(v)
	if err != nil {
		return 0, false
	}
	return pid, true
}

// firstPageBeforeText reports a page marker that sits before any words in n.
func firstPageBeforeText(n *html.Node) (int, bool) {
	found, ok, stop := 0, false, false
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		for c := n.FirstChild; c != nil && !stop; c = c.NextSibling {
			if c.Type == html.TextNode && strings.TrimSpace(c.Data) != "" {
				stop = true
				return
			}
			if no, is := pageNumber(c); is {
				found, ok, stop = no, true, true
				return
			}
			walk(c)
		}
	}
	walk(n)
	return found, ok
}

func lastPage(n *html.Node) (int, bool) {
	last, found := 0, false
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if no, ok := pageNumber(n); ok {
			last, found = no, true
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return last, found
}

func plainHTML(src string) (string, error) {
	doc, err := html.Parse(strings.NewReader(src))
	if err != nil {
		return "", err
	}
	return plainText(doc), nil
}

func plainText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return strings.Join(strings.Fields(b.String()), " ")
}

// verseNumber reads a BibleVerse.Label.
// An empty label is a superscription (verse 0). class "cl" is verse 1
// (the span shows the chapter number). class "vl" is that verse number.
func verseNumber(label string) (int, error) {
	if strings.TrimSpace(label) == "" {
		return 0, nil
	}
	doc, err := html.Parse(strings.NewReader(label))
	if err != nil {
		return 0, err
	}
	verse, class := 0, ""
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if class != "" {
			return
		}
		if n.Type == html.ElementNode && (hasClass(n, "cl") || hasClass(n, "vl")) {
			if hasClass(n, "cl") {
				class = "cl"
			} else {
				class = "vl"
			}
			if class == "cl" {
				verse = 1
				return
			}
			num, convErr := strconv.Atoi(plainText(n))
			if convErr != nil {
				class = "bad"
				return
			}
			verse = num
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	switch class {
	case "cl":
		return 1, nil
	case "vl":
		if verse < 1 {
			return 0, fmt.Errorf("verse label %q", label)
		}
		return verse, nil
	default:
		return 0, fmt.Errorf("unrecognized verse label %q", label)
	}
}

func hasClass(n *html.Node, class string) bool {
	v, ok := attr(n, "class")
	if !ok {
		return false
	}
	for _, c := range strings.Fields(v) {
		if c == class {
			return true
		}
	}
	return false
}

func attr(n *html.Node, key string) (string, bool) {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val, true
		}
	}
	return "", false
}
