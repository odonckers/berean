package read

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// canvasFile is the canvas beside the database. Slice order is z-order:
// the last card is in front.
type canvasFile struct {
	NextID int64  `json:"next_id"`
	Cards  []Clip `json:"cards"`
}

func siblingPath(db, suffix string) string {
	return strings.TrimSuffix(db, filepath.Ext(db)) + suffix
}

func (a *App) loadCanvas() {
	if a.lib == nil {
		return
	}
	raw, err := os.ReadFile(siblingPath(a.lib.Path(), ".canvas.json"))
	if err != nil {
		if !os.IsNotExist(err) {
			a.log.Error("canvas load", "err", err)
		}
		return
	}
	var f canvasFile
	if err := json.Unmarshal(raw, &f); err != nil {
		a.log.Error("canvas load", "err", err)
		return
	}
	a.cards = f.Cards
	a.nextClip = f.NextID
	var maxID int64
	for _, c := range a.cards {
		if c.ID > maxID {
			maxID = c.ID
		}
	}
	if a.nextClip < maxID {
		a.nextClip = maxID
	}
}

func (a *App) saveCanvas() {
	if a.lib == nil {
		return
	}
	cards := a.cards
	if cards == nil {
		cards = []Clip{}
	}
	raw, err := json.MarshalIndent(canvasFile{NextID: a.nextClip, Cards: cards}, "", "  ")
	if err != nil {
		a.log.Error("canvas save", "err", err)
		return
	}
	raw = append(raw, '\n')
	if err := writeAtomic(siblingPath(a.lib.Path(), ".canvas.json"), raw); err != nil {
		a.log.Error("canvas save", "err", err)
	}
}

// writeAtomic replaces path by renaming a complete temp file in the same
// directory. A reader sees the previous file or the new one, never a prefix.
func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-"+filepath.Base(path)+"-")
	if err != nil {
		return err
	}
	name := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			os.Remove(name)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	ok = true
	return nil
}
