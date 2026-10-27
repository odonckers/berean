package read

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/library"
)

const (
	phasePrompt  = "prompt"
	phaseBench   = "bench"
	phaseSetup   = "setup"
	phaseTask    = "task"
	phaseDebrief = "debrief"
	phaseDone    = "done"

	benchMessage = "Measuring performance…"

	studyPrompt = "Study the question: what is the issue of sovereignty, and where do Jehovah and you fit in it? Start from the Research Guide. Build a canvas you'd actually keep."

	debriefHardestQ  = "What was hardest? What did you expect to happen that didn't?"
	debriefComeBackQ = "Is this canvas something you'd come back to for this study? Why or why not?"
)

type studyNeed struct {
	title, symbol string
	match         func(library.PublicationInfo) bool
}

func (n studyNeed) label() string { return n.title + " (" + n.symbol + ")" }

func requiredPubs() []studyNeed {
	return []studyNeed{
		{"Insight on the Scriptures Vol. 2", "it-2", pubIsInsight},
		{"Worship the Only True God", "wt", pubIsWorship},
		{"The Watchtower, June 2017", "w17.06", pubIsJune2017},
	}
}

func pubIsInsight(p library.PublicationInfo) bool {
	s, c := strings.ToLower(p.Symbol), strings.ToLower(p.CiteSymbol)
	return s == "it" || s == "it-2" || c == "it" || c == "it-2"
}

func pubIsWorship(p library.PublicationInfo) bool {
	s, c := strings.ToLower(p.Symbol), strings.ToLower(p.CiteSymbol)
	return s == "wt" || c == "wt"
}

func pubIsJune2017(p library.PublicationInfo) bool {
	s, c := strings.ToLower(p.Symbol), strings.ToLower(p.CiteSymbol)
	ok := s == "w" || s == "w17" || s == "w17.06" || c == "w" || c == "w17" || c == "w17.06"
	return ok && p.Year == 2017 && p.Month == 6
}

// beginStudy opens a study session. The first line of a new log is the
// header, including a bench result measured when the saved one is stale.
// Reopening a session continues the phase the log already reached.
func (a *App) beginStudy() {
	a.studyOn = true
	path := a.studyPath()
	lines, err := studyLines(path)
	if err != nil {
		a.log.Error("study log", "err", err)
	}
	if len(lines) == 0 {
		if b, ok := a.recentBench(); ok {
			a.finishBench(b, time.Time{}, time.Time{})
			return
		}
		a.phase = phaseBench
		return
	}
	a.phase = inferPhase(lines)
}

// recentBench is a saved result for this version and card count from the last day.
func (a *App) recentBench() (benchResult, bool) {
	path := a.benchPath()
	if path == "" {
		return benchResult{}, false
	}
	b, ok := readBench(path)
	if !ok || !b.recent() {
		return benchResult{}, false
	}
	return b, true
}

// finishBench writes the log header, then the bench phase when this session
// measured one. A reused result has no bench phase: that time already passed.
func (a *App) finishBench(b benchResult, started, ended time.Time) {
	a.writeHeader(b)
	if !started.IsZero() && !ended.IsZero() {
		a.logPhaseAt(phaseBench, "start", started)
		a.logPhaseAt(phaseBench, "end", ended)
	}
	a.writeStudy(map[string]any{"event": "study_start"})
	a.phase = phasePrompt
}

func (a *App) studyGate(c *ui.Context) bool {
	if !a.studyOn {
		return false
	}
	switch a.phase {
	case phaseBench:
		if a.benchReady {
			started := a.now()
			b := measureBench(a.log)
			ended := a.now()
			if path := a.benchPath(); path != "" {
				if err := writeBench(path, b); err != nil {
					a.log.Error("bench save", "err", err)
				}
			}
			a.finishBench(b, started, ended)
		} else {
			a.benchReady = true
		}
		if a.phase == phaseBench {
			a.benchView(c)
			return true
		}
		fallthrough
	case phasePrompt:
		a.promptView(c)
		return true
	case phaseSetup:
		a.setupView(c)
		return true
	case phaseDebrief:
		a.debriefView(c)
		return true
	default:
		return false
	}
}

func (a *App) benchView(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Padding(32).Gap(14).Background(t.Background).Children(func() {
		ui.Text(c, "Berean").FontSize(22).Bold()
		ui.Text(c, benchMessage).FontSize(16)
	})
}

func (a *App) promptView(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Padding(32).Gap(14).Background(t.Background).Children(func() {
		ui.Text(c, "Berean").FontSize(22).Bold()
		ui.Text(c, studyPrompt).FontSize(16).LineHeight(1.4).FillWidth()
		label := "Show steps"
		if a.showSteps {
			label = "Hide steps"
		}
		if ui.Button(c, label).Clicked() {
			a.showSteps = !a.showSteps
		}
		if a.showSteps {
			a.stepList(c)
		}
		if ui.Button(c, "Continue").Clicked() {
			a.phase = phaseSetup
			a.logPhase(phaseSetup, "start")
		}
	})
}

func (a *App) stepList(c *ui.Context) {
	t := c.Theme()
	steps := []string{
		"1. Open the Research Guide from the publication menu and find the sovereignty topic.",
		"2. Follow a link into Insight on the Scriptures, “Sovereignty”. Drag the paragraph onto the canvas.",
		"3. Press the Back button to return to the Research Guide. Open Worship the Only True God, chapter 6, and drag paragraph 2 onto the canvas.",
		"4. Open Genesis 3:1-5. Drag it onto the canvas from each translation, then drag the two clips side by side.",
		"5. Drag Jeremiah 10:23 onto the canvas, and one more passage.",
		"6. Press New note. Write two or three sentences with one citation, then press Done.",
		"7. Pan and zoom the canvas.",
		"8. When your canvas is done, press Finish study.",
	}
	ui.Column(c).FillWidth().Gap(6).Children(func() {
		for _, s := range steps {
			ui.Text(c, s).FontSize(14).LineHeight(1.35).TextColor(t.TextMuted).FillWidth()
		}
	})
}

func (a *App) setupView(c *ui.Context) {
	a.takePending()
	t := c.Theme()
	col := ui.Column(c).Fill().Padding(32).Gap(12).Background(t.Background)
	col.Children(func() {
		ui.Text(c, "Import these publications before the study.").FontSize(18).Bold()
		ui.Text(c, "Drag a .jwpub file onto this screen, or use Choose files. Nothing is downloaded.").
			FontSize(14).TextColor(t.TextMuted).FillWidth()
		missing := a.missingNeeds()
		have := map[string]bool{}
		for _, n := range requiredPubs() {
			if !containsNeed(missing, n.label()) {
				have[n.label()] = true
			}
		}
		for _, n := range requiredPubs() {
			label := n.label()
			if have[label] {
				label = "✓ " + label
			}
			ui.Text(c, label).FontSize(16)
		}
		if len(missing) > 0 {
			ui.Text(c, joinMissing(missing)).FontSize(14).TextColor(t.Danger).FillWidth()
		}
		if a.setupNote != "" {
			ui.Text(c, a.setupNote).FontSize(14).TextColor(t.Danger).FillWidth()
		}
		if files := col.DroppedFiles(); len(files) > 0 {
			a.importFiles(files, nil)
		}
		if ui.Button(c, "Choose files").Clicked() {
			a.chooseFiles(c.Services())
		}
		start := ui.Button(c, "Start").Disabled(len(missing) > 0)
		if start.Clicked() {
			a.prepareTask()
		}
	})
}

func containsNeed(missing []string, label string) bool {
	for _, m := range missing {
		if m == label {
			return true
		}
	}
	return false
}

func (a *App) missingNeeds() []string {
	var missing []string
	pubs := append(append([]library.PublicationInfo{}, a.articles...), a.bibles...)
	for _, n := range requiredPubs() {
		found := false
		for _, p := range pubs {
			if n.match(p) {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, n.label())
		}
	}
	return missing
}

func joinMissing(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return "Still missing: " + names[0] + "."
	case 2:
		return "Still missing: " + names[0] + " and " + names[1] + "."
	default:
		return "Still missing: " + strings.Join(names[:len(names)-1], ", ") + ", and " + names[len(names)-1] + "."
	}
}

func (a *App) chooseFiles(svc ui.Services) {
	if a.pickFiles != nil {
		paths, err := a.pickFiles()
		a.importFiles(paths, err)
		return
	}
	go func() {
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
			Title:    "Import publications",
			Multiple: true,
			Filters:  []mygo.FileFilter{{Name: "JWPUB", Extensions: []string{"jwpub"}}},
		})
		a.importMu.Lock()
		a.pendingPaths = paths
		a.pendingErr = err
		a.havePending = true
		a.importMu.Unlock()
		svc.Invalidate()
	}()
}

func (a *App) takePending() {
	a.importMu.Lock()
	if !a.havePending {
		a.importMu.Unlock()
		return
	}
	paths, err := a.pendingPaths, a.pendingErr
	a.pendingPaths, a.pendingErr, a.havePending = nil, nil, false
	a.importMu.Unlock()
	a.importFiles(paths, err)
}

func (a *App) importFiles(paths []string, err error) {
	if err != nil {
		a.setupNote = err.Error()
		a.logShownError("", a.setupNote)
		return
	}
	note := ""
	for _, path := range paths {
		if _, ierr := a.lib.Import(context.Background(), path); ierr != nil {
			note = ierr.Error()
			a.logShownError("", note)
		}
	}
	a.reloadCatalog()
	a.setupNote = note
}

func (a *App) prepareTask() {
	if len(a.missingNeeds()) > 0 {
		return
	}
	if a.pubID == 0 && len(a.articles) > 0 {
		a.pubID = a.articles[0].ID
	}
	if a.trans[0] == 0 {
		for i := 0; i < len(a.bibles) && i < 2; i++ {
			a.trans[i] = a.bibles[i].ID
		}
		a.transChoice[0], a.transChoice[1] = "", ""
	}
	a.logPhase(phaseSetup, "end")
	a.phase = phaseTask
	a.logPhase(phaseTask, "start")
}

func (a *App) finishTask() {
	if a.phase != phaseTask {
		return
	}
	a.finishNote()
	a.logPhase(phaseTask, "end")
	a.phase = phaseDebrief
}

func (a *App) debriefView(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Padding(32).Gap(12).Background(t.Background).Children(func() {
		ui.Text(c, "Debrief").FontSize(22).Bold()
		ui.Text(c, debriefHardestQ).FontSize(15).FillWidth()
		ui.TextArea(c, &a.hardest).Label("Hardest").Lines(4, 8).FillWidth()
		ui.Text(c, debriefComeBackQ).FontSize(15).FillWidth()
		ui.TextArea(c, &a.comeBack).Label("Come back").Lines(4, 8).FillWidth()
		if a.setupNote != "" {
			ui.Text(c, a.setupNote).FontSize(14).TextColor(t.Danger)
		}
		if ui.Button(c, "Save").Clicked() {
			a.saveDebrief()
		}
	})
}

type debriefFile struct {
	Hardest  string `json:"hardest"`
	ComeBack string `json:"come_back"`
}

func (a *App) saveDebrief() {
	raw, err := json.MarshalIndent(debriefFile{Hardest: a.hardest, ComeBack: a.comeBack}, "", "  ")
	if err != nil {
		a.setupNote = err.Error()
		return
	}
	raw = append(raw, '\n')
	if err := writeAtomic(a.debriefPath(), raw); err != nil {
		a.setupNote = err.Error()
		a.logShownError("", err.Error())
		return
	}
	a.writeStudy(map[string]any{"event": "study_end"})
	a.phase = phaseDone
	a.setupNote = ""
}

func (a *App) reloadCatalog() {
	if a.lib == nil {
		return
	}
	pubs, err := a.lib.Publications(context.Background())
	if err != nil {
		a.log.Error("catalog", "err", err)
		a.logShownError("", err.Error())
		return
	}
	a.articles, a.bibles = nil, nil
	for _, p := range pubs {
		if p.Type == "Bible" {
			a.bibles = append(a.bibles, p)
		} else {
			a.articles = append(a.articles, p)
		}
	}
	a.articleLabels = publicationLabels(a.articles)
	a.bibleLabels = biblePickerLabels(a.bibles)
}

// errorLine starts an error with the citation it is about. A message that
// already starts with the citation is left as the library wrote it.
func errorLine(citation, msg string) string {
	if citation == "" || strings.HasPrefix(msg, citation) {
		return msg
	}
	return citation + ": " + msg
}
