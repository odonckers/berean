package read

import (
	"math"

	"github.com/egoist/mygo/ui"
)

const (
	canvasWorld = 12000
	cardWidth   = 300
)

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
			ui.Text(c, "Drag a paragraph or verse here").Absolute().Left(24).Top(20).
				FontSize(14).TextColor(t.TextMuted)
		}
		if p, ok := ui.Drop[passage](viewport); ok {
			a.acceptClip(viewport, p)
		}
	})
}

func (a *App) cardView(c *ui.Context, i int) {
	clip := a.cards[i]
	t := c.Theme()
	id := clip.ID
	ui.Column(c.Key(id)).Absolute().Left(clip.X).Top(clip.Y).Width(cardWidth).
		Padding(10, 12).Gap(6).Background(t.Surface).Border(1, t.Border).Radius(8).
		Cursor(ui.CursorMove).
		HandleInput(func(ev ui.InputEvent) bool { return a.cardInput(id, ev) }).
		Children(func() {
			ui.Text(c, clip.Text).FontSize(14.5).LineHeight(1.4)
			link := ui.Text(c, clip.Citation).FontSize(13).TextColor(t.Accent).Underline().Cursor(ui.CursorPointer)
			link.HandleInput(func(ev ui.InputEvent) bool { return a.citationInput(id, ev) })
			if link.Clicked() {
				a.openClip(a.cardByID(id))
			}
		})
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

func (a *App) acceptClip(viewport ui.Element, p passage) {
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
	a.cards = append(a.cards, clip)
	a.log.Info("clip created", "kind", clip.Kind, "citation", clip.Citation)
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

// citationInput lets a click reach the citation and still pans or zooms
// when the pointer is over it.
func (a *App) citationInput(id int64, ev ui.InputEvent) bool {
	switch ev.Kind {
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
