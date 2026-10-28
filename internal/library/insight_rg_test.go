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
// links to jwpub://p/E:<doc>/<start>-<end>. The resolved paragraph index has
// to be that start. The link's end is sometimes shorter than the written
// range; those stay matches on the start, which is where the reader scrolls.
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
	startMatch, endMatch, endEarly, endLate, ambiguous := 0, 0, 0, 0, 0
	var startMiss, endNote []string
	for _, item := range items {
		hits, err := lib.Resolve(context.Background(), item.citation)
		got, gotEnd, gotMeps := 0, 0, 0
		if err != nil {
			if strings.Contains(err.Error(), "more than one") {
				ambiguous++
				if !strings.Contains(item.citation, "Tyre") {
					t.Errorf("ambiguous citation %s", item.citation)
				}
				continue
			}
		} else if len(hits) > 0 {
			got = hits[0].ParagraphIndex
			gotEnd = hits[len(hits)-1].ParagraphIndex
			gotMeps = mepsOf[hits[0].DocumentID]
		}
		if got == item.start && gotMeps == item.meps {
			startMatch++
		} else if len(startMiss) < 12 {
			startMiss = append(startMiss, item.citation+" link "+strconv.Itoa(item.meps)+":"+strconv.Itoa(item.start)+" got "+strconv.Itoa(gotMeps)+":"+strconv.Itoa(got))
		}
		if got == item.start && gotMeps == item.meps && gotEnd == item.end {
			endMatch++
		} else if got == item.start && gotMeps == item.meps && gotEnd > item.end {
			endEarly++
		} else if got == item.start && gotMeps == item.meps && gotEnd != 0 && gotEnd < item.end {
			endLate++
			if len(endNote) < 4 {
				endNote = append(endNote, item.citation+" link end "+strconv.Itoa(item.end)+" got "+strconv.Itoa(gotEnd))
			}
		}
	}
	t.Logf("start %d/%d ambiguous %d both %d link-ends-early %d link-ends-later %d", startMatch, len(items), ambiguous, endMatch, endEarly, endLate)
	for _, s := range append(startMiss, endNote...) {
		t.Log(s)
	}
	if ambiguous != 16 || startMatch != len(items)-ambiguous {
		t.Fatalf("start pid matches %d of %d, ambiguous %d", startMatch, len(items), ambiguous)
	}
	if endEarly == 0 {
		t.Fatal("expected some publisher links to end before the written range")
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
