package read

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/odonckers/berean/internal/library"
)

func TestErrorLineStartsWithCitation(t *testing.T) {
	if got := errorLine("w23.01 p. 5 par. 3", "w23.01 p. 5 par. 3: par. 3 is on pp. 2"); got != "w23.01 p. 5 par. 3: par. 3 is on pp. 2" {
		t.Fatalf("already prefixed: %q", got)
	}
	got := errorLine("w23.13 p. 2 par. 1", `Couldn't read the citation "w23.13 p. 2 par. 1".`)
	want := `w23.13 p. 2 par. 1: Couldn't read the citation "w23.13 p. 2 par. 1".`
	if got != want {
		t.Fatalf("error line %q", got)
	}
}

func TestBrokenChipAfterDone(t *testing.T) {
	wPath := mustFixture(t, "w", "202301", "w_E_202301.jwpub", "52e756833e0fcd9183eb5d2c0bcd3437")
	lib, err := library.Open(filepath.Join(t.TempDir(), "berean.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	if _, err := lib.Import(t.Context(), wPath); err != nil {
		t.Fatal(err)
	}
	app, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	app.pubID = app.articles[0].ID
	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	if err := tt.Click("New note"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("Note editor"); err != nil {
		t.Fatal(err)
	}
	const (
		good   = "w23.01 p. 2 par. 3"
		broken = "w23.13 p. 2 par. 1"
		absent = "w22.08 p. 2 par. 1"
	)
	tt.Type("Note " + good + " then " + broken + " then " + absent + ".")
	tt.Frame()
	for _, prefix := range []string{
		broken + `: Couldn't read the citation "w23.13 p. 2 par. 1".`,
		absent + ": Import the August 2022 study edition of The Watchtower (w22.08).",
	} {
		if !textExact(tt, prefix) {
			t.Fatalf("error line %q missing; texts %q", prefix, sampleTexts(tt, broken))
		}
	}
	if err := tt.Click("Done"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if textExact(tt, broken+`: Couldn't read the citation "w23.13 p. 2 par. 1".`) {
		t.Fatal("the error line stayed after Done")
	}
	img := tt.Image()
	br, bb := chipMean(t, tt, img, broken)
	gr, gb := chipMean(t, tt, img, good)
	if br <= bb {
		t.Fatalf("broken chip looks like a working link: mean red %.0f blue %.0f", br, bb)
	}
	if gb <= gr {
		t.Fatalf("working chip is not the blue pill: mean red %.0f blue %.0f", gr, gb)
	}
	saveShot(t, tt, "broken-chip-done.png")
}

func TestStudyHeaderAndReopen(t *testing.T) {
	dir := t.TempDir()
	lib, err := library.Open(filepath.Join(dir, "berean.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	writeStubBench(t, lib.Path())
	app, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)
	n := 0
	app.clock = func() time.Time {
		n++
		return start.Add(time.Duration(n) * time.Second)
	}
	app.beginStudy()
	lines := mustStudy(t, app.studyPath())
	if len(lines) < 2 || lines[0]["event"] != "header" || lines[1]["event"] != "study_start" {
		t.Fatalf("log began %#v", eventsOf(lines))
	}
	checkHeader(t, lines[0], false)
	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	if !tt.HasText(studyPrompt) {
		t.Fatal("the task prompt is not first")
	}
	if err := tt.Click("Show steps"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	for _, s := range tt.Texts() {
		if strings.Contains(s, "Ctrl") || strings.Contains(s, "Cmd") || strings.Contains(strings.ToLower(s), "shortcut") {
			t.Fatalf("step list names a keyboard shortcut: %q", s)
		}
	}
	if !tt.HasText("Back button") || !tt.HasText("New note") {
		t.Fatal("step list does not name the on-screen controls")
	}
	if !tt.HasText("8. When your canvas is done, press Finish study.") {
		t.Fatal("step list does not tell Owen to press Finish study")
	}
	app.phase = phaseTask
	app.logPhase(phaseTask, "start")
	app2, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	app2.beginStudy()
	if app2.phase != phaseTask {
		t.Fatalf("reopen phase %q", app2.phase)
	}
	tt2 := ui.NewTester(app2.View, 1440, 900)
	tt2.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt2.Frame()
	if tt2.HasText(studyPrompt) {
		t.Fatal("reopening during the task showed the prompt again")
	}
}

func TestSetupGate(t *testing.T) {
	wrong := mustFixture(t, "w", "202301", "w_E_202301.jwpub", "52e756833e0fcd9183eb5d2c0bcd3437")
	wt := mustFixture(t, "wt", "", "wt_E.jwpub", "dabe84070ef1afef883ea39687a6147b")
	it := mustFixture(t, "it", "", "it_E.jwpub", "b8d2145ef9ab7fff7c9ab3050ab4763f")
	w17 := mustFixture(t, "w", "201706", "w_E_201706.jwpub", "ef7632684b65ed55bb9e8de66bce44dc")

	dir := t.TempDir()
	lib, err := library.Open(filepath.Join(dir, "berean.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	writeStubBench(t, lib.Path())
	app, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	app.beginStudy()
	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	if err := tt.Click("Continue"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	for _, label := range []string{
		"Insight on the Scriptures (it)",
		"covers it-2 citations",
		"Worship the Only True God (wt)",
		"The Watchtower, June 2017 (w17.06)",
	} {
		if !tt.HasText(label) {
			t.Fatalf("setup missing %q", label)
		}
	}
	if tt.HasText("Insight on the Scriptures Vol. 2 (it-2)") {
		t.Fatal("setup still names Insight volume 2")
	}
	saveShot(t, tt, "setup-insight-row.png")
	if tt.HasText("✓ ") {
		t.Fatal("a check mark showed before any import")
	}
	before := app.phase
	_ = tt.Click("Start")
	tt.Frame()
	if app.phase != before {
		t.Fatal("Start ran before the three publications were imported")
	}
	if !tt.DropFiles(420, 280, wrong) {
		t.Fatal("the setup screen did not take the dropped file")
	}
	tt.Frame()
	const allMissing = "Still missing: Insight on the Scriptures (it), Worship the Only True God (wt), and The Watchtower, June 2017 (w17.06)."
	if !tt.HasText(allMissing) {
		t.Fatalf("wrong file did not name what is missing; sample %q", sampleTexts(tt, "Still missing"))
	}
	if !tt.DropFiles(420, 280, wt) {
		t.Fatal("the setup screen did not take Worship the Only True God")
	}
	tt.Frame()
	if !tt.HasText("✓ Worship the Only True God (wt)") {
		t.Fatal("wt has no check mark")
	}
	const partial = "Still missing: Insight on the Scriptures (it) and The Watchtower, June 2017 (w17.06)."
	if !tt.HasText(partial) {
		t.Fatalf("partial setup: %q", sampleTexts(tt, "Still missing"))
	}
	saveShot(t, tt, "setup-partial.png")

	app.pickFiles = func() ([]string, error) { return []string{it, w17}, nil }
	if err := tt.Click("Choose files"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	for _, label := range []string{
		"✓ Insight on the Scriptures (it)",
		"✓ Worship the Only True God (wt)",
		"✓ The Watchtower, June 2017 (w17.06)",
	} {
		if !tt.HasText(label) {
			t.Fatalf("complete setup missing %q; sample %q", label, sampleTexts(tt, "✓"))
		}
	}
	if tt.HasText("Still missing:") {
		t.Fatal("still missing a publication after all three imported")
	}
	saveShot(t, tt, "setup-complete.png")
	if err := tt.Click("Start"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if app.phase != phaseTask {
		t.Fatalf("phase %q after Start", app.phase)
	}
	if !tt.HasText("Finish study") {
		t.Fatal("the task canvas has no Finish study button")
	}
	w := pubSymbol(t, app, "w23")
	app.pubID = w.ID
	app.docID = 2
	app.docsFor = -1
	tt.Frame()

	src := labelWith(t, tt, "src pub=")
	dragText(t, tt, src, 1100, 240)
	tt.Frame()
	if len(app.cards) != 1 || app.cards[0].Citation == "" {
		t.Fatalf("clip %+v", app.cards)
	}
	header := clipHeader(app.cards[0])
	box := findAll(tt, fmt.Sprintf("card %d", app.cards[0].ID))
	if len(box) == 0 {
		t.Fatal("card has no box")
	}
	x, y := box[0].X+4, box[0].Y+box[0].H-8
	tt.Press(x, y)
	tt.Move(x+28, y+18)
	tt.Release(x+28, y+18)
	tt.Frame()

	if len(app.docs) < 2 {
		t.Fatal("publication has one document")
	}
	other := app.docs[0].ID
	if other == app.docID {
		other = app.docs[1].ID
	}
	app.goPublication(app.pubID, other, 0, 0, false, "open", "")
	tt.Frame()
	clickUpper(t, tt, "Back")
	tt.Frame()

	bringOnScreen(t, tt, app, header)
	if err := tt.Click(header); err != nil {
		t.Fatal(err)
	}
	tt.Frame()

	if err := tt.Click("New note"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("Note editor"); err != nil {
		t.Fatal(err)
	}
	tt.Type("Where I fit. See Jer. 10:23.")
	tt.Frame()
	if err := tt.Click("Done"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()

	if err := tt.Click("Finish study"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText(debriefHardestQ) || !tt.HasText(debriefComeBackQ) {
		t.Fatal("debrief questions do not match the task")
	}
	if err := tt.Click("Hardest"); err != nil {
		t.Fatal(err)
	}
	tt.Type("Lining the Genesis clips up by hand.")
	if err := tt.Click("Come back"); err != nil {
		t.Fatal(err)
	}
	tt.Type("Yes. I would keep this canvas.")
	if err := tt.Click("Save"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if app.phase != phaseDone {
		t.Fatalf("phase after save %q", app.phase)
	}
	raw, err := os.ReadFile(app.debriefPath())
	if err != nil {
		t.Fatal(err)
	}
	var d debriefFile
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	if d.Hardest != "Lining the Genesis clips up by hand." || d.ComeBack != "Yes. I would keep this canvas." {
		t.Fatalf("debrief %+v", d)
	}
	lines := mustStudy(t, app.studyPath())
	checkStudyLog(t, lines)
	logged, err := os.ReadFile(app.studyPath())
	if err != nil {
		t.Fatal(err)
	}
	if text := app.cards[0].Text; len(text) > 40 && bytes.Contains(logged, []byte(text[:40])) {
		t.Fatal("the study log contains publication text")
	}
}

func TestBenchCommand(t *testing.T) {
	dir := t.TempDir()
	db := filepath.Join(dir, "berean.db")
	var buf bytes.Buffer
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	if err := CommandBench(&buf, logger, db); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	t.Log(out)
	if !strings.Contains(out, "renderer: "+rendererName) {
		t.Fatalf("renderer line missing: %s", out)
	}
	if !strings.Contains(out, "(200 cards)") || !strings.Contains(out, "pan:") || !strings.Contains(out, "zoom:") {
		t.Fatalf("summary: %s", out)
	}
	if !strings.Contains(logBuf.String(), "frame") || !strings.Contains(logBuf.String(), "action=pan") || !strings.Contains(logBuf.String(), "action=zoom") {
		t.Fatal("frame times were not logged")
	}
	b, ok := readBench(siblingPath(db, ".bench.json"))
	if !ok || !b.recent() || b.Cards != 200 {
		t.Fatalf("bench file %+v ok=%v", b, ok)
	}
	if !b.Pan.withinBudget() || !b.Zoom.withinBudget() {
		t.Fatalf("budget pan p95=%s max=%s zoom p95=%s max=%s", b.Pan.P95, b.Pan.Max, b.Zoom.P95, b.Zoom.Max)
	}

	lib, err := library.Open(db, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	app, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	app.beginStudy()
	lines := mustStudy(t, app.studyPath())
	checkHeader(t, lines[0], false)
	got, ok := readBench(app.benchPath())
	if !ok || !got.At.Equal(b.At) {
		t.Fatal("a recent bench was measured again at study start")
	}

	os.Remove(siblingPath(db, ".bench.json"))
	os.Remove(app.studyPath())
	app2, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	app2.beginStudy()
	if app2.phase != phaseBench {
		t.Fatalf("phase %q before the bench frame", app2.phase)
	}
	tt := ui.NewTester(app2.View, 1440, 900)
	if !tt.HasText(benchMessage) {
		t.Fatal("the measuring message is not on screen")
	}
	if _, err := os.Stat(app2.benchPath()); !os.IsNotExist(err) {
		t.Fatal("the bench ran before the measuring screen")
	}
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	fresh, ok := readBench(app2.benchPath())
	if !ok || !fresh.At.After(b.At) {
		t.Fatal("study start did not measure a bench when none was recent")
	}
	lines = mustStudy(t, app2.studyPath())
	checkHeader(t, lines[0], false)
	assertBenchPhase(t, lines)
}

func TestSampleStudyLog(t *testing.T) {
	path := filepath.Join("..", "..", "docs", "sample-study-log.jsonl")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(".jwpub")) || bytes.Contains(raw, []byte("\"text\"")) {
		t.Fatal("sample log contains publication data")
	}
	lines := decodeLines(t, raw)
	checkStudyLog(t, lines)
	assertBenchOutside(t, lines)
}

func TestWriteSampleStudyLog(t *testing.T) {
	if os.Getenv("BEREAN_WRITE_SAMPLE") == "" {
		t.Skip()
	}
	wPath := mustFixture(t, "w", "202301", "w_E_202301.jwpub", "52e756833e0fcd9183eb5d2c0bcd3437")
	nwtPath := mustFixture(t, "nwt", "", "nwt_E.jwpub", "fe3ee3beb5e0605af2da1db7fd658e46")
	rsgPath := mustFixture(t, "rsg", "", "rsg_E.jwpub", "1620026ee09080eb2e33b383b6467d6b")
	dir := t.TempDir()
	lib, err := library.Open(filepath.Join(dir, "berean.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	for _, path := range []string{wPath, nwtPath, rsgPath} {
		if _, err := lib.Import(t.Context(), path); err != nil {
			t.Fatal(err)
		}
	}
	app, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)
	n := 0
	app.clock = func() time.Time {
		n++
		return start.Add(time.Duration(n) * time.Second)
	}
	app.beginStudy()
	tt := ui.NewTester(app.View, 1440, 900)
	if !tt.HasText(benchMessage) {
		t.Fatal("the measuring message is not on screen")
	}
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	app.logPhase(phaseSetup, "start")
	app.logPhase(phaseSetup, "end")
	app.phase = phaseTask
	app.logPhase(phaseTask, "start")
	w, nwt, rsg := pubSymbol(t, app, "w23"), pubSymbol(t, app, "nwt"), pubSymbol(t, app, "rsg")
	app.pubID = rsg.ID
	app.docID = 2
	tt = ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	app.pubID = w.ID
	app.docID = 2
	app.book, app.chapter = 1, 3
	app.trans[0] = nwt.ID
	app.focusVerse, app.focusVerseTo, app.focusVerseOn = 1, 5, true
	tt.Frame()
	verse := labelWith(t, tt, "src bible=nwt")
	dragText(t, tt, verse, 1100, 320)
	tt.Frame()
	if len(app.cards) == 0 {
		t.Fatal("no clip")
	}
	header := clipHeader(app.cards[0])
	box := findAll(tt, fmt.Sprintf("card %d", app.cards[0].ID))
	if len(box) == 0 {
		t.Fatal("card has no box")
	}
	x, y := box[0].X+4, box[0].Y+box[0].H-8
	tt.Press(x, y)
	tt.Move(x+28, y+18)
	tt.Release(x+28, y+18)
	tt.Frame()
	app.goBible(1, 1, 0, 0, 0, "open", "")
	tt.Frame()
	clickLower(t, tt, "Back")
	bringOnScreen(t, tt, app, header)
	if err := tt.Click(header); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("New note"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("Note editor"); err != nil {
		t.Fatal(err)
	}
	tt.Type("Owen fits under Jehovah's sovereignty. See Jer. 10:23 and w23.13 p. 2 par. 1.")
	tt.Frame()
	if err := tt.Click("Done"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	app.finishTask()
	app.hardest = "Lining the Genesis clips up by hand."
	app.comeBack = "Yes. I would keep this canvas."
	app.saveDebrief()
	raw, err := os.ReadFile(app.studyPath())
	if err != nil {
		t.Fatal(err)
	}
	for _, card := range app.cards {
		if len(card.Text) > 24 && bytes.Contains(raw, []byte(card.Text[:24])) {
			t.Fatal("sample would contain publication text")
		}
	}
	lines := decodeLines(t, raw)
	checkStudyLog(t, lines)
	assertBenchOutside(t, lines)
	out := filepath.Join("..", "..", "docs", "sample-study-log.jsonl")
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("wrote %s", out)
}

func TestBenchTimeIsOutsideSetupAndTask(t *testing.T) {
	dir := t.TempDir()
	lib, err := library.Open(filepath.Join(dir, "berean.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	app, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)
	n := 0
	app.clock = func() time.Time {
		n++
		return start.Add(time.Duration(n) * time.Second)
	}
	app.beginStudy()
	if app.phase != phaseBench {
		t.Fatalf("phase %q", app.phase)
	}
	tt := ui.NewTester(app.View, 1440, 900)
	if !tt.HasText(benchMessage) {
		t.Fatal("the measuring message is not on screen")
	}
	saveShot(t, tt, "measuring-performance.png")
	if _, err := os.Stat(app.studyPath()); !os.IsNotExist(err) {
		t.Fatal("the study log was written before the bench finished")
	}
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	if !tt.HasText(studyPrompt) {
		t.Fatal("the prompt did not follow the bench")
	}
	if err := tt.Click("Continue"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	app.logPhase(phaseSetup, "end")
	app.phase = phaseTask
	app.logPhase(phaseTask, "start")
	app.logPhase(phaseTask, "end")
	lines := mustStudy(t, app.studyPath())
	if lines[0]["event"] != "header" {
		t.Fatalf("first event %v", lines[0]["event"])
	}
	assertBenchOutside(t, lines)
}

func TestRepeatedErrorIsLoggedTwice(t *testing.T) {
	dir := t.TempDir()
	lib, err := library.Open(filepath.Join(dir, "berean.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	writeStubBench(t, lib.Path())
	app, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	app.beginStudy()
	const broken = "See w23.13 p. 2 par. 1."
	app.noteDraft = broken
	first := app.draftErrors()
	if len(first) != 1 {
		t.Fatalf("first showing %#v", first)
	}
	app.noteDraft = "No citation in this draft."
	if again := app.draftErrors(); len(again) != 0 {
		t.Fatalf("clear draft %#v", again)
	}
	app.noteDraft = broken
	second := app.draftErrors()
	if len(second) != 1 || second[0] != first[0] {
		t.Fatalf("second showing %#v, first %#v", second, first)
	}
	var messages []string
	for _, ev := range mustStudy(t, app.studyPath()) {
		if ev["event"] == "error" {
			messages = append(messages, str(ev["message"]))
		}
	}
	if len(messages) != 2 || messages[0] != first[0] || messages[1] != first[0] {
		t.Fatalf("error events %#v", messages)
	}
}

func TestBrokenChipClickLogsTwice(t *testing.T) {
	dir := t.TempDir()
	lib, err := library.Open(filepath.Join(dir, "berean.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	app, err := New(lib, nil)
	if err != nil {
		t.Fatal(err)
	}
	tt := ui.NewTester(app.View, 1440, 900)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true, TextScale: 1})
	tt.Frame()
	if err := tt.Click("New note"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("Note editor"); err != nil {
		t.Fatal(err)
	}
	const broken = "w23.13 p. 2 par. 1"
	tt.Type("See " + broken + ".")
	tt.Frame()
	if err := tt.Click("Done"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	writeStubBench(t, lib.Path())
	app.beginStudy()
	app.phase = phaseTask
	tt.Frame()
	if err := tt.Click(broken); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click(broken); err != nil {
		t.Fatal(err)
	}
	var messages []string
	for _, ev := range mustStudy(t, app.studyPath()) {
		if ev["event"] == "error" {
			messages = append(messages, str(ev["message"]))
			if ev["citation"] != broken {
				t.Fatalf("error citation %#v", ev["citation"])
			}
		}
	}
	const shown = `Couldn't read the citation "w23.13 p. 2 par. 1".`
	if len(messages) != 2 || messages[0] != shown || messages[1] != shown {
		t.Fatalf("error events %#v", messages)
	}
}

func writeStubBench(t *testing.T, db string) {
	t.Helper()
	b := benchResult{
		At: time.Now().UTC(), Version: Version, Renderer: rendererName, Cards: benchCards,
		Pan:  actionStats{P50: time.Millisecond, P95: 2 * time.Millisecond, Max: 3 * time.Millisecond},
		Zoom: actionStats{P50: time.Millisecond, P95: 2 * time.Millisecond, Max: 3 * time.Millisecond},
	}
	if err := writeBench(siblingPath(db, ".bench.json"), b); err != nil {
		t.Fatal(err)
	}
}

func mustStudy(t *testing.T, path string) []map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return decodeLines(t, raw)
}

func decodeLines(t *testing.T, raw []byte) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range bytes.Split(raw, []byte("\n")) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var ev map[string]any
		if err := json.Unmarshal(line, &ev); err != nil {
			t.Fatalf("log line: %v\n%s", err, line)
		}
		out = append(out, ev)
	}
	return out
}

func eventsOf(lines []map[string]any) []string {
	var out []string
	for _, ev := range lines {
		out = append(out, str(ev["event"]))
	}
	return out
}

func checkHeader(t *testing.T, ev map[string]any, live bool) {
	t.Helper()
	if ev["event"] != "header" {
		t.Fatalf("first event %v", ev["event"])
	}
	if ev["os"] != runtime.GOOS || ev["arch"] != runtime.GOARCH {
		t.Fatalf("os/arch %v/%v", ev["os"], ev["arch"])
	}
	if ev["version"] == "" || ev["renderer"] != rendererName {
		t.Fatalf("version %v renderer %v", ev["version"], ev["renderer"])
	}
	bench, _ := ev["bench"].(map[string]any)
	if bench == nil {
		t.Fatal("header has no bench")
	}
	cards, _ := bench["cards"].(float64)
	if cards != 200 {
		t.Fatalf("bench cards %v", bench["cards"])
	}
	for _, action := range []string{"pan", "zoom"} {
		stat, _ := bench[action].(map[string]any)
		if stat == nil {
			t.Fatalf("bench %s missing", action)
		}
		for _, key := range []string{"p50_ms", "p95_ms", "max_ms"} {
			n, ok := stat[key].(float64)
			if !ok || (live && n < 0) {
				t.Fatalf("bench %s %s = %v", action, key, stat[key])
			}
		}
	}
	if ev["time"] == "" {
		t.Fatal("header has no time")
	}
}

func assertBenchPhase(t *testing.T, lines []map[string]any) {
	t.Helper()
	start, end := phaseTime(t, lines, "bench", "start"), phaseTime(t, lines, "bench", "end")
	if !start.Before(end) {
		t.Fatalf("bench %s .. %s", start, end)
	}
}

func assertBenchOutside(t *testing.T, lines []map[string]any) {
	t.Helper()
	benchStart := phaseTime(t, lines, "bench", "start")
	benchEnd := phaseTime(t, lines, "bench", "end")
	setupStart := phaseTime(t, lines, "setup", "start")
	setupEnd := phaseTime(t, lines, "setup", "end")
	taskStart := phaseTime(t, lines, "task", "start")
	taskEnd := phaseTime(t, lines, "task", "end")
	if !benchStart.Before(benchEnd) || !benchEnd.Before(setupStart) || !setupStart.Before(setupEnd) || !setupEnd.Before(taskStart) || !taskStart.Before(taskEnd) {
		t.Fatalf("bench %s..%s setup %s..%s task %s..%s", benchStart, benchEnd, setupStart, setupEnd, taskStart, taskEnd)
	}
}

func phaseTime(t *testing.T, lines []map[string]any, phase, boundary string) time.Time {
	t.Helper()
	for _, ev := range lines {
		if str(ev["event"]) == "phase" && str(ev["phase"]) == phase && str(ev["boundary"]) == boundary {
			at, err := time.Parse(time.RFC3339Nano, str(ev["time"]))
			if err != nil {
				t.Fatal(err)
			}
			return at
		}
	}
	t.Fatalf("log missing phase %s %s", phase, boundary)
	return time.Time{}
}

func checkStudyLog(t *testing.T, lines []map[string]any) {
	t.Helper()
	if len(lines) == 0 {
		t.Fatal("empty study log")
	}
	checkHeader(t, lines[0], false)
	need := map[string]bool{
		"study_start": false, "study_end": false,
		"card_created": false, "card_drag": false, "clip_created": false,
		"back": false, "citation_inserted": false, "citation_opened": false,
		"error": false,
	}
	phase := map[string]bool{}
	for _, ev := range lines {
		name := str(ev["event"])
		if _, ok := need[name]; ok {
			need[name] = true
		}
		if ev["time"] == "" {
			t.Fatalf("event %s has no time", name)
		}
		if _, ok := ev["text"]; ok {
			t.Fatalf("event %s carries publication text", name)
		}
		switch name {
		case "card_created":
			if ev["card_id"] == nil || ev["kind"] == nil {
				t.Fatalf("card_created %#v", ev)
			}
		case "card_drag":
			for _, key := range []string{"card_id", "x0", "y0", "x1", "y1", "zoom"} {
				if ev[key] == nil {
					t.Fatalf("card_drag missing %s: %#v", key, ev)
				}
			}
		case "clip_created":
			if ev["citation"] == nil || ev["source"] == nil {
				t.Fatalf("clip_created %#v", ev)
			}
		case "back":
			if ev["pane"] == nil {
				t.Fatalf("back %#v", ev)
			}
		case "citation_inserted", "citation_opened":
			if ev["citation"] == nil {
				t.Fatalf("%s %#v", name, ev)
			}
		case "error":
			if ev["message"] == nil {
				t.Fatalf("error %#v", ev)
			}
		case "phase":
			phase[str(ev["phase"])+" "+str(ev["boundary"])] = true
		}
	}
	for name, ok := range need {
		if !ok {
			t.Fatalf("log missing %s; events %v", name, eventsOf(lines))
		}
	}
	for _, key := range []string{"setup start", "setup end", "task start", "task end"} {
		if !phase[key] {
			t.Fatalf("log missing phase %s", key)
		}
	}
}

func textExact(tt *ui.Tester, want string) bool {
	for _, s := range tt.Texts() {
		if s == want {
			return true
		}
	}
	return false
}

func chipMean(t *testing.T, tt *ui.Tester, img *image.RGBA, label string) (red, blue float64) {
	t.Helper()
	rects := findAll(tt, label)
	if len(rects) == 0 {
		t.Fatalf("no chip %q", label)
	}
	r := rects[0]
	x0, y0 := int(r.X)+1, int(r.Y)+1
	x1, y1 := int(r.X+r.W)-1, int(r.Y+r.H)-1
	if x1 <= x0 || y1 <= y0 {
		x0, y0 = int(r.X), int(r.Y)
		x1, y1 = int(r.X+r.W), int(r.Y+r.H)
	}
	b := img.Bounds()
	var rs, bs, n float64
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			if !image.Pt(x, y).In(b) {
				continue
			}
			c := img.RGBAAt(x, y)
			rs += float64(c.R)
			bs += float64(c.B)
			n++
		}
	}
	if n == 0 {
		t.Fatalf("chip %q has no pixels %+v", label, r)
	}
	return rs / n, bs / n
}

func clickUpper(t *testing.T, tt *ui.Tester, label string) {
	t.Helper()
	rects := findAll(tt, label)
	if len(rects) == 0 {
		t.Fatalf("no %q", label)
	}
	upper := rects[0]
	for _, r := range rects[1:] {
		if r.Y < upper.Y {
			upper = r
		}
	}
	tt.ClickAt(upper.X+upper.W/2, upper.Y+upper.H/2)
}
