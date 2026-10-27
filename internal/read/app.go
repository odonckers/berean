// Package read is the Berean window: a publication pane, a Bible pane, and
// a canvas between them where a dragged paragraph or verse becomes a clip.
package read

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/cite"
	"github.com/odonckers/berean/internal/jwpub"
	"github.com/odonckers/berean/internal/library"
)

const (
	noneTrans = "None"
	leftWidth = 760
)

// block is one paragraph ready to draw.
type block struct {
	index, ordinal int
	number         int
	numbered       bool
	heading        int
	page           int
	runs           []jwpub.Run
}

// verseCell is one translation's text for a verse. present is false when
// that translation has no such verse.
type verseCell struct {
	present bool
	pub     library.PublicationInfo
	runs    []jwpub.Run
}

type verseLine struct {
	verse int
	cells []verseCell
}

// App is the reading window. Each paragraph and verse is labeled in the
// UI tree with its source, as "src pub=… doc=… pid=…" or
// "src bible=… book=… chapter=… verse=…", so a later change can drag it
// onto the canvas.
type App struct {
	lib *library.Library
	log *slog.Logger

	articles      []library.PublicationInfo
	articleLabels []string
	bibles        []library.PublicationInfo
	bibleLabels   []string
	bookTitles    []string

	pubID                    int64
	docID                    int
	pubChoice                string
	docChoice                string
	docs                     []library.DocInfo
	docLabels                []string
	docsFor                  int64
	title                    string
	blocks                   []block
	loadedPub                int64
	loadedDoc                int
	pubScroll                ui.ScrollState
	pubHref                  string
	focusPar                 bool
	focusParFrom, focusParTo int
	pubBack, pubFwd          []pubPlace
	holdPubScroll            bool
	heldPubScroll            float32

	book, chapter       int
	bookChoice          string
	chapterChoice       string
	trans               [2]int64
	transChoice         [2]string
	chapterLabels       []string
	chapterKey          string
	lines               []verseLine
	loadedBook          int
	loadedChapter       int
	loadedTrans         [2]int64
	bibleScroll         ui.ScrollState
	bibleHref           string
	focusVerse          int
	focusVerseTo        int
	focusVerseOn        bool
	verseAnchor         int
	bibleBack, bibleFwd []biblePlace
	holdBibleScroll     bool
	heldBibleScroll     float32

	// paneSplit is the publication pane's share of the left column, 0 to 100.
	paneSplit float32

	panX, panY, zoom float32
	panning          bool
	panLX, panLY     float32
	cards            []Clip
	nextClip         int64
	movingCard       int64
	grabX, grabY     float32
	laidOut          map[int64][2]float32
	boxes            map[int64]cardBox

	citeCache   map[string]citeMemo
	noteCache   map[string][]notePara
	openChip    map[string]bool
	editingNote int64
	noteDraft   string
	armNote     bool
	problemSrc  string
	problemOK   bool
	problems    []string

	status string
}

// New reads the library catalog and selects the first publication and,
// when a Bible is imported, Matthew 24.
func New(lib *library.Library, log *slog.Logger) (*App, error) {
	if log == nil {
		log = slog.Default()
	}
	pubs, err := lib.Publications(context.Background())
	if err != nil {
		return nil, err
	}
	a := &App{
		lib: lib, log: log,
		bookTitles:    cite.BookTitles(),
		book:          40,
		chapter:       24,
		bookChoice:    cite.BookTitle(40),
		chapterChoice: "24",
		docsFor:       -1,
		paneSplit:     50,
		zoom:          1,
		laidOut:       map[int64][2]float32{},
		boxes:         map[int64]cardBox{},
		citeCache:     map[string]citeMemo{},
		noteCache:     map[string][]notePara{},
		openChip:      map[string]bool{},
	}
	for _, p := range pubs {
		if p.Type == "Bible" {
			a.bibles = append(a.bibles, p)
		} else {
			a.articles = append(a.articles, p)
		}
	}
	a.articleLabels = publicationLabels(a.articles)
	a.bibleLabels = biblePickerLabels(a.bibles)
	if len(a.articles) > 0 {
		a.pubID = a.articles[0].ID
	}
	for i := 0; i < len(a.bibles) && i < 2; i++ {
		a.trans[i] = a.bibles[i].ID
	}
	a.transChoice[0] = a.choiceFor(a.bibleLabels, a.bibles, a.trans[0])
	if a.trans[1] == 0 {
		a.transChoice[1] = noneTrans
	} else {
		a.transChoice[1] = a.choiceFor(a.bibleLabels, a.bibles, a.trans[1])
	}
	return a, nil
}

// Run opens the window on lib and blocks until it closes.
func Run(lib *library.Library, log *slog.Logger) error {
	a, err := New(lib, log)
	if err != nil {
		return err
	}
	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:   "Berean",
			Width:   1440,
			Height:  900,
			Content: ui.View(a.View),
		})
	})
	return mygo.App.Run()
}

// View draws the two reading panes and the canvas.
func (a *App) View(c *ui.Context) {
	t := c.Theme()
	if a.paneSplit == 0 {
		a.paneSplit = 50
	}
	ui.Row(c).Fill().Children(func() {
		ui.Column(c).Width(leftWidth).Shrink(0).FillHeight().Background(t.Surface).Children(func() {
			ui.SplitVerticalPercent(c, &a.paneSplit, func() {
				a.publicationPane(c)
			}, func() {
				a.biblePane(c)
			}).Grow(1).FillWidth()
		})
		ui.Box(c).Width(1).FillHeight().Background(t.Border)
		a.canvas(c)
	})
}

func (a *App) publicationPane(c *ui.Context) {
	ui.Column(c).Fill().Children(func() {
		a.publicationControls(c)
		a.loadPublication()
		a.publicationBody(c)
	})
}

func (a *App) biblePane(c *ui.Context) {
	ui.Column(c).Fill().Children(func() {
		a.bibleControls(c)
		a.loadChapter()
		a.bibleBody(c)
	})
}

func (a *App) publicationControls(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).FillWidth().Padding(12, 14, 8, 14).Gap(6).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Children(func() {
			ui.Text(c, "Publication").FontSize(13).Bold().TextColor(t.TextMuted).Grow(1)
			a.historyButtons(c, true)
		})
		if len(a.articles) == 0 {
			ui.Text(c, "No publication in the library").TextColor(t.TextMuted)
			return
		}
		// The model wins when a link changed it. While the choice already
		// names that publication, the combobox keeps what the user is typing.
		if a.idFor(a.articleLabels, a.articles, a.pubChoice) != a.pubID {
			if lab := a.choiceFor(a.articleLabels, a.articles, a.pubID); lab != "" {
				a.pubChoice = lab
			}
		}
		prevPub := a.pubChoice
		ui.Combobox(c, &a.pubChoice, a.articleLabels).Label("Publication").FillWidth()
		if a.pubChoice != prevPub {
			id := a.idFor(a.articleLabels, a.articles, a.pubChoice)
			// A partial string while typing resolves to nothing. Record a
			// step only when one real publication replaces another.
			if id != 0 && a.pubID != 0 && id != a.pubID {
				a.pubBack = pushHistory(a.pubBack, a.snapshotPub())
				a.pubFwd = nil
				a.focusParFrom, a.focusParTo = 0, 0
				a.focusPar = false
			}
			if id != a.pubID {
				a.pubID = id
				a.docID = 0
				a.docsFor = -1
			}
		}
		a.ensureDocs()
		if !a.hasDoc(a.docID) && len(a.docs) > 0 {
			a.docID = a.docs[0].ID
		}
		if a.docIDByLabel(a.docChoice) != a.docID {
			if lab := a.docLabel(a.docID); lab != "" {
				a.docChoice = lab
			}
		}
		if len(a.docLabels) == 0 {
			return
		}
		prevDoc := a.docChoice
		ui.Combobox(c, &a.docChoice, a.docLabels).Label("Document").FillWidth()
		if a.docChoice != prevDoc {
			if id := a.docIDByLabel(a.docChoice); id != 0 && id != a.docID {
				a.goPublication(a.pubID, id, 0, 0, false, "open", "")
			}
		}
		if a.status != "" {
			ui.Text(c, a.status).FontSize(12).TextColor(t.Danger).SingleLine()
		}
	})
}

func (a *App) bibleControls(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).FillWidth().Padding(12, 14, 8, 14).Gap(6).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Children(func() {
			ui.Text(c, "Bible").FontSize(13).Bold().TextColor(t.TextMuted).Grow(1)
			a.historyButtons(c, false)
		})
		if len(a.bibles) == 0 {
			ui.Text(c, "No Bible in the library").TextColor(t.TextMuted)
			return
		}
		ui.Row(c).FillWidth().Gap(8).Children(func() {
			if n, ok := cite.BookByName(a.bookChoice); !ok || n != a.book {
				a.bookChoice = bookChoice(a.book)
			}
			prevBook := a.bookChoice
			ui.Combobox(c, &a.bookChoice, a.bookTitles).Label("Book").Grow(1)
			if a.bookChoice != prevBook {
				if n, ok := cite.BookByName(a.bookChoice); ok && n != a.book {
					a.goBible(n, 1, 0, 0, 0, "open", "")
				}
			}
			labels := a.ensureChapters()
			if strconv.Itoa(a.chapter) != a.chapterChoice && contains(labels, strconv.Itoa(a.chapter)) {
				a.chapterChoice = strconv.Itoa(a.chapter)
			}
			prevCh := a.chapterChoice
			ui.Select(c, &a.chapterChoice, labels).Label("Chapter").Width(108).Shrink(0)
			if a.chapterChoice != prevCh {
				if n, err := strconv.Atoi(a.chapterChoice); err == nil && n != a.chapter {
					a.goBible(a.book, n, 0, 0, 0, "open", "")
				}
			}
		})
		none := append([]string{noneTrans}, a.bibleLabels...)
		ui.Row(c).FillWidth().Gap(8).Children(func() {
			if a.idFor(a.bibleLabels, a.bibles, a.transChoice[0]) != a.trans[0] {
				a.transChoice[0] = a.choiceFor(a.bibleLabels, a.bibles, a.trans[0])
			}
			prev0 := a.transChoice[0]
			ui.Combobox(c, &a.transChoice[0], a.bibleLabels).Label("First translation").Grow(1)
			if a.transChoice[0] != prev0 {
				a.trans[0] = a.idFor(a.bibleLabels, a.bibles, a.transChoice[0])
			}
			want1 := noneTrans
			if a.trans[1] != 0 {
				want1 = a.choiceFor(a.bibleLabels, a.bibles, a.trans[1])
			}
			cur1 := a.trans[1]
			if a.transChoice[1] == noneTrans {
				cur1 = 0
			} else {
				cur1 = a.idFor(a.bibleLabels, a.bibles, a.transChoice[1])
			}
			if cur1 != a.trans[1] && want1 != "" {
				a.transChoice[1] = want1
			}
			prev1 := a.transChoice[1]
			ui.Combobox(c, &a.transChoice[1], none).Label("Second translation").Grow(1)
			if a.transChoice[1] != prev1 {
				if a.transChoice[1] == noneTrans {
					a.trans[1] = 0
				} else {
					a.trans[1] = a.idFor(a.bibleLabels, a.bibles, a.transChoice[1])
				}
			}
		})
	})
}

func (a *App) publicationBody(c *ui.Context) {
	t := c.Theme()
	pub, ok := a.publication(a.pubID)
	// scrollMark is decided before the body, so a link followed while the
	// body is drawing — which changes the document — still scrolls next frame.
	scrollMark := a.focusPar && a.loadedPub == a.pubID && a.loadedDoc == a.docID
	ui.Scroll(c).Grow(1).FillWidth().TrackScroll(&a.pubScroll).Padding(4, 16, 20, 16).Children(func() {
		ui.Column(c).FillWidth().Gap(12).Children(func() {
			// The document title and its first heading are often the same
			// words ("Introduction"). Draw the heading, which can be clipped.
			if a.title != "" && !duplicateTitle(a.title, a.blocks) {
				ui.Text(c, a.title).FontSize(22).Bold().LineHeight(1.25)
			}
			if !ok || len(a.blocks) == 0 {
				if a.pubID != 0 && a.docID != 0 && a.loadedDoc == a.docID {
					ui.Text(c, "This document has no paragraphs.").TextColor(t.TextMuted)
				}
				return
			}
			for _, b := range a.blocks {
				a.paragraph(c, pub, b, scrollMark)
			}
		})
	})
	if scrollMark {
		a.focusPar = false
	}
}

func (a *App) paragraph(c *ui.Context, pub library.PublicationInfo, b block, scrollMark bool) {
	t := c.Theme()
	src := pubSource(pub, a.docID, b)
	marked := a.parMarked(b.index)
	if marked {
		src += " marked"
	}
	row := ui.Row(c.Key(src)).Label(src).Description(src).FillWidth().Gap(10).AlignItems(ui.Start).
		Drag(a.paragraphPassage(pub, b))
	if marked {
		row.Background(t.Accent.Alpha(0.16)).Radius(6).Padding(2, 4)
	}
	if scrollMark && marked && b.index == a.focusParFrom {
		row.ScrollIntoView()
	}
	row.Children(func() {
		if b.heading == 0 {
			num := ""
			if b.numbered {
				num = strconv.Itoa(b.number)
			}
			ui.Text(c, num).Width(36).Shrink(0).FontSize(13).Bold().TextColor(t.TextMuted)
		}
		size := float32(16.5)
		if b.heading > 0 {
			size = 20
		}
		rt := ui.RichText(c).Grow(1).FontSize(size).LineHeight(1.45)
		if b.heading > 0 {
			rt.Bold()
		}
		rt.Children(func() { a.paintRuns(c, b.runs) })
	})
}

func (a *App) bibleBody(c *ui.Context) {
	t := c.Theme()
	pubs := a.shownBibles()
	scrollMark := a.focusVerseOn && a.loadedBook == a.book && a.loadedChapter == a.chapter
	ui.Scroll(c).Grow(1).FillWidth().TrackScroll(&a.bibleScroll).Padding(4, 16, 20, 16).Children(func() {
		ui.Column(c).FillWidth().Gap(10).Children(func() {
			if a.book >= 1 {
				ui.Textf(c, "%s %d", cite.BookTitle(a.book), a.chapter).FontSize(22).Bold()
			}
			if len(pubs) == 0 {
				return
			}
			ui.Row(c).FillWidth().Gap(12).Children(func() {
				ui.Box(c).Width(36).Shrink(0)
				for _, p := range pubs {
					ui.Text(c, p.Symbol).Grow(1).FontSize(12).Bold().TextColor(t.TextMuted)
				}
			})
			if len(a.lines) == 0 {
				ui.Text(c, "This chapter is not in the selected translation.").TextColor(t.TextMuted)
				return
			}
			for _, line := range a.lines {
				a.verseRow(c, line, scrollMark)
			}
		})
	})
	if scrollMark {
		a.focusVerseOn = false
	}
}

func (a *App) verseRow(c *ui.Context, line verseLine, scrollMark bool) {
	t := c.Theme()
	marked := a.verseMarked(line.verse)
	row := ui.Row(c).FillWidth().Gap(12).AlignItems(ui.Start)
	if marked {
		row.Background(t.Accent.Alpha(0.16)).Radius(6).Padding(2, 4)
	}
	if scrollMark && marked {
		lo, _, _ := a.markedVerseSpan()
		if line.verse == lo {
			row.ScrollIntoView()
		}
	}
	row.Children(func() {
		ui.Textf(c, "%d", line.verse).Width(36).Shrink(0).FontSize(13).Bold().TextColor(t.TextMuted)
		for _, cell := range line.cells {
			if !cell.present {
				ui.Text(c, "—").Grow(1).TextColor(t.TextMuted)
				continue
			}
			src := bibleSource(cell.pub, a.book, a.chapter, line.verse)
			if marked {
				src += " marked"
			}
			verse := line.verse
			cell := cell
			col := ui.Column(c.Key(src)).Label(src).Description(src).Grow(1).Drag(a.versePassage(cell, verse))
			if col.Clicked() {
				a.selectVerse(verse, col.ClickModifiers()&ui.Shift != 0)
			}
			col.Children(func() {
				ui.RichText(c).FillWidth().FontSize(16.5).LineHeight(1.45).Children(func() {
					a.paintRuns(c, cell.runs)
				})
			})
		}
	})
}

func (a *App) paintRuns(c *ui.Context, runs []jwpub.Run) {
	t := c.Theme()
	for _, r := range runs {
		if r.Break {
			ui.Text(c, " ")
			continue
		}
		if r.Text == "" {
			continue
		}
		el := ui.Text(c, showRun(r))
		if r.Bold {
			el.Bold()
		}
		if r.Italic {
			el.Italic()
		}
		if r.Href != "" {
			href := r.Href
			el.TextColor(t.Accent).Underline().Cursor(ui.CursorPointer)
			if el.Clicked() {
				a.follow(href)
			}
		}
	}
}

func (a *App) follow(href string) {
	target, err := a.lib.ResolveLink(context.Background(), href)
	if err != nil || target.Kind == library.LinkBad {
		if err == nil {
			err = fmt.Errorf("unrecognized link")
		}
		a.log.Error("link", "href", href, "err", err)
		a.status = "Unrecognized link"
		return
	}
	switch target.Kind {
	case library.LinkVerse:
		a.bibleHref = href
		a.status = ""
		end := target.EndVerse
		if end < target.Verse {
			end = target.Verse
		}
		a.goBible(target.Book, target.Chapter, target.Verse, end, 0, "open", "")
	case library.LinkDocument:
		a.pubHref = href
		a.status = ""
		from, to := target.ParFrom, target.ParTo
		a.goPublication(target.PubID, target.DocumentID, from, to, from > 0, "open", "")
	case library.LinkMissing:
		a.log.Error("link", "href", href, "meps_document_id", target.MepsDocumentID, "paragraphs", fmt.Sprintf("%d-%d", target.ParFrom, target.ParTo), "err", "not in the library")
		a.status = "Not in the library"
	case library.LinkExternal:
		a.log.Info("link skipped", "href", href, "reason", "outside the library")
	}
}

func (a *App) loadPublication() {
	if a.pubID == 0 || a.docID == 0 {
		return
	}
	if a.loadedPub == a.pubID && a.loadedDoc == a.docID {
		return
	}
	pub, _ := a.publication(a.pubID)
	start := time.Now()
	paras, err := a.lib.Paragraphs(context.Background(), a.pubID, a.docID)
	if err != nil {
		a.log.Error("document load", "pane", "publication", "symbol", pub.Symbol, "document_id", a.docID, "err", err)
		a.status = "Could not open the document"
		return
	}
	elapsed := time.Since(start)
	title := a.docTitle(a.docID)
	a.log.Info("pane open",
		"pane", "publication",
		"symbol", pub.Symbol,
		"year", pub.Year,
		"issue", pub.Issue,
		"document_id", a.docID,
		"title", title,
		"href", a.pubHref,
	)
	a.log.Info("document load",
		"pane", "publication",
		"symbol", pub.Symbol,
		"document_id", a.docID,
		"paragraphs", len(paras),
		"duration", elapsed,
	)
	a.pubHref = ""
	a.blocks = decodeParas(paras)
	a.title = title
	a.loadedPub, a.loadedDoc = a.pubID, a.docID
	if a.holdPubScroll {
		a.pubScroll.Y = a.heldPubScroll
		a.holdPubScroll = false
	} else {
		a.pubScroll.Y = 0
	}
}

func (a *App) loadChapter() {
	shown := a.shownBibles()
	var key [2]int64
	for i := range shown {
		if i < 2 {
			key[i] = shown[i].ID
		}
	}
	if a.loadedBook == a.book && a.loadedChapter == a.chapter && a.loadedTrans == key && a.lines != nil {
		return
	}
	if len(shown) == 0 {
		a.lines = []verseLine{}
		a.loadedBook, a.loadedChapter, a.loadedTrans = a.book, a.chapter, key
		return
	}
	start := time.Now()
	columns := make([][]library.VerseText, len(shown))
	total := 0
	for i, p := range shown {
		verses, err := a.lib.ChapterVerses(context.Background(), p.ID, a.book, a.chapter)
		if err != nil {
			a.log.Error("document load", "pane", "bible", "symbol", p.Symbol, "book", a.book, "chapter", a.chapter, "err", err)
			a.status = "Could not open the chapter"
			return
		}
		columns[i] = verses
		total += len(verses)
	}
	elapsed := time.Since(start)
	symbols := make([]string, len(shown))
	for i, p := range shown {
		symbols[i] = p.Symbol
	}
	a.log.Info("pane open",
		"pane", "bible",
		"book", a.book,
		"chapter", a.chapter,
		"translations", symbols,
		"href", a.bibleHref,
	)
	a.log.Info("document load",
		"pane", "bible",
		"book", a.book,
		"chapter", a.chapter,
		"translations", symbols,
		"verses", total,
		"duration", elapsed,
	)
	a.bibleHref = ""
	a.lines = alignVerses(shown, columns)
	a.loadedBook, a.loadedChapter, a.loadedTrans = a.book, a.chapter, key
	if a.holdBibleScroll {
		a.bibleScroll.Y = a.heldBibleScroll
		a.holdBibleScroll = false
	} else {
		a.bibleScroll.Y = 0
	}
}

func (a *App) ensureDocs() {
	if a.docsFor == a.pubID {
		return
	}
	if a.pubID == 0 {
		a.docs, a.docLabels, a.docsFor = nil, nil, 0
		return
	}
	docs, err := a.lib.Documents(context.Background(), a.pubID)
	if err != nil {
		a.log.Error("document load", "pane", "publication", "err", err)
		a.docs, a.docLabels, a.docsFor = nil, nil, a.pubID
		return
	}
	a.docs = docs
	a.docLabels = docLabels(docs)
	a.docsFor = a.pubID
}

func (a *App) ensureChapters() []string {
	pubs := a.shownBibles()
	key := strconv.Itoa(a.book)
	for _, p := range pubs {
		key += fmt.Sprintf(",%d", p.ID)
	}
	if key == a.chapterKey && a.chapterLabels != nil {
		return a.chapterLabels
	}
	max := 1
	for _, p := range pubs {
		n, err := a.lib.MaxChapter(context.Background(), p.ID, a.book)
		if err != nil {
			a.log.Error("document load", "pane", "bible", "symbol", p.Symbol, "book", a.book, "err", err)
			continue
		}
		if n > max {
			max = n
		}
	}
	labels := make([]string, max)
	for i := 1; i <= max; i++ {
		labels[i-1] = strconv.Itoa(i)
	}
	a.chapterLabels = labels
	a.chapterKey = key
	if a.chapter > max {
		a.chapter = max
		a.chapterChoice = strconv.Itoa(max)
	}
	return labels
}

func (a *App) shownBibles() []library.PublicationInfo {
	var out []library.PublicationInfo
	for _, id := range a.trans {
		if id == 0 {
			continue
		}
		p, ok := a.bible(id)
		if !ok {
			continue
		}
		if len(out) > 0 && out[len(out)-1].ID == p.ID {
			continue
		}
		// Two slots can name the same translation. Show it once.
		dup := false
		for _, have := range out {
			if have.ID == p.ID {
				dup = true
			}
		}
		if !dup {
			out = append(out, p)
		}
	}
	return out
}

func (a *App) publication(id int64) (library.PublicationInfo, bool) {
	for _, p := range a.articles {
		if p.ID == id {
			return p, true
		}
	}
	return a.bible(id)
}

func (a *App) bible(id int64) (library.PublicationInfo, bool) {
	for _, p := range a.bibles {
		if p.ID == id {
			return p, true
		}
	}
	return library.PublicationInfo{}, false
}

func (a *App) hasDoc(id int) bool {
	for _, d := range a.docs {
		if d.ID == id {
			return true
		}
	}
	return false
}

func (a *App) docTitle(id int) string {
	for _, d := range a.docs {
		if d.ID == id {
			return d.Title
		}
	}
	return ""
}

func (a *App) docLabel(id int) string {
	for i, d := range a.docs {
		if d.ID == id {
			return a.docLabels[i]
		}
	}
	return ""
}

func (a *App) docIDByLabel(label string) int {
	for i, lab := range a.docLabels {
		if lab == label {
			return a.docs[i].ID
		}
	}
	return 0
}

func (a *App) choiceFor(labels []string, pubs []library.PublicationInfo, id int64) string {
	for i, p := range pubs {
		if p.ID == id {
			return labels[i]
		}
	}
	return ""
}

func (a *App) idFor(labels []string, pubs []library.PublicationInfo, label string) int64 {
	for i, lab := range labels {
		if lab == label {
			return pubs[i].ID
		}
	}
	return 0
}

func biblePickerLabels(pubs []library.PublicationInfo) []string {
	out := make([]string, len(pubs))
	count := map[string]int{}
	for i, p := range pubs {
		out[i] = biblePickerLabel(p)
		count[out[i]]++
	}
	for i, p := range pubs {
		if count[out[i]] > 1 {
			out[i] = fmt.Sprintf("%s (%d)", out[i], p.Year)
		}
	}
	return out
}

// biblePickerLabel is short enough that the two translation menus don't
// truncate to the same words. A long short-title falls back to the symbol.
func biblePickerLabel(p library.PublicationInfo) string {
	short := strings.TrimSpace(p.Short)
	if short != "" && len([]rune(short)) <= 16 {
		return short
	}
	if p.Symbol != "" {
		return strings.ToUpper(p.Symbol)
	}
	return p.Display()
}

func publicationLabels(pubs []library.PublicationInfo) []string {
	count := map[string]int{}
	raw := make([]string, len(pubs))
	for i, p := range pubs {
		raw[i] = fmt.Sprintf("%s (%s)", p.Display(), p.Symbol)
		count[raw[i]]++
	}
	out := make([]string, len(pubs))
	for i, p := range pubs {
		if count[raw[i]] > 1 {
			out[i] = fmt.Sprintf("%s [%d]", raw[i], p.Year)
		} else {
			out[i] = raw[i]
		}
	}
	return out
}

func docLabels(docs []library.DocInfo) []string {
	count := map[string]int{}
	for _, d := range docs {
		count[d.Title]++
	}
	out := make([]string, len(docs))
	for i, d := range docs {
		if count[d.Title] > 1 {
			out[i] = fmt.Sprintf("%s (%d)", d.Title, d.ID)
		} else {
			out[i] = d.Title
		}
	}
	return out
}

func bookChoice(book int) string {
	if book < 1 {
		return ""
	}
	return cite.BookTitle(book)
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

func decodeParas(paras []library.Para) []block {
	out := make([]block, 0, len(paras))
	for _, p := range paras {
		h, runs := decodeRuns(p.Markup, p.Text)
		out = append(out, block{
			index: p.Index, ordinal: p.Ordinal,
			number: p.Number, numbered: p.Numbered,
			heading: h, page: p.FirstPage, runs: runs,
		})
	}
	return out
}

func decodeRuns(markup, plain string) (int, []jwpub.Run) {
	if markup != "" {
		m, err := jwpub.DecodeMark(markup)
		if err == nil && (m.Heading > 0 || len(m.Runs) > 0) {
			return m.Heading, m.Runs
		}
	}
	if plain == "" {
		return 0, nil
	}
	return 0, []jwpub.Run{{Text: plain}}
}

func alignVerses(pubs []library.PublicationInfo, columns [][]library.VerseText) []verseLine {
	index := map[int]bool{}
	var order []int
	for _, col := range columns {
		for _, v := range col {
			if !index[v.Verse] {
				index[v.Verse] = true
				order = append(order, v.Verse)
			}
		}
	}
	// columns are already in verse order; the union follows the first
	// column, then any extras. Sort so a gap in the first translation
	// still lines up.
	sortInts(order)
	lines := make([]verseLine, len(order))
	for i, n := range order {
		line := verseLine{verse: n, cells: make([]verseCell, len(pubs))}
		for c, col := range columns {
			cell := verseCell{pub: pubs[c]}
			for _, v := range col {
				if v.Verse == n {
					_, cell.runs = decodeRuns(v.Markup, v.Text)
					cell.present = true
					break
				}
			}
			line.cells[c] = cell
		}
		lines[i] = line
	}
	return lines
}

func sortInts(v []int) {
	for i := 1; i < len(v); i++ {
		j := i
		for j > 0 && v[j] < v[j-1] {
			v[j], v[j-1] = v[j-1], v[j]
			j--
		}
	}
}

func pubSource(p library.PublicationInfo, docID int, b block) string {
	return fmt.Sprintf("src pub=%s year=%d issue=%d doc=%d pid=%d ord=%d", p.Symbol, p.Year, p.Issue, docID, b.index, b.ordinal)
}

func bibleSource(p library.PublicationInfo, book, chapter, verse int) string {
	return fmt.Sprintf("src bible=%s year=%d book=%d chapter=%d verse=%d", p.Symbol, p.Year, book, chapter, verse)
}
