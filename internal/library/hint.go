package library

import (
	"fmt"
	"time"

	"github.com/odonckers/berean/internal/cite"
)

// importHint says which publication to import, in plain words.
// w23.01 is the January 2023 study edition of The Watchtower.
func importHint(c cite.Citation) string {
	tag := citeTag(c)
	if c.Symbol == "w" && c.Year != 0 && c.Month != 0 && c.Day == 0 {
		return fmt.Sprintf("Import the %s %d study edition of The Watchtower (%s).", monthName(c.Month), c.Year, tag)
	}
	if c.Symbol == "w" && c.Year != 0 && c.Month != 0 && c.Day != 0 {
		return fmt.Sprintf("Import the %s %d, %d issue of The Watchtower (%s).", monthName(c.Month), c.Day, c.Year, tag)
	}
	if name, ok := publicationName(c.Symbol); ok {
		switch {
		case c.Year != 0 && c.Month != 0 && c.Day != 0:
			return fmt.Sprintf("Import the %s %d, %d issue of %s (%s).", monthName(c.Month), c.Day, c.Year, name, tag)
		case c.Year != 0 && c.Month != 0:
			return fmt.Sprintf("Import the %s %d issue of %s (%s).", monthName(c.Month), c.Year, name, tag)
		case c.Year != 0:
			return fmt.Sprintf("Import the %d edition of %s (%s).", c.Year, name, tag)
		default:
			return fmt.Sprintf("Import %s (%s).", name, tag)
		}
	}
	if c.Year != 0 && c.Month != 0 {
		return fmt.Sprintf("Import the %s %d publication %s. It is not in the library.", monthName(c.Month), c.Year, tag)
	}
	return fmt.Sprintf("Import the publication %s. It is not in the library.", tag)
}

func publicationName(symbol string) (string, bool) {
	name, ok := map[string]string{
		"w":      "The Watchtower",
		"g":      "Awake!",
		"it-1":   "Insight on the Scriptures, Volume 1",
		"it-2":   "Insight on the Scriptures, Volume 2",
		"nwt":    "New World Translation of the Holy Scriptures",
		"nwtsty": "New World Translation of the Holy Scriptures (Study Edition)",
		"rsg":    "Research Guide for Jehovah's Witnesses",
	}[symbol]
	return name, ok
}

func monthName(m int) string {
	if m < 1 || m > 12 {
		return fmt.Sprintf("month %d", m)
	}
	return time.Month(m).String()
}

// citeTag is the citation's publication the way a reader writes it, such as w23.01.
func citeTag(c cite.Citation) string {
	if c.Year == 0 {
		return c.Symbol
	}
	y := c.Year % 100
	switch {
	case c.Month != 0 && c.Day != 0:
		return fmt.Sprintf("%s%02d %d/%d", c.Symbol, y, c.Month, c.Day)
	case c.Month != 0:
		return fmt.Sprintf("%s%02d.%02d", c.Symbol, y, c.Month)
	default:
		return fmt.Sprintf("%s%02d", c.Symbol, y)
	}
}
