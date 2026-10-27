package read

import (
	"fmt"
	"math"

	"github.com/egoist/mygo/ui"
)

const (
	canvasWorld = 12000
	cardWidth   = 300
	nudgeStepX  = 16
	nudgeStepY  = 36
	nudgeLimit  = 48
)

// cardBox is the last measured size of a card. header is the band at the
// top that a later card must leave uncovered.
type cardBox struct {
	w, h, header float32
}

// canvas is the pannable, zoomable centre. A passage dropped on it becomes
// a clip card. Dragging a card does not pan: the card takes the pointer.
func (a *App) canvas(c *ui.Context) {
	t := c.Theme()
	if a.zoom == 0 {
		a.zoom = 1
	}
	viewport := ui.Box(c).Grow(1).FillHeight().Clip().Background(t.Background).HandleInput(a.canvasInput)
	if a.panning {
		viewport.Cursor(ui.CursorGrabbing)
	} else {
		viewport.Cursor(ui.CursorGrab)
	}
	if _, over := ui.DragOver[passage](viewport); over {
		viewport.Background(t.Accent.Alpha(0.08))
	}
	viewport.Children(func() {
		ui.Box(c).Absolute().Left(0).Top(0).Width(canvasWorld).Height(canvasWorld).
			TransformOrigin(0, 0).Translate(a.panX, a.panY).Scale(a.zoom, a.zoom).
			Children(func() {
				for i := range a.cards {
					a.cardView(c, i)
				}
			})
		if len(a.cards) == 0 {
			ui.Text(c, "Drag a paragraph or verse onto the canvas.").Absolute().Left(24).Top(20).
				FontSize(14).TextColor(t.TextMuted)
		}
		add := ui.Button(c, "New note").Absolute().Right(16).Top(12)
		add.HandleInput(func(ui.InputEvent) bool { return false })
		if add.Clicked() {
			a.addNote(c)
		}
		if p, ok := ui.Drop[passage](viewport); ok {
			a.acceptClip(c, viewport, p)
		}
	})
}

func (a *App) cardView(c *ui.Context, i int) {
	clip := a.cards[i]
	if clip.Kind == kindNote {
		a.noteCard(c, i)
		return
	}
	t := c.Theme()
	id := clip.ID
	ui.Column(c.Key(id)).Label(fmt.Sprintf("card %d", id)).Absolute().Left(clip.X).Top(clip.Y).Width(cardWidth).
		Padding(10, 12).Gap(6).Background(t.Surface).Border(1, t.Border).Radius(8).
		Cursor(ui.CursorMove).
		HandleInput(func(ev ui.InputEvent) bool { return a.cardInput(id, ev) }).
		Children(func() {
			link := ui.Text(c, clip.Citation).FontSize(15).Bold().TextColor(t.Accent).Underline().Cursor(ui.CursorPointer)
			link.HandleInput(func(ev ui.InputEvent) bool { return a.passClick(id, ev) })
			if link.Clicked() {
				a.openClip(a.cardByID(id))
			}
			ui.Text(c, clip.Text).FontSize(14.5).LineHeight(1.4)
		})
	a.rememberBox(c, a.cards[i])
	if a.laidOut == nil {
		a.laidOut = map[int64][2]float32{}
	}
	// The next gesture's pointer coordinates are relative to this frame's place.
	a.laidOut[id] = [2]float32{a.cards[i].X, a.cards[i].Y}
}

func (a *App) cardByID(id int64) Clip {
	for _, c := range a.cards {
		if c.ID == id {
			return c
		}
	}
	return Clip{}
}

func (a *App) acceptClip(c *ui.Context, viewport ui.Element, p passage) {
	x, y, ok := viewport.PointerPosition()
	if !ok {
		x, y = 72, 72
	}
	z := a.zoom
	if z == 0 {
		z = 1
	}
	clip := p.Clip
	a.nextClip++
	clip.ID = a.nextClip
	clip.X = (x-a.panX)/z - 28
	clip.Y = (y-a.panY)/z - 18
	a.nudge(c, &clip)
	a.cards = append(a.cards, clip)
	a.log.Info("clip created", "kind", clip.Kind, "citation", clip.Citation)
}

// nudge shifts a new card down and to the right until it does not cover
// another card's header. The header stays inside the canvas; a tall
// paragraph can hang below it.
func (a *App) nudge(c *ui.Context, clip *Clip) {
	ox, oy := clip.X, clip.Y
	for n := 0; n <= nudgeLimit; n++ {
		clip.X = ox + float32(n)*nudgeStepX
		clip.Y = oy + float32(n)*nudgeStepY
		if !a.headerOnCanvas(clip) {
			clip.X = ox
		}
		if !a.blocked(c, clip) && a.headerOnCanvas(clip) {
			return
		}
	}
	clip.X, clip.Y = ox, oy
}

// headerOnCanvas reports that the card's header band is inside the canvas
// viewport, with a small margin so the citation is not clipped.
func (a *App) headerOnCanvas(clip *Clip) bool {
	z := a.zoom
	if z == 0 {
		z = 1
	}
	box := a.cardBoxOf(nil, clip)
	header := box.header
	if header < 28 {
		header = 36
	}
	const margin = float32(8)
	viewW := float32(1440 - leftWidth - 1)
	viewH := float32(900)
	left := a.panX + clip.X*z
	top := a.panY + clip.Y*z
	right := left + cardWidth*z
	bottom := top + header*z
	return left >= margin && top >= margin && right <= viewW-margin && bottom <= viewH-margin
}

func (a *App) blocked(c *ui.Context, clip *Clip) bool {
	mine := a.cardBoxOf(c, clip)
	me := frect{clip.X, clip.Y, mine.w, mine.h}
	for i := range a.cards {
		other := &a.cards[i]
		if other.ID == clip.ID {
			continue
		}
		box := a.cardBoxOf(c, other)
		them := frect{other.X, other.Y, box.w, box.h}
		head := frect{other.X, other.Y, box.w, box.header}
		// Covering a header hides the citation. A card dropped on a tall
		// paragraph only has to clear that band: its own header paints
		// above the paragraph. Two cards of the same size still separate,
		// so one does not sit entirely on the other.
		sameSize := containsRect(them, me) && box.h <= mine.h+nudgeStepY
		if intersects(me, head) || containsRect(me, them) || sameSize {
			return true
		}
	}
	return false
}

func (a *App) cardBoxOf(c *ui.Context, clip *Clip) cardBox {
	if clip.ID != 0 && a.boxes != nil {
		if b, ok := a.boxes[clip.ID]; ok && b.h > 0 {
			return b
		}
	}
	return a.estimateBox(c, clip)
}

func (a *App) estimateBox(c *ui.Context, clip *Clip) cardBox {
	headerText := clip.Citation
	if clip.Kind == kindNote {
		headerText = "Note"
	}
	hh := float32(20)
	body := float32(48)
	if c != nil {
		if _, h := c.MeasureText(cardWidth-24, ui.Span{Text: headerText, Size: 15}); h > 8 {
			hh = h
		}
		sample := clip.Text
		if clip.Kind == kindNote {
			sample = unlinkCitations(clip.Markdown)
			if sample == "" {
				sample = " "
			}
		}
		if _, h := c.MeasureText(cardWidth-24, ui.Span{Text: sample, Size: 14.5}); h > 0 {
			body = h * 1.45
		}
	}
	if clip.Kind == kindNote && a.editingNote == clip.ID {
		body += 96
	}
	header := 10 + hh + 8
	return cardBox{w: cardWidth, h: header + 6 + body + 16, header: header}
}

func (a *App) rememberBox(c *ui.Context, clip Clip) {
	if a.boxes == nil {
		a.boxes = map[int64]cardBox{}
	}
	a.boxes[clip.ID] = a.estimateBox(c, &clip)
}

type frect struct{ x, y, w, h float32 }

func intersects(a, b frect) bool {
	return a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 &&
		a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h
}

func containsRect(outer, inner frect) bool {
	return inner.x >= outer.x && inner.y >= outer.y &&
		inner.x+inner.w <= outer.x+outer.w && inner.y+inner.h <= outer.y+outer.h
}

func (a *App) bringToFront(id int64) {
	for i := range a.cards {
		if a.cards[i].ID != id {
			continue
		}
		if i == len(a.cards)-1 {
			return
		}
		card := a.cards[i]
		a.cards = append(append(a.cards[:i], a.cards[i+1:]...), card)
		return
	}
}

func (a *App) openClip(clip Clip) {
	switch clip.Kind {
	case kindBible:
		to := clip.VerseTo
		if to < clip.Verse {
			to = clip.Verse
		}
		a.goBible(clip.Book, clip.Chapter, clip.Verse, to, clip.BibleID, "open", clip.Citation)
	case kindPublication:
		to := clip.PIDTo
		if to < clip.PID {
			to = clip.PID
		}
		a.goPublication(clip.PubID, clip.DocID, clip.PID, to, true, "open", clip.Citation)
	}
}

func (a *App) canvasInput(ev ui.InputEvent) bool {
	switch ev.Kind {
	case ui.InputPointerDown:
		a.panning = true
		a.panLX, a.panLY = ev.X, ev.Y
	case ui.InputPointerMove:
		if a.panning && ev.Button >= 0 {
			a.panX += ev.X - a.panLX
			a.panY += ev.Y - a.panLY
			a.panLX, a.panLY = ev.X, ev.Y
		}
	case ui.InputPointerUp:
		if a.panning {
			a.panning = false
			a.log.Info("canvas", "action", "pan", "x", a.panX, "y", a.panY, "zoom", a.zoom)
		}
	case ui.InputScroll:
		a.scrollZoom(ev, ev.X, ev.Y, ev.DX, ev.DY)
	case ui.InputZoom:
		a.zoomAt(ev.X, ev.Y, ev.Scale)
		a.log.Info("canvas", "action", "zoom", "zoom", a.zoom, "x", ev.X, "y", ev.Y)
	default:
		return false
	}
	return true
}

// cardInput moves the card. Scroll and pinch over it still pan and zoom the
// canvas; the card's coordinates are content space, so deltas are scaled.
func (a *App) cardInput(id int64, ev ui.InputEvent) bool {
	switch ev.Kind {
	case ui.InputPointerDown:
		a.bringToFront(id)
		a.movingCard = id
		a.grabX, a.grabY = ev.X, ev.Y
		return true
	case ui.InputPointerMove:
		if a.movingCard != id || ev.Button < 0 {
			return true
		}
		origin, ok := a.laidOut[id]
		if !ok {
			return true
		}
		for i := range a.cards {
			if a.cards[i].ID != id {
				continue
			}
			a.cards[i].X = origin[0] + ev.X - a.grabX
			a.cards[i].Y = origin[1] + ev.Y - a.grabY
		}
		return true
	case ui.InputPointerUp:
		if a.movingCard == id {
			a.movingCard = 0
		}
		return true
	case ui.InputScroll, ui.InputZoom:
		a.gestureFromCard(id, ev)
		return true
	default:
		return false
	}
}

// passClick brings the card forward and lets the click through. Scroll and
// pinch over the control still pan and zoom the canvas.
func (a *App) passClick(id int64, ev ui.InputEvent) bool {
	switch ev.Kind {
	case ui.InputPointerDown:
		a.bringToFront(id)
		return false
	case ui.InputScroll, ui.InputZoom:
		a.gestureFromCard(id, ev)
		return true
	default:
		return false
	}
}

func (a *App) gestureFromCard(id int64, ev ui.InputEvent) {
	vx, vy := a.cardViewport(id, ev.X, ev.Y)
	z := a.zoom
	if z == 0 {
		z = 1
	}
	switch ev.Kind {
	case ui.InputScroll:
		a.scrollZoom(ev, vx, vy, ev.DX*z, ev.DY*z)
	case ui.InputZoom:
		a.zoomAt(vx, vy, ev.Scale)
		a.log.Info("canvas", "action", "zoom", "zoom", a.zoom, "x", vx, "y", vy)
	}
}

func (a *App) cardViewport(id int64, x, y float32) (float32, float32) {
	origin := a.laidOut[id]
	z := a.zoom
	if z == 0 {
		z = 1
	}
	return a.panX + (origin[0]+x)*z, a.panY + (origin[1]+y)*z
}

func (a *App) scrollZoom(ev ui.InputEvent, x, y, dx, dy float32) {
	if ev.Mods&ui.Ctrl != 0 {
		a.zoomAt(x, y, float32(math.Pow(1.002, float64(-dy))))
		a.log.Info("canvas", "action", "zoom", "zoom", a.zoom, "x", x, "y", y)
		return
	}
	a.panX -= dx
	a.panY -= dy
}

// zoomAt keeps the canvas point under (x, y) fixed. x and y are viewport DIPs.
func (a *App) zoomAt(x, y, f float32) {
	if a.zoom == 0 {
		a.zoom = 1
	}
	if f <= 0 {
		return
	}
	nz := min(max(a.zoom*f, 0.2), 4)
	if nz == a.zoom {
		return
	}
	f = nz / a.zoom
	a.panX = x - (x-a.panX)*f
	a.panY = y - (y-a.panY)*f
	a.zoom = nz
}
