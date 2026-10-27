package read

import (
	"bufio"
	"encoding/json"
	"os"
	"runtime"
	"time"
)

func (a *App) studyPath() string {
	if a.lib == nil {
		return ""
	}
	return siblingPath(a.lib.Path(), ".study.jsonl")
}

func (a *App) debriefPath() string {
	if a.lib == nil {
		return ""
	}
	return siblingPath(a.lib.Path(), ".debrief.json")
}

func (a *App) now() time.Time {
	if a.clock != nil {
		return a.clock()
	}
	return time.Now()
}

// writeStudy appends one JSON object. It does nothing outside a study session.
func (a *App) writeStudy(ev map[string]any) {
	if !a.studyOn {
		return
	}
	path := a.studyPath()
	if path == "" {
		return
	}
	if _, ok := ev["time"]; !ok {
		ev["time"] = a.now().UTC().Format(time.RFC3339Nano)
	}
	raw, err := json.Marshal(ev)
	if err != nil {
		a.log.Error("study log", "err", err)
		return
	}
	raw = append(raw, '\n')
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		a.log.Error("study log", "err", err)
		return
	}
	defer f.Close()
	if _, err := f.Write(raw); err != nil {
		a.log.Error("study log", "err", err)
	}
}

func (a *App) writeHeader(b benchResult) {
	a.writeStudy(map[string]any{
		"event":    "header",
		"os":       runtime.GOOS,
		"arch":     runtime.GOARCH,
		"version":  Version,
		"renderer": rendererName,
		"bench": map[string]any{
			"cards": b.Cards,
			"pan":   statJSON(b.Pan),
			"zoom":  statJSON(b.Zoom),
		},
	})
}

func statJSON(s actionStats) map[string]any {
	return map[string]any{"p50_ms": ms(s.P50), "p95_ms": ms(s.P95), "max_ms": ms(s.Max)}
}

func (a *App) logCardCreated(clip Clip) {
	a.writeStudy(map[string]any{
		"event":       "card_created",
		"card_id":     clip.ID,
		"kind":        clip.Kind,
		"citation":    clip.Citation,
		"translation": clip.Symbol,
	})
	if clip.Kind == kindNote {
		return
	}
	a.writeStudy(map[string]any{
		"event":    "clip_created",
		"citation": clip.Citation,
		"source":   clip.Symbol,
	})
}

func (a *App) logCardDrag(id int64, x0, y0, x1, y1 float32) {
	a.writeStudy(map[string]any{
		"event":   "card_drag",
		"card_id": id,
		"x0":      x0,
		"y0":      y0,
		"x1":      x1,
		"y1":      y1,
		"zoom":    a.zoom,
	})
}

func (a *App) logBack(pane string) {
	a.writeStudy(map[string]any{"event": "back", "pane": pane})
}

func (a *App) logCitationOpened(citation string, cardID int64) {
	ev := map[string]any{"event": "citation_opened", "citation": citation}
	if cardID != 0 {
		ev["card_id"] = cardID
	}
	a.writeStudy(ev)
}

func (a *App) logCitationInserted(citation string) {
	a.writeStudy(map[string]any{"event": "citation_inserted", "citation": citation})
}

func (a *App) logLinkFollowed(href string) {
	a.writeStudy(map[string]any{"event": "link_followed", "href": href})
}

func (a *App) logRSGOpened(docID int) {
	a.writeStudy(map[string]any{"event": "rsg_opened", "document_id": docID})
}

// logShownError records an error the user can see, once per distinct line.
func (a *App) logShownError(citation, message string) {
	if message == "" || !a.studyOn {
		return
	}
	if a.seenStudy == nil {
		a.seenStudy = map[string]bool{}
	}
	if a.seenStudy[message] {
		return
	}
	a.seenStudy[message] = true
	ev := map[string]any{"event": "error", "message": message}
	if citation != "" {
		ev["citation"] = citation
	}
	a.writeStudy(ev)
}

func (a *App) logPhase(phase, boundary string) {
	a.writeStudy(map[string]any{"event": "phase", "phase": phase, "boundary": boundary})
}

// studyLines reads the log. A missing file is an empty session.
func studyLines(path string) ([]map[string]any, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()
	var out []map[string]any
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev map[string]any
		if err := json.Unmarshal(line, &ev); err != nil {
			return out, err
		}
		out = append(out, ev)
	}
	return out, sc.Err()
}

func inferPhase(lines []map[string]any) string {
	phase := phasePrompt
	for _, ev := range lines {
		switch str(ev["event"]) {
		case "study_end":
			return phaseDone
		case "phase":
			switch str(ev["phase"]) + " " + str(ev["boundary"]) {
			case "setup start":
				phase = phaseSetup
			case "task start":
				phase = phaseTask
			case "task end":
				phase = phaseDebrief
			}
		}
	}
	return phase
}

func str(v any) string {
	s, _ := v.(string)
	return s
}
