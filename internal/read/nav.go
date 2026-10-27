package read

import (
	"fmt"

	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/cite"
)

const historyLimit = 40

// pubPlace is one stop in the publication pane, including the scroll offset
// and which paragraphs were marked.
type pubPlace struct {
	pubID            int64
	docID            int
	scroll           float32
	markFrom, markTo int
}

// biblePlace is one stop in the Bible pane.
type biblePlace struct {
	book, chapter    int
	trans            [2]int64
	scroll           float32
	markFrom, markTo int
}

func (a *App) snapshotPub() pubPlace {
	return pubPlace{
		pubID: a.pubID, docID: a.docID, scroll: a.pubScroll.Y,
		markFrom: a.focusParFrom, markTo: a.focusParTo,
	}
}

func (a *App) snapshotBible() biblePlace {
	return biblePlace{
		book: a.book, chapter: a.chapter, trans: a.trans, scroll: a.bibleScroll.Y,
		markFrom: a.focusVerse, markTo: a.focusVerseTo,
	}
}

// goPublication opens a document. from and to are paragraph indexes to mark;
// from 0 marks nothing. scrollTo brings the first marked paragraph into view.
// The place being left, including its scroll offset, is kept for Back.
func (a *App) goPublication(pubID int64, docID, from, to int, scrollTo bool, action, citation string) {
	if pubID == a.pubID && docID == a.docID && !scrollTo && from == 0 {
		return
	}
	a.pubBack = pushHistory(a.pubBack, a.snapshotPub())
	a.pubFwd = nil
	a.applyPublication(pubID, docID, from, to, scrollTo, false, 0)
	a.logNavPub(action, citation)
}

func (a *App) applyPublication(pubID int64, docID, from, to int, scrollTo, hold bool, scroll float32) {
	if pubID != a.pubID {
		a.docsFor = -1
	}
	changed := pubID != a.pubID || docID != a.docID
	a.pubID, a.docID = pubID, docID
	if from > 0 {
		if to < from {
			to = from
		}
		a.focusParFrom, a.focusParTo = from, to
		a.focusPar = scrollTo
	} else if changed {
		a.focusParFrom, a.focusParTo = 0, 0
		a.focusPar = false
	}
	if hold {
		a.holdPubScroll = true
		a.heldPubScroll = scroll
		a.pubScroll.Y = scroll
		a.focusPar = false
	}
}

func (a *App) backPublication() {
	place, ok := popHistory(&a.pubBack)
	if !ok {
		return
	}
	a.pubFwd = pushHistory(a.pubFwd, a.snapshotPub())
	a.applyPublication(place.pubID, place.docID, place.markFrom, place.markTo, false, true, place.scroll)
	a.logNavPub("back", "")
}

func (a *App) forwardPublication() {
	place, ok := popHistory(&a.pubFwd)
	if !ok {
		return
	}
	a.pubBack = pushHistory(a.pubBack, a.snapshotPub())
	a.applyPublication(place.pubID, place.docID, place.markFrom, place.markTo, false, true, place.scroll)
	a.logNavPub("forward", "")
}

// goBible opens a chapter. vFrom and vTo mark a verse span; vFrom 0 clears
// the mark when the chapter changes. bibleID, when set, becomes the first
// translation if it is not already showing.
func (a *App) goBible(book, chapter, vFrom, vTo int, bibleID int64, action, citation string) {
	a.bibleBack = pushHistory(a.bibleBack, a.snapshotBible())
	a.bibleFwd = nil
	a.applyBible(book, chapter, vFrom, vTo, bibleID, false, 0)
	a.logNavBible(action, citation)
}

func (a *App) applyBible(book, chapter, vFrom, vTo int, bibleID int64, hold bool, scroll float32) {
	a.book, a.chapter = book, chapter
	if book >= 1 {
		a.bookChoice = cite.BookTitle(book)
	}
	if chapter >= 1 {
		a.chapterChoice = fmt.Sprintf("%d", chapter)
	}
	if bibleID != 0 {
		a.preferBible(bibleID)
	}
	changed := true
	if vFrom > 0 {
		if vTo < vFrom {
			vTo = vFrom
		}
		a.focusVerse, a.focusVerseTo = vFrom, vTo
		a.focusVerseOn = !hold
		a.verseAnchor = vFrom
	} else if changed {
		a.focusVerse, a.focusVerseTo = 0, 0
		a.focusVerseOn = false
		a.verseAnchor = 0
	}
	if hold {
		a.holdBibleScroll = true
		a.heldBibleScroll = scroll
		a.bibleScroll.Y = scroll
		a.focusVerseOn = false
	}
}

func (a *App) backBible() {
	place, ok := popHistory(&a.bibleBack)
	if !ok {
		return
	}
	a.bibleFwd = pushHistory(a.bibleFwd, a.snapshotBible())
	a.trans = place.trans
	a.transChoice[0], a.transChoice[1] = "", ""
	a.applyBible(place.book, place.chapter, place.markFrom, place.markTo, 0, true, place.scroll)
	a.logNavBible("back", "")
}

func (a *App) forwardBible() {
	place, ok := popHistory(&a.bibleFwd)
	if !ok {
		return
	}
	a.bibleBack = pushHistory(a.bibleBack, a.snapshotBible())
	a.trans = place.trans
	a.transChoice[0], a.transChoice[1] = "", ""
	a.applyBible(place.book, place.chapter, place.markFrom, place.markTo, 0, true, place.scroll)
	a.logNavBible("forward", "")
}

func (a *App) preferBible(id int64) {
	if a.trans[0] == id || a.trans[1] == id {
		return
	}
	a.trans[0] = id
	a.transChoice[0] = ""
}

func (a *App) logNavPub(action, citation string) {
	pub, _ := a.publication(a.pubID)
	a.log.Info("navigation",
		"pane", "publication",
		"action", action,
		"symbol", pub.Symbol,
		"document_id", a.docID,
		"paragraphs", fmt.Sprintf("%d-%d", a.focusParFrom, a.focusParTo),
		"scroll", a.pubScroll.Y,
		"citation", citation,
	)
}

func (a *App) logNavBible(action, citation string) {
	a.log.Info("navigation",
		"pane", "bible",
		"action", action,
		"book", a.book,
		"chapter", a.chapter,
		"verses", fmt.Sprintf("%d-%d", a.focusVerse, a.focusVerseTo),
		"scroll", a.bibleScroll.Y,
		"citation", citation,
	)
}

func (a *App) parMarked(index int) bool {
	if a.focusParFrom <= 0 {
		return false
	}
	to := a.focusParTo
	if to < a.focusParFrom {
		to = a.focusParFrom
	}
	return index >= a.focusParFrom && index <= to
}

func (a *App) verseMarked(verse int) bool {
	lo, hi, ok := a.markedVerseSpan()
	return ok && verse >= lo && verse <= hi
}

func (a *App) markedVerseSpan() (from, to int, ok bool) {
	if a.focusVerse <= 0 {
		return 0, 0, false
	}
	to = a.focusVerseTo
	if to < a.focusVerse {
		to = a.focusVerse
	}
	return a.focusVerse, to, true
}

func (a *App) historyButtons(c *ui.Context, publication bool) {
	backN, fwdN := len(a.pubBack), len(a.pubFwd)
	if !publication {
		backN, fwdN = len(a.bibleBack), len(a.bibleFwd)
	}
	ui.Row(c).Gap(4).Shrink(0).Children(func() {
		back := ui.Button(c, "Back").Disabled(backN == 0)
		if back.Clicked() {
			if publication {
				a.backPublication()
			} else {
				a.backBible()
			}
		}
		fwd := ui.Button(c, "Forward").Disabled(fwdN == 0)
		if fwd.Clicked() {
			if publication {
				a.forwardPublication()
			} else {
				a.forwardBible()
			}
		}
	})
}

func (a *App) selectVerse(verse int, extend bool) {
	if extend && a.verseAnchor > 0 {
		lo, hi := a.verseAnchor, verse
		if hi < lo {
			lo, hi = hi, lo
		}
		a.focusVerse, a.focusVerseTo = lo, hi
		return
	}
	a.verseAnchor = verse
	a.focusVerse, a.focusVerseTo = verse, verse
}

func pushHistory[T any](s []T, v T) []T {
	s = append(s, v)
	if len(s) > historyLimit {
		s = s[len(s)-historyLimit:]
	}
	return s
}

func popHistory[T any](s *[]T) (T, bool) {
	var zero T
	if len(*s) == 0 {
		return zero, false
	}
	v := (*s)[len(*s)-1]
	*s = (*s)[:len(*s)-1]
	return v, true
}
