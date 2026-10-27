package read

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sort"
	"time"

	"github.com/egoist/mygo/ui"
)

const (
	rendererName = "CPU software renderer"
	benchCards   = 200
	benchFrames  = 60
	benchFresh   = 24 * time.Hour
)

// actionStats is one action's frame times, matching the test budget:
// p50 is the middle sample, p95 is index (n*95)/100, after the first layout.
type actionStats struct {
	P50 time.Duration
	P95 time.Duration
	Max time.Duration
}

func (s actionStats) withinBudget() bool {
	return s.P95 <= 167*time.Millisecond/10 && s.Max <= 33*time.Millisecond
}

type benchResult struct {
	At       time.Time
	Version  string
	Renderer string
	Cards    int
	Pan      actionStats
	Zoom     actionStats
}

func (b benchResult) recent() bool {
	if b.Cards != benchCards || b.Version != Version || b.Renderer == "" || b.At.IsZero() {
		return false
	}
	age := time.Since(b.At)
	return age >= 0 && age <= benchFresh
}

type benchDisk struct {
	At       time.Time `json:"at"`
	Version  string    `json:"version"`
	Renderer string    `json:"renderer"`
	Cards    int       `json:"cards"`
	Pan      statDisk  `json:"pan"`
	Zoom     statDisk  `json:"zoom"`
}

type statDisk struct {
	P50 float64 `json:"p50_ms"`
	P95 float64 `json:"p95_ms"`
	Max float64 `json:"max_ms"`
}

func (s actionStats) disk() statDisk {
	return statDisk{P50: ms(s.P50), P95: ms(s.P95), Max: ms(s.Max)}
}

func (d statDisk) stats() actionStats {
	return actionStats{P50: fromMS(d.P50), P95: fromMS(d.P95), Max: fromMS(d.Max)}
}

func ms(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }

func fromMS(v float64) time.Duration {
	return time.Duration(v * float64(time.Millisecond))
}

func (b benchResult) disk() benchDisk {
	return benchDisk{
		At: b.At, Version: b.Version, Renderer: b.Renderer, Cards: b.Cards,
		Pan: b.Pan.disk(), Zoom: b.Zoom.disk(),
	}
}

func (d benchDisk) result() benchResult {
	return benchResult{
		At: d.At, Version: d.Version, Renderer: d.Renderer, Cards: d.Cards,
		Pan: d.Pan.stats(), Zoom: d.Zoom.stats(),
	}
}

func (a *App) benchPath() string {
	if a.lib == nil {
		return ""
	}
	return siblingPath(a.lib.Path(), ".bench.json")
}

func readBench(path string) (benchResult, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return benchResult{}, false
	}
	var d benchDisk
	if err := json.Unmarshal(raw, &d); err != nil {
		return benchResult{}, false
	}
	return d.result(), true
}

func writeBench(path string, b benchResult) error {
	raw, err := json.MarshalIndent(b.disk(), "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return writeAtomic(path, raw)
}

// ensureBench returns a bench result for this version and card count from
// the last day, measuring one when the file is missing or stale.
func (a *App) ensureBench() benchResult {
	path := a.benchPath()
	if path != "" {
		if b, ok := readBench(path); ok && b.recent() {
			return b
		}
	}
	b := measureBench(a.log)
	if path != "" {
		if err := writeBench(path, b); err != nil {
			a.log.Error("bench save", "err", err)
		}
	}
	return b
}

// CommandBench prints the pan and zoom summary and stores the result beside
// the database. It returns an error when a frame misses the budget.
func CommandBench(w io.Writer, log *slog.Logger, dbPath string) error {
	if log == nil {
		log = slog.Default()
	}
	b := measureBench(log)
	if dbPath != "" {
		if err := writeBench(siblingPath(dbPath, ".bench.json"), b); err != nil {
			return err
		}
	}
	printBench(w, b)
	if !b.Pan.withinBudget() || !b.Zoom.withinBudget() {
		return fmt.Errorf("frame budget missed: p95 <= 16.7ms and no frame over 33ms")
	}
	return nil
}

func printBench(w io.Writer, b benchResult) {
	fmt.Fprintf(w, "renderer: %s\n", b.Renderer)
	fmt.Fprintf(w, "pan: p50=%s p95=%s max=%s (%d cards)\n", b.Pan.P50, b.Pan.P95, b.Pan.Max, b.Cards)
	fmt.Fprintf(w, "zoom: p50=%s p95=%s max=%s (%d cards)\n", b.Zoom.P50, b.Zoom.P95, b.Zoom.Max, b.Cards)
}

// measureBench paints 200 cards and times pan and zoom. The first layout
// frame is not part of either sample.
func measureBench(log *slog.Logger) benchResult {
	if log == nil {
		log = slog.Default()
	}
	app := &App{
		log:       log,
		zoom:      1,
		paneSplit: 50,
		laidOut:   map[int64][2]float32{},
		boxes:     map[int64]cardBox{},
		citeCache: map[string]citeMemo{},
		noteCache: map[string][]notePara{},
		openChip:  map[string]bool{},
		cards:     make([]Clip, benchCards),
	}
	for i := range app.cards {
		app.cards[i] = Clip{
			ID: int64(i + 1), Kind: kindBible, Citation: "Gen. 1:1",
			Text: "1 A short line of synthetic text.", Symbol: "nwt",
			X: float32(i%20) * 32, Y: float32(i/20) * 36,
			Book: 1, Chapter: 1, Verse: 1, VerseTo: 1,
		}
		if i%5 == 0 {
			app.cards[i].Kind = kindNote
			app.cards[i].Citation = ""
			app.cards[i].Text = ""
			app.cards[i].Symbol = ""
			app.cards[i].Markdown = "A note."
		}
	}
	app.nextClip = benchCards
	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	pan := measureAction(log, tt, "pan", benchFrames, func() {
		app.panX += 18
		app.panY += 11
	})
	zoom := measureAction(log, tt, "zoom", benchFrames, func() {
		app.zoom += 0.04
		if app.zoom > 2.4 {
			app.zoom = 0.55
		}
	})
	return benchResult{
		At: time.Now().UTC(), Version: Version, Renderer: rendererName,
		Cards: benchCards, Pan: pan, Zoom: zoom,
	}
}

func measureAction(log *slog.Logger, tt *ui.Tester, action string, n int, step func()) actionStats {
	d := make([]time.Duration, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		step()
		tt.Frame()
		d[i] = time.Since(start)
		log.Info("frame", "action", action, "i", i, "duration", d[i])
	}
	sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
	return actionStats{P50: d[n/2], P95: d[(n*95)/100], Max: d[n-1]}
}
