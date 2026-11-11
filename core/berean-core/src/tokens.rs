//! Word tokens: how JW Library counts the words of a verse or paragraph, so
//! a highlight's `StartToken` and `EndToken` (`userdata::TextRange`) can be
//! drawn on text and made from a selection.
//!
//! A token is a word or a single other character, like a punctuation mark.
//! A word is a run of letters, digits and combining marks; one other
//! character between two words keeps them together, so "36:17", "C.E" and
//! "Jehovah’s" are one token each. White space separates tokens, and so do
//! invisible format characters (a zero-width space), except a soft hyphen,
//! which sits inside its word. The first token is 0.
//!
//! The rule is JW Library's as the library mergers that read its backups
//! describe it: "You are my witnesses," is five tokens, the comma the fifth.
//! Verse numbers, footnote and cross-reference markers aren't counted;
//! [`crate::reader::VerseRun::text`] already leaves them out.

use unicode_normalization::char::is_combining_mark;

/// One token's place in a text, in UTF-16 code units (what JavaScript and
/// `NSString` index by): `start` inclusive, `end` exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenSpan {
    pub start: u32,
    pub end: u32,
}

const SOFT_HYPHEN: char = '\u{AD}';

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || is_combining_mark(c)
}

/// Invisible characters that end a token as a space does (Unicode's format
/// characters, `Cf`, the soft hyphen aside).
fn is_format(c: char) -> bool {
    matches!(c,
        '\u{600}'..='\u{605}'
        | '\u{61C}'
        | '\u{6DD}'
        | '\u{70F}'
        | '\u{180E}'
        | '\u{200B}'..='\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{206F}'
        | '\u{FEFF}'
        | '\u{FFF9}'..='\u{FFFB}')
}

fn is_separator(c: char) -> bool {
    c.is_whitespace() || is_format(c)
}

/// What a character is to the tokenizer.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Word,
    /// Inside a word's token, adding nothing to it: the soft hyphen.
    Silent,
    Separator,
    Other,
}

fn kind(c: char) -> Kind {
    if c == SOFT_HYPHEN {
        Kind::Silent
    } else if is_word(c) {
        Kind::Word
    } else if is_separator(c) {
        Kind::Separator
    } else {
        Kind::Other
    }
}

/// The tokens of `text`, in order.
pub fn tokenize(text: &str) -> Vec<TokenSpan> {
    // Each character with its UTF-16 offset, its end, and its kind.
    let mut chars = Vec::with_capacity(text.len());
    let mut at = 0u32;
    for c in text.chars() {
        let end = at + c.len_utf16() as u32;
        chars.push((at, end, kind(c)));
        at = end;
    }

    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let (start, end, k) = chars[i];
        match k {
            Kind::Separator | Kind::Silent => i += 1,
            Kind::Other => {
                tokens.push(TokenSpan { start, end });
                i += 1;
            }
            Kind::Word => {
                // A word, then any number of: one Other and another word.
                let mut last = end;
                let mut j = i + 1;
                loop {
                    while j < chars.len() && matches!(chars[j].2, Kind::Word | Kind::Silent) {
                        if chars[j].2 == Kind::Word {
                            last = chars[j].1;
                        }
                        j += 1;
                    }
                    let joins = j + 1 < chars.len()
                        && chars[j].2 == Kind::Other
                        && chars[j + 1].2 == Kind::Word;
                    if !joins {
                        break;
                    }
                    last = chars[j + 1].1;
                    j += 2;
                }
                tokens.push(TokenSpan { start, end: last });
                i = j;
            }
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(text: &str) -> Vec<String> {
        let units: Vec<u16> = text.encode_utf16().collect();
        tokenize(text)
            .iter()
            .map(|t| String::from_utf16(&units[t.start as usize..t.end as usize]).unwrap())
            .collect()
    }

    #[test]
    fn counts_words_and_punctuation() {
        assert_eq!(
            words("You are my witnesses,"),
            ["You", "are", "my", "witnesses", ","]
        );
    }

    #[test]
    fn keeps_a_word_joined_by_one_character() {
        // The library mergers' own example: 13 tokens, "33\u{a0}C.E.," is 1..=4,
        // "Jehovah’s “people”" 5..=8 and "—Acts 2:41." 9..=12.
        let text = "In 33\u{a0}C.E., Jehovah’s “people”\u{200b}—Acts 2:41.";
        assert_eq!(
            words(text),
            [
                "In",
                "33",
                "C.E",
                ".",
                ",",
                "Jehovah’s",
                "“",
                "people",
                "”",
                "—",
                "Acts",
                "2:41",
                "."
            ]
        );
    }

    #[test]
    fn two_characters_between_words_split_them() {
        assert_eq!(words("word.—word"), ["word", ".", "—", "word"]);
        assert_eq!(words("well-being—"), ["well-being", "—"]);
    }

    #[test]
    fn a_soft_hyphen_stays_inside_its_word() {
        assert_eq!(words("every\u{ad}thing"), ["every\u{ad}thing"]);
        assert_eq!(words("a\u{200b}b"), ["a", "b"]);
    }

    #[test]
    fn combining_marks_and_other_scripts() {
        assert_eq!(words("cafe\u{301} noir"), ["cafe\u{301}", "noir"]);
        assert_eq!(words("नमस्ते दुनिया।"), ["नमस्ते", "दुनिया", "।"]);
        assert_eq!(words("Jesús lloró."), ["Jesús", "lloró", "."]);
    }

    #[test]
    fn offsets_are_utf16() {
        // "𝐀" is two UTF-16 units; the word after it starts at 3.
        assert_eq!(
            tokenize("𝐀 b"),
            [
                TokenSpan { start: 0, end: 2 },
                TokenSpan { start: 3, end: 4 }
            ]
        );
    }

    #[test]
    fn nothing_to_count() {
        assert!(tokenize("").is_empty());
        assert!(tokenize(" \u{a0}\u{200b} ").is_empty());
    }
}
