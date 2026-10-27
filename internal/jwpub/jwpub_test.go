package jwpub

import (
	"encoding/hex"
	"strings"
	"testing"
)

func TestDeriveKey(t *testing.T) {
	cases := []struct {
		lang                 int
		symbol               string
		year                 int
		issue, keyHex, ivHex string
	}{
		{0, "w23", 2023, "20230100", "76e2944015032dc84131f29a1ea844b2", "434526b77407e00178058f4a02fadcda"},
		{0, "nwt", 2013, "0", "a6bdd2f8877c770d08cff5aed7b73c0b", "e50991b069862657213ec1a9c4d54dca"},
		{0, "nwtsty", 2026, "0", "d0abaeda89eb06fde0b66a5060334c31", "716991d394d1e3dd8a1952c3902b9d8e"},
	}
	for _, c := range cases {
		key, iv, err := deriveKey(c.lang, c.symbol, c.year, c.issue)
		if err != nil {
			t.Fatal(err)
		}
		if hex.EncodeToString(key) != c.keyHex || hex.EncodeToString(iv) != c.ivHex {
			t.Fatalf("deriveKey(%s %d %s) = %x %x", c.symbol, c.year, c.issue, key, iv)
		}
	}
}

func TestVerseNumber(t *testing.T) {
	cases := []struct {
		label string
		want  int
	}{
		{"", 0},
		{"   ", 0},
		{`<span class="cl">24</span>`, 1},
		{`<span class="vl">14</span>`, 14},
		{`<span class="vl">12</span>`, 12},
	}
	for _, c := range cases {
		got, err := verseNumber(c.label)
		if err != nil {
			t.Fatalf("verseNumber(%q): %v", c.label, err)
		}
		if got != c.want {
			t.Fatalf("verseNumber(%q) = %d, want %d", c.label, got, c.want)
		}
	}
	if _, err := verseNumber("<span>nope</span>"); err == nil {
		t.Fatal("unrecognized label returned a verse")
	}
}

func TestParagraphPages(t *testing.T) {
	const src = `
<p data-pid="1"><span class="pageNum" data-no="2"></span>Intro</p>
<p data-pid="2">On page two</p>
<h2 data-pid="3"><span class="pageNum" data-no="3"></span>Head</h2>
<p data-pid="4">Start <span class="pageNum" data-no="4"></span> continues</p>`
	got, err := paragraphsFromHTML(src)
	if err != nil {
		t.Fatal(err)
	}
	want := []Paragraph{
		{Index: 1, FirstPage: 2, LastPage: 2, Text: "Intro"},
		{Index: 2, FirstPage: 2, LastPage: 2, Text: "On page two"},
		{Index: 3, FirstPage: 3, LastPage: 3, Text: "Head"},
		{Index: 4, FirstPage: 3, LastPage: 4, Text: "Start continues"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d paragraphs, want %d", len(got), len(want))
	}
	for i := range want {
		g := got[i]
		w := want[i]
		if g.Index != w.Index || g.FirstPage != w.FirstPage || g.LastPage != w.LastPage || g.Text != w.Text {
			t.Fatalf("paragraph %d = %+v, want %+v", i, g, w)
		}
	}
	if strings.Contains(got[3].Text, "pageNum") {
		t.Fatal("page marker leaked into the text")
	}
}

func TestMarkup(t *testing.T) {
	const src = `
<p data-pid="8" class="sb"><span class="parNum" data-pnum="3"><strong><sup>3</sup></strong></span> How <em>can</em> we <a href="jwpub://b/NWTR/40:24:14-40:24:14"><strong>help</strong></a> others</p>
<h2 data-pid="9"><strong>THE BIBLE’S MESSAGE</strong></h2>`
	got, err := paragraphsFromHTML(src)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("paragraphs = %d", len(got))
	}
	if got[0].Text != "3 How can we help others" {
		t.Fatalf("plain = %q", got[0].Text)
	}
	m, err := DecodeMark(got[0].Markup)
	if err != nil {
		t.Fatal(err)
	}
	if m.Heading != 0 {
		t.Fatalf("heading = %d", m.Heading)
	}
	var b strings.Builder
	for _, r := range m.Runs {
		b.WriteString(r.Text)
	}
	if b.String() != "How can we help others" {
		t.Fatalf("markup text = %q, runs %+v", b.String(), m.Runs)
	}
	if !m.Runs[1].Italic || strings.TrimSpace(m.Runs[1].Text) != "can" {
		t.Fatalf("italic run = %+v", m.Runs)
	}
	var link Run
	for _, r := range m.Runs {
		if r.Href != "" {
			link = r
		}
	}
	if !link.Bold || link.Href != "jwpub://b/NWTR/40:24:14-40:24:14" || strings.TrimSpace(link.Text) != "help" {
		t.Fatalf("link run = %+v", link)
	}
	head, err := DecodeMark(got[1].Markup)
	if err != nil {
		t.Fatal(err)
	}
	if head.Heading != 2 || len(head.Runs) != 1 || !head.Runs[0].Bold || head.Runs[0].Text != "THE BIBLE’S MESSAGE" {
		t.Fatalf("heading mark = %+v", head)
	}
}
