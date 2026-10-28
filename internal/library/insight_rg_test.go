package library

import (
	"context"
	"log/slog"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/odonckers/berean/internal/cite"
	"github.com/odonckers/berean/internal/jwpub"
)

// TestInsightResearchGuideParagraphs checks every Research Guide it-1 / it-2
// citation that carries a paragraph range. The paragraph before the citation
// links to jwpub://p/E:<doc>/<start>-<end>. A citation is correct when it
// opens that document at that start paragraph, broken when Resolve returns
// an error (the chip shows the error and does not open), and wrong when it
// opens some other paragraph. Wrong must stay 0.
func TestInsightResearchGuideParagraphs(t *testing.T) {
	itPath := fetchFixture(t, fixture{pub: "it", file: "it_E.jwpub", sum: "b8d2145ef9ab7fff7c9ab3050ab4763f"})
	rsgPath := fetchFixture(t, fixture{pub: "rsg", file: "rsg_E.jwpub", sum: "1620026ee09080eb2e33b383b6467d6b"})
	lib := openQuietLib(t)
	if _, err := lib.Import(context.Background(), itPath); err != nil {
		t.Fatal(err)
	}
	items := researchGuideParagraphCites(t, rsgPath)
	if len(items) != 11302 {
		t.Fatalf("paragraph citations = %d", len(items))
	}
	mepsOf := map[int]int{}
	rows, err := lib.db.Query(`SELECT document_id, meps_document_id FROM document`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id, meps int
		if err := rows.Scan(&id, &meps); err != nil {
			t.Fatal(err)
		}
		mepsOf[id] = meps
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	correct, broken, wrong := 0, 0, 0
	endEarly, endLate := 0, 0
	var wrongNote, endNote []string
	for _, item := range items {
		hits, err := lib.Resolve(context.Background(), item.citation)
		if err != nil || len(hits) == 0 {
			broken++
			if err == nil || !strings.Contains(err.Error(), "more than one") || !strings.Contains(item.citation, "Tyre") {
				if len(wrongNote) < 8 {
					msg := "no hits"
					if err != nil {
						msg = err.Error()
					}
					wrongNote = append(wrongNote, item.citation+": "+msg)
				}
			}
			continue
		}
		got := hits[0].ParagraphIndex
		gotEnd := hits[len(hits)-1].ParagraphIndex
		gotMeps := mepsOf[hits[0].DocumentID]
		if got != item.start || gotMeps != item.meps {
			wrong++
			if len(wrongNote) < 12 {
				wrongNote = append(wrongNote, item.citation+" link "+strconv.Itoa(item.meps)+":"+strconv.Itoa(item.start)+" got "+strconv.Itoa(gotMeps)+":"+strconv.Itoa(got))
			}
			continue
		}
		correct++
		if gotEnd == item.end {
			continue
		}
		if gotEnd > item.end {
			endEarly++
		} else {
			endLate++
			if len(endNote) < 4 {
				endNote = append(endNote, item.citation+" link end "+strconv.Itoa(item.end)+" got "+strconv.Itoa(gotEnd))
			}
		}
	}
	t.Logf("correct %d broken %d wrong %d (of %d); link ends early %d, link runs past the cited paragraph %d", correct, broken, wrong, len(items), endEarly, endLate)
	for _, s := range append(wrongNote, endNote...) {
		t.Log(s)
	}
	if correct+broken+wrong != len(items) || wrong != 0 || correct != 11286 || broken != 16 {
		t.Fatalf("correct %d broken %d wrong %d", correct, broken, wrong)
	}
}

type rgCite struct {
	citation   string
	meps       int
	start, end int
}

func researchGuideParagraphCites(t *testing.T, path string) []rgCite {
	t.Helper()
	pub, err := jwpub.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer pub.Close()
	citeRe := regexp.MustCompile(`it-[12]\s+.{0,160}?pars?\.\s*\d+(?:-\d+)?`)
	linkRe := regexp.MustCompile(`jwpub://p/E:(\d+)/(\d+)-(\d+)`)
	var items []rgCite
	err = pub.ForEachDocument(context.Background(), func(d jwpub.Document) error {
		type para struct {
			text  string
			links []string
		}
		var paras []para
		for _, p := range d.Paragraphs {
			var links []string
			if m, err := jwpub.DecodeMark(p.Markup); err == nil {
				for _, r := range m.Runs {
					if linkRe.MatchString(r.Href) {
						links = append(links, r.Href)
					}
				}
			}
			paras = append(paras, para{text: p.Text, links: links})
		}
		for i := 1; i < len(paras); i++ {
			if len(paras[i-1].links) == 0 {
				continue
			}
			m := linkRe.FindStringSubmatch(paras[i-1].links[0])
			if m == nil {
				continue
			}
			meps, _ := strconv.Atoi(m[1])
			start, _ := strconv.Atoi(m[2])
			end, _ := strconv.Atoi(m[3])
			for _, raw := range citeRe.FindAllString(paras[i].text, -1) {
				c, err := cite.Parse(raw)
				if err != nil || len(c.Pars) == 0 || (c.Symbol != "it-1" && c.Symbol != "it-2") {
					continue
				}
				items = append(items, rgCite{citation: raw, meps: meps, start: start, end: end})
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func TestInsightParagraphRuleBackfill(t *testing.T) {
	path := fetchFixture(t, fixture{pub: "it", file: "it_E.jwpub", sum: "b8d2145ef9ab7fff7c9ab3050ab4763f"})
	lib := openQuietLib(t)
	ctx := context.Background()
	if _, err := lib.Import(ctx, path); err != nil {
		t.Fatal(err)
	}
	const citation = "it-1 “Aaron” pars. 7-9"
	hits := mustResolve(t, lib, citation)
	if hits[0].Paragraph != 7 || hits[0].ParagraphIndex != 8 || hits[len(hits)-1].ParagraphIndex != 10 {
		t.Fatalf("aaron = %+v .. %+v", hits[0], hits[len(hits)-1])
	}
	if _, err := lib.db.Exec(`UPDATE publication SET insight_paragraph_rule=0 WHERE symbol='it'`); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.db.Exec(`UPDATE paragraph SET paragraph_number=paragraph_number-1 WHERE publication_id=? AND document_id=? AND paragraph_number IS NOT NULL`, hits[0].PubID, hits[0].DocumentID); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.Import(ctx, path); err != nil {
		t.Fatal(err)
	}
	hits = mustResolve(t, lib, citation)
	if hits[0].Paragraph != 7 || hits[0].ParagraphIndex != 8 || hits[len(hits)-1].ParagraphIndex != 10 {
		t.Fatalf("backfill aaron = %+v .. %+v", hits[0], hits[len(hits)-1])
	}
}

func openQuietLib(t *testing.T) *Library {
	t.Helper()
	lib, err := Open(filepath.Join(t.TempDir(), "berean.db"), slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	return lib
}
