package cite

import "strings"

// book is one of the 66 books, with the names a citation may use.
type book struct {
	n          int
	name, long string
	short      string
}

// The short forms are the ones used in study-Bible marginal references
// (Mt, Mr, 1Co, Col, 1Pe, Re, and the rest of that set).
var books = []book{
	{1, "Genesis", "Gen.", "Ge"},
	{2, "Exodus", "Ex.", "Ex"},
	{3, "Leviticus", "Lev.", "Le"},
	{4, "Numbers", "Num.", "Nu"},
	{5, "Deuteronomy", "Deut.", "De"},
	{6, "Joshua", "Josh.", "Jos"},
	{7, "Judges", "Judg.", "Jg"},
	{8, "Ruth", "Ruth", "Ru"},
	{9, "1 Samuel", "1 Sam.", "1Sa"},
	{10, "2 Samuel", "2 Sam.", "2Sa"},
	{11, "1 Kings", "1 Ki.", "1Ki"},
	{12, "2 Kings", "2 Ki.", "2Ki"},
	{13, "1 Chronicles", "1 Chron.", "1Ch"},
	{14, "2 Chronicles", "2 Chron.", "2Ch"},
	{15, "Ezra", "Ezra", "Ezr"},
	{16, "Nehemiah", "Neh.", "Ne"},
	{17, "Esther", "Esther", "Es"},
	{18, "Job", "Job", "Job"},
	{19, "Psalms", "Ps.", "Ps"},
	{20, "Proverbs", "Prov.", "Pr"},
	{21, "Ecclesiastes", "Eccl.", "Ec"},
	{22, "Song of Solomon", "Song of Sol.", "Ca"},
	{23, "Isaiah", "Isa.", "Isa"},
	{24, "Jeremiah", "Jer.", "Jer"},
	{25, "Lamentations", "Lam.", "La"},
	{26, "Ezekiel", "Ezek.", "Eze"},
	{27, "Daniel", "Dan.", "Da"},
	{28, "Hosea", "Hos.", "Ho"},
	{29, "Joel", "Joel", "Joe"},
	{30, "Amos", "Amos", "Am"},
	{31, "Obadiah", "Obad.", "Ob"},
	{32, "Jonah", "Jonah", "Jon"},
	{33, "Micah", "Mic.", "Mic"},
	{34, "Nahum", "Nah.", "Na"},
	{35, "Habakkuk", "Hab.", "Hab"},
	{36, "Zephaniah", "Zeph.", "Zep"},
	{37, "Haggai", "Hag.", "Hag"},
	{38, "Zechariah", "Zech.", "Zec"},
	{39, "Malachi", "Mal.", "Mal"},
	{40, "Matthew", "Matt.", "Mt"},
	{41, "Mark", "Mark", "Mr"},
	{42, "Luke", "Luke", "Lu"},
	{43, "John", "John", "Joh"},
	{44, "Acts", "Acts", "Ac"},
	{45, "Romans", "Rom.", "Ro"},
	{46, "1 Corinthians", "1 Cor.", "1Co"},
	{47, "2 Corinthians", "2 Cor.", "2Co"},
	{48, "Galatians", "Gal.", "Ga"},
	{49, "Ephesians", "Eph.", "Eph"},
	{50, "Philippians", "Phil.", "Php"},
	{51, "Colossians", "Col.", "Col"},
	{52, "1 Thessalonians", "1 Thess.", "1Th"},
	{53, "2 Thessalonians", "2 Thess.", "2Th"},
	{54, "1 Timothy", "1 Tim.", "1Ti"},
	{55, "2 Timothy", "2 Tim.", "2Ti"},
	{56, "Titus", "Titus", "Tit"},
	{57, "Philemon", "Philem.", "Phm"},
	{58, "Hebrews", "Heb.", "Heb"},
	{59, "James", "Jas.", "Jas"},
	{60, "1 Peter", "1 Pet.", "1Pe"},
	{61, "2 Peter", "2 Pet.", "2Pe"},
	{62, "1 John", "1 John", "1Jo"},
	{63, "2 John", "2 John", "2Jo"},
	{64, "3 John", "3 John", "3Jo"},
	{65, "Jude", "Jude", "Jude"},
	{66, "Revelation", "Rev.", "Re"},
}

// singleChapter books are cited by verse alone: "Jude 9" is Jude 1:9.
var singleChapter = map[int]bool{31: true, 57: true, 63: true, 64: true, 65: true}

var bookByKey = map[string]int{}

func normKey(s string) string {
	return strings.ToLower(strings.NewReplacer(" ", "", ".", "", "\u00a0", "").Replace(s))
}

func init() {
	for _, b := range books {
		for _, name := range []string{b.name, b.long, b.short} {
			bookByKey[normKey(name)] = b.n
		}
	}
	bookByKey["psalm"] = 19
}

// BookName is the ordinary abbreviation used when a citation is printed.
func BookName(n int) string {
	if n < 1 || n > len(books) {
		return "?"
	}
	return books[n-1].long
}

// BookTitle is the full book name, such as "Matthew".
func BookTitle(n int) string {
	if n < 1 || n > len(books) {
		return "?"
	}
	return books[n-1].name
}

// BookTitles returns the 66 full book names, in book order.
func BookTitles() []string {
	out := make([]string, len(books))
	for i, b := range books {
		out[i] = b.name
	}
	return out
}

// BookByName reports the book number for a full name or an abbreviation.
func BookByName(s string) (int, bool) {
	n, ok := bookByKey[normKey(s)]
	return n, ok
}
