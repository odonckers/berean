package cite

import "testing"

func TestParse(t *testing.T) {
	cases := []struct{ in, want string }{
		{"w23.01 p. 5 par. 3", "pub[w 2023-01 p.5 par.3]"},
		{"w15 2/15 p. 8", "pub[w 2015-02-15 p.8]"},
		{"it-1 450", "pub[it-1 p.450]"},
		{"it-2 p. 1011", "pub[it-2 p.1011]"},
		{"w23.01 pp. 2-7", "pub[w 2023-01 p.2-7]"},
		{"w23.01 p. 3 pars. 3-5", "pub[w 2023-01 p.3 par.3-5]"},
		{"w99 1/1 p. 30", "pub[w 1999-01-01 p.30]"},
		{"lfb lesson 12", "pub[lfb lesson 12]"},
		{"lff lesson 4 par. 2", "pub[lff lesson 4 par.2]"},
		{"Matt. 24:14", "bible[40 Matt. 24:14]"},
		{"Mt 24:14", "bible[40 Matt. 24:14]"},
		{"Matthew 24:14", "bible[40 Matt. 24:14]"},
		{"1 Cor. 13:4-7", "bible[46 1 Cor. 13:4-7]"},
		{"1Co 13:4-7", "bible[46 1 Cor. 13:4-7]"},
		{"1 Corinthians 13:4–7", "bible[46 1 Cor. 13:4-7]"},
		{"Mt 9:35; 28:19, 20", "bible[40 Matt. 9:35; 28:19, 20]"},
		{"Ps. 83:18", "bible[19 Ps. 83:18]"},
		{"Psalm 23", "bible[19 Ps. 23]"},
		{"Song of Sol. 8:6", "bible[22 Song of Sol. 8:6]"},
		{"Jude 9", "bible[65 Jude 1:9]"},
		{"Job 1:6", "bible[18 Job 1:6]"},
		{"Joh 17:3", "bible[43 John 17:3]"},
		{"Php 4:6, 7", "bible[50 Phil. 4:6, 7]"},
		{"Phm 10", "bible[57 Philem. 1:10]"},
		{"Re 21:3, 4", "bible[66 Rev. 21:3, 4]"},
		{"study note on Matt. 24:14", "studynote(bible[40 Matt. 24:14])"},
		{"nwtsty study note on Mt 24:14", "studynote(bible[40 Matt. 24:14])"},
		{"nwtsty Matt. 24:14 note", "studynote(bible[40 Matt. 24:14])"},
	}
	if len(cases) != 28 {
		t.Fatalf("parser suite has %d cases, want 28", len(cases))
	}
	for _, c := range cases {
		got, err := Parse(c.in)
		if err != nil {
			t.Errorf("Parse(%q) error: %v", c.in, err)
			continue
		}
		if got.String() != c.want {
			t.Errorf("Parse(%q) = %s, want %s", c.in, got, c.want)
		}
	}
}

func TestParseInsightTitle(t *testing.T) {
	cases := []struct{ in, want string }{
		{"it-2 Sovereignty", "pub[it-2 Sovereignty]"},
		{"it-1 Guard", "pub[it-1 Guard]"},
		{"it-1 Guard, Gate of the", "pub[it-1 Guard, Gate of the]"},
		{"it-2 Jehovah's Day", "pub[it-2 Jehovah's Day]"},
		{"it-2 p. 1011", "pub[it-2 p.1011]"},
		{"it-1 450", "pub[it-1 p.450]"},
	}
	for _, c := range cases {
		got, err := Parse(c.in)
		if err != nil {
			t.Errorf("Parse(%q) error: %v", c.in, err)
			continue
		}
		if got.String() != c.want {
			t.Errorf("Parse(%q) = %s, want %s", c.in, got, c.want)
		}
	}
	if _, err := Parse("it Sovereignty"); err == nil {
		t.Fatal("plain it with a title parsed")
	}
	if _, err := Parse("it-2 Sovereignty and"); err == nil {
		t.Fatal("a trailing and was taken as the article name")
	}
}

func TestParseErrors(t *testing.T) {
	cases := []string{
		"",
		"Matt.",
		"Matt. 24:",
		"w23.13 p. 5",
		"w15 13/1",
		"Xyz 1:1",
		"1 Cor. 13:7-4",
		"w23.01 p. 5 extra",
	}
	if len(cases) != 8 {
		t.Fatalf("error suite has %d cases, want 8", len(cases))
	}
	for _, in := range cases {
		if c, err := Parse(in); err == nil {
			t.Errorf("Parse(%q) = %s, want error", in, c)
		}
	}
}
