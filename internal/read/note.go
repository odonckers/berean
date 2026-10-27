package read

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown/parser"
	"github.com/odonckers/berean/internal/cite"
	"github.com/odonckers/berean/internal/library"
)

const (
	segText = iota
	segBreak
	segChip
)

// citeMemo is one Resolve, kept so a pan does not look the citation up again.
type citeMemo struct {
	hits []library.Hit
	err  error
}

type noteSeg struct {
	kind         int
	text         string
	cite         string
	bold, italic bool
}

type notePara struct {
	segs []noteSeg
}

func (a *App) addNote(c *ui.Context) {
	a.nextClip++
	z := a.zoom
	if z == 0 {
		z = 1
	}
	clip := Clip{
		ID:   a.nextClip,
		Kind: kindNote,
		X:    (72 - a.panX) / z,
		Y:    (56 - a.panY) / z,
	}
	a.nudge(c, &clip)
	a.cards = append(a.cards, clip)
	a.editingNote = clip.ID
	a.noteDraft = ""
	a.armNote = true
	a.problemOK = false
	a.log.Info("note created", "id", clip.ID)
}

func (a *App) finishNote() {
	id := a.editingNote
	md := linkCitations(a.noteDraft)
	for i := range a.cards {
		if a.cards[i].ID == id {
			a.cards[i].Markdown = md
		}
	}
	a.editingNote = 0
	a.armNote = false
	a.problemOK = false
}

func (a *App) editNote(id int64) {
	for _, card := range a.cards {
		if card.ID == id {
			a.noteDraft = unlinkCitations(card.Markdown)
			break
		}
	}
	a.editingNote = id
	a.armNote = true
	a.problemOK = false
}

func (a *App) noteCard(c *ui.Context, i int) {
	clip := a.cards[i]
	t := c.Theme()
	id := clip.ID
	editing := a.editingNote == id
	ui.Column(c.Key(id)).Label(fmt.Sprintf("card %d", id)).Absolute().Left(clip.X).Top(clip.Y).Width(cardWidth).
		Padding(10, 12).Gap(6).Background(t.Surface).Border(1, t.Border).Radius(8).
		Cursor(ui.CursorMove).
		HandleInput(func(ev ui.InputEvent) bool { return a.cardInput(id, ev) }).
		Children(func() {
			ui.Text(c, "Note").FontSize(15).Bold().TextColor(t.Accent)
			if editing {
				a.noteEditor(c, id)
				return
			}
			a.noteBody(c, id, clip.Markdown)
			edit := ui.Button(c, "Edit")
			edit.HandleInput(func(ev ui.InputEvent) bool { return a.editorInput(id, ev) })
			if edit.Clicked() {
				a.editNote(id)
			}
		})
	a.rememberBox(c, a.cards[i])
	if a.laidOut == nil {
		a.laidOut = map[int64][2]float32{}
	}
	a.laidOut[id] = [2]float32{a.cards[i].X, a.cards[i].Y}
}

func (a *App) noteEditor(c *ui.Context, id int64) {
	t := c.Theme()
	area := ui.TextArea(c, &a.noteDraft).Label("Note editor").Lines(4, 12).FillWidth()
	if a.armNote {
		area.AutoFocus()
		a.armNote = false
	}
	area.HandleInput(func(ev ui.InputEvent) bool { return a.editorInput(id, ev) })
	for _, msg := range a.draftErrors() {
		ui.Text(c, msg).FontSize(12).TextColor(t.Danger)
	}
	done := ui.Button(c, "Done")
	done.HandleInput(func(ev ui.InputEvent) bool { return a.editorInput(id, ev) })
	if done.Clicked() {
		a.finishNote()
	}
}

// editorInput lets the field or button take the click, and still brings
// the card forward.
func (a *App) editorInput(id int64, ev ui.InputEvent) bool {
	if ev.Kind == ui.InputPointerDown {
		a.bringToFront(id)
	}
	return false
}

func (a *App) draftErrors() []string {
	if a.problemOK && a.problemSrc == a.noteDraft {
		return a.problems
	}
	a.problemSrc = a.noteDraft
	a.problemOK = true
	a.problems = a.problems[:0]
	for _, sp := range findCites(a.noteDraft) {
		_, err := a.lookup(a.noteDraft[sp.start:sp.end])
		if err != nil {
			a.problems = append(a.problems, err.Error())
		}
	}
	return a.problems
}

func (a *App) lookup(citation string) ([]library.Hit, error) {
	if a.citeCache == nil {
		a.citeCache = map[string]citeMemo{}
	}
	if m, ok := a.citeCache[citation]; ok {
		return m.hits, m.err
	}
	hits, err := a.lib.Resolve(context.Background(), citation)
	a.citeCache[citation] = citeMemo{hits: hits, err: err}
	return hits, err
}

func (a *App) noteBody(c *ui.Context, id int64, md string) {
	t := c.Theme()
	if strings.TrimSpace(md) == "" {
		ui.Text(c, "Empty note").FontSize(13).TextColor(t.TextMuted)
		return
	}
	paras := a.cachedNote(md)
	for _, para := range paras {
		var opened []string
		ui.RichText(c).FillWidth().FontSize(14.5).LineHeight(1.4).Children(func() {
			for _, seg := range para.segs {
				switch seg.kind {
				case segBreak:
					ui.Text(c, "\n")
				case segChip:
					el := ui.Text(c, seg.text).Bold().TextColor(t.Accent).Background(t.Accent.Alpha(0.18)).Cursor(ui.CursorPointer)
					el.HandleInput(func(ev ui.InputEvent) bool { return a.passClick(id, ev) })
					citeStr := seg.cite
					if el.Clicked() {
						a.toggleChip(id, citeStr)
					}
					if a.chipOpen(id, citeStr) {
						opened = append(opened, citeStr)
					}
				default:
					el := ui.Text(c, seg.text)
					if seg.bold {
						el.Bold()
					}
					if seg.italic {
						el.Italic()
					}
				}
			}
		})
		for _, citeStr := range opened {
			a.expandedChip(c, citeStr)
		}
	}
}

func (a *App) cachedNote(md string) []notePara {
	if a.noteCache == nil {
		a.noteCache = map[string][]notePara{}
	}
	if paras, ok := a.noteCache[md]; ok {
		return paras
	}
	paras := parseNote(md)
	a.noteCache[md] = paras
	return paras
}

func (a *App) toggleChip(id int64, citation string) {
	if a.openChip == nil {
		a.openChip = map[string]bool{}
	}
	k := chipKey(id, citation)
	a.openChip[k] = !a.openChip[k]
}

func (a *App) chipOpen(id int64, citation string) bool {
	return a.openChip[chipKey(id, citation)]
}

func chipKey(id int64, citation string) string {
	return fmt.Sprintf("%d\x00%s", id, citation)
}

func (a *App) expandedChip(c *ui.Context, citation string) {
	t := c.Theme()
	hits, err := a.lookup(citation)
	ui.Column(c).FillWidth().Gap(4).Padding(6).Background(t.Background).Radius(6).Children(func() {
		if err != nil {
			ui.Text(c, err.Error()).FontSize(12).TextColor(t.Danger)
			return
		}
		for _, h := range hits {
			ui.Text(c, h.Text).FontSize(13).LineHeight(1.35)
		}
		if len(hits) == 0 {
			return
		}
		btn := ui.Button(c, "Open source")
		btn.HandleInput(func(ev ui.InputEvent) bool { return false })
		if btn.Clicked() {
			a.openHits(citation, hits)
		}
	})
}

// openHits opens the publication or Bible the citation resolved to and
// marks the paragraph or verse.
func (a *App) openHits(citation string, hits []library.Hit) {
	if len(hits) == 0 {
		return
	}
	h := hits[0]
	switch h.Kind {
	case cite.KindBible, cite.KindStudyNote:
		from, to := h.Verse, h.Verse
		for _, hit := range hits {
			if hit.Book != h.Book || hit.Chapter != h.Chapter || hit.Verse <= 0 {
				continue
			}
			if from == 0 || hit.Verse < from {
				from = hit.Verse
			}
			if hit.Verse > to {
				to = hit.Verse
			}
		}
		a.goBible(h.Book, h.Chapter, from, to, h.PubID, "open", citation)
	default:
		from, to := 0, 0
		for _, hit := range hits {
			if hit.PubID != h.PubID || hit.DocumentID != h.DocumentID || hit.ParagraphIndex <= 0 {
				continue
			}
			if from == 0 || hit.ParagraphIndex < from {
				from = hit.ParagraphIndex
			}
			if hit.ParagraphIndex > to {
				to = hit.ParagraphIndex
			}
		}
		a.goPublication(h.PubID, h.DocumentID, from, to, from > 0, "open", citation)
	}
}

func parseNote(src string) []notePara {
	d := parser.New(parser.Default)
	d.Set(src)
	var paras []notePara
	var walk func(i int)
	walk = func(i int) {
		b := d.Block(i)
		switch b.Kind {
		case parser.Paragraph, parser.Heading:
			paras = append(paras, notePara{segs: inlineSegs(d.Inlines(i))})
		case parser.CodeBlock:
			paras = append(paras, notePara{segs: []noteSeg{{text: strings.TrimRight(d.Lines(i), "\n")}}})
		default:
			for child := range d.Children(i) {
				walk(child)
			}
		}
	}
	if d.Len() > 0 {
		walk(0)
	}
	return paras
}

func inlineSegs(in []parser.Inline) []noteSeg {
	var segs []noteSeg
	var walk func(i, end int, bold, italic bool, link string)
	walk = func(i, end int, bold, italic bool, link string) {
		for i < end && i < len(in) {
			n := in[i]
			next := n.Next
			if next <= i {
				next = i + 1
			}
			switch n.Kind {
			case parser.Strong:
				walk(i+1, next, true, italic, link)
			case parser.Emphasis:
				walk(i+1, next, bold, true, link)
			case parser.Link:
				walk(i+1, next, bold, italic, n.Dest)
			case parser.Text, parser.Code:
				segs = append(segs, segFor(n.Text, bold, italic, link))
			case parser.SoftBreak:
				segs = append(segs, noteSeg{text: " "})
			case parser.LineBreak:
				segs = append(segs, noteSeg{kind: segBreak})
			default:
				if next > i+1 {
					walk(i+1, next, bold, italic, link)
				}
			}
			i = next
		}
	}
	walk(0, len(in), false, false, "")
	return segs
}

func segFor(text string, bold, italic bool, link string) noteSeg {
	if citeStr, ok := jwCite(link); ok {
		label := text
		if label == "" {
			label = citeStr
		}
		return noteSeg{kind: segChip, text: label, cite: citeStr, bold: bold, italic: italic}
	}
	return noteSeg{text: text, bold: bold, italic: italic}
}

func jwCite(dest string) (string, bool) {
	const prefix = "jwcite:"
	if !strings.HasPrefix(dest, prefix) {
		return "", false
	}
	raw := strings.TrimPrefix(dest, prefix)
	s, err := url.PathUnescape(raw)
	if err != nil || s == "" {
		return "", false
	}
	return s, true
}

type citeSpan struct {
	start, end int
}

// linkCitations wraps each citation in a Markdown link. A link already
// written, and text in code, is left alone, so running it twice is stable.
func linkCitations(s string) string {
	spans := findCites(s)
	if len(spans) == 0 {
		return s
	}
	var b strings.Builder
	last := 0
	for _, sp := range spans {
		b.WriteString(s[last:sp.start])
		label := s[sp.start:sp.end]
		b.WriteByte('[')
		b.WriteString(label)
		b.WriteString("](jwcite:")
		b.WriteString(url.PathEscape(label))
		b.WriteByte(')')
		last = sp.end
	}
	b.WriteString(s[last:])
	return b.String()
}

// unlinkCitations turns jwcite links back into the citation text so the
// editor does not show the URL.
func unlinkCitations(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		end, label, ok := jwLink(s, i)
		if !ok {
			b.WriteByte(s[i])
			i++
			continue
		}
		b.WriteString(label)
		i = end
	}
	return b.String()
}

func jwLink(s string, i int) (int, string, bool) {
	if i >= len(s) || s[i] != '[' {
		return 0, "", false
	}
	rel, ok := readLink(s, i)
	if !ok {
		return 0, "", false
	}
	labelEnd := strings.IndexByte(s[i:], ']')
	if labelEnd < 1 {
		return 0, "", false
	}
	label := s[i+1 : i+labelEnd]
	destStart := i + labelEnd + 2 // ](
	if destStart >= rel {
		return 0, "", false
	}
	dest := s[destStart : rel-1]
	if _, ok := jwCite(dest); !ok {
		return 0, "", false
	}
	return rel, label, true
}

func findCites(s string) []citeSpan {
	var out []citeSpan
	i := 0
	lineStart := true
	for i < len(s) {
		if lineStart && strings.HasPrefix(s[i:], "```") {
			i = skipFence(s, i)
			lineStart = true
			continue
		}
		if s[i] == '`' {
			i = skipInlineCode(s, i)
			lineStart = false
			continue
		}
		if s[i] == '[' {
			if end, ok := readLink(s, i); ok {
				i = end
				lineStart = false
				continue
			}
		}
		if s[i] == '\n' {
			i++
			lineStart = true
			continue
		}
		if citeBoundary(s, i) {
			if end := takeCite(s, i); end > i {
				out = append(out, citeSpan{i, end})
				i = end
				lineStart = false
				continue
			}
		}
		lineStart = false
		i++
	}
	return out
}

func citeBoundary(s string, i int) bool {
	if i >= len(s) {
		return false
	}
	r, _ := utf8.DecodeRuneInString(s[i:])
	if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
		return false
	}
	if i == 0 {
		return true
	}
	prev, _ := utf8.DecodeLastRuneInString(s[:i])
	return !unicode.IsLetter(prev) && !unicode.IsDigit(prev)
}

func takeCite(s string, i int) int {
	limit := i
	for limit < len(s) && limit-i < 160 {
		r, size := utf8.DecodeRuneInString(s[limit:])
		if r == '\n' || r == '`' || r == '[' || r == ']' || r == '(' || r == ')' {
			break
		}
		limit += size
	}
	best := -1
	for end := limit; end > i; {
		if end < len(s) && isIdentByte(s[end]) {
			end--
			continue
		}
		chunk := strings.TrimRight(s[i:end], " \t")
		end = i + len(chunk)
		if end <= i {
			break
		}
		if c, err := cite.Parse(chunk); err == nil && substantial(c) {
			best = end
			break
		}
		_, size := utf8.DecodeLastRuneInString(s[:end])
		if size < 1 {
			break
		}
		end -= size
	}
	if best <= i {
		return 0
	}
	further := extendCiteTokens(s, best)
	further = i + len(strings.TrimRight(s[i:further], " \t"))
	if further > best {
		if _, err := cite.Parse(s[i:further]); err != nil {
			return further
		}
	}
	return best
}

func substantial(c cite.Citation) bool {
	switch c.Kind {
	case cite.KindBible, cite.KindStudyNote:
		return c.Book != 0 && len(c.Spans) > 0
	case cite.KindPub:
		return c.Year != 0 || len(c.Pages) > 0 || len(c.Pars) > 0 || c.Unit != 0
	default:
		return false
	}
}

func extendCiteTokens(s string, i int) int {
	j := i
	for j < len(s) {
		k := j
		for k < len(s) && (s[k] == ' ' || s[k] == '\t') {
			k++
		}
		n, ok := oneCiteToken(s, k)
		if !ok {
			break
		}
		j = n
	}
	return j
}

func oneCiteToken(s string, i int) (int, bool) {
	if i >= len(s) {
		return 0, false
	}
	r, size := utf8.DecodeRuneInString(s[i:])
	if r == '-' || r == '–' || r == ',' || r == ':' || r == '/' {
		return i + size, true
	}
	if s[i] == '.' {
		j := i + 1
		if j >= len(s) || s[j] < '0' || s[j] > '9' {
			return 0, false
		}
		for j < len(s) && s[j] >= '0' && s[j] <= '9' {
			j++
		}
		return j, true
	}
	lower := strings.ToLower(s[i:])
	for _, tok := range []string{"pars.", "par.", "pp.", "p."} {
		if strings.HasPrefix(lower, tok) {
			return i + len(tok), true
		}
	}
	if s[i] >= '0' && s[i] <= '9' {
		j := i
		for j < len(s) && s[j] >= '0' && s[j] <= '9' {
			j++
		}
		return j, true
	}
	return 0, false
}

func isIdentByte(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9')
}

func skipFence(s string, i int) int {
	rest := s[i+3:]
	nl := strings.IndexByte(rest, '\n')
	if nl < 0 {
		return len(s)
	}
	from := i + 3 + nl + 1
	j := strings.Index(s[from:], "\n```")
	if j < 0 {
		return len(s)
	}
	line := from + j + 1
	end := line + 3
	for end < len(s) && s[end] != '\n' {
		end++
	}
	if end < len(s) && s[end] == '\n' {
		end++
	}
	return end
}

func skipInlineCode(s string, i int) int {
	j := strings.IndexByte(s[i+1:], '`')
	if j < 0 {
		return i + 1
	}
	return i + 1 + j + 1
}

func readLink(s string, i int) (int, bool) {
	if i >= len(s) || s[i] != '[' {
		return 0, false
	}
	labelEnd := strings.IndexByte(s[i+1:], ']')
	if labelEnd < 0 {
		return 0, false
	}
	rest := i + 1 + labelEnd
	if rest+1 >= len(s) || s[rest+1] != '(' {
		return 0, false
	}
	close := strings.IndexByte(s[rest+2:], ')')
	if close < 0 {
		return 0, false
	}
	return rest + 2 + close + 1, true
}
