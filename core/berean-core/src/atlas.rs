//! Bible maps and timeline: a small, cited dataset of places, people,
//! periods and events, compiled into the core so it works offline.
//!
//! The four files under `data/atlas/` are the source of truth (see
//! `docs/design/map-timeline-data.md`). They are compiled in with
//! `include_str!` and parsed once, like `languages.tsv`. A malformed file is
//! a bug and panics; the unit tests parse and check every file.
//!
//! The pilot covers Paul's missionary journeys (Acts 13–28). Each fact cites
//! the publication that states it. Coordinates come from Pleiades and are
//! only given where they agree with the publications; a place without
//! them is listed, never drawn.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::CoreError;

const PLACES: &str = include_str!("../data/atlas/places.json");
const PEOPLE: &str = include_str!("../data/atlas/people.json");
const PERIODS: &str = include_str!("../data/atlas/periods.json");
const EVENTS: &str = include_str!("../data/atlas/events.json");

/// How sure the publications are of an identification or a date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    /// Named without hedging.
    Established,
    /// Hedged ("usually identified", "about"), or located only by distance.
    Likely,
    /// Competing sites, or no location given.
    Uncertain,
}

/// What a place is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaceKind {
    City,
    Port,
    Harbor,
    Station,
    Island,
    Cape,
    Bay,
    /// A province or district: listed, never a point on the map.
    Region,
}

/// How exactly a point marks the place (Pleiades' `locationPrecision`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Precision {
    /// The site itself.
    Precise,
    /// Somewhere near.
    Rough,
    /// A representative point for something larger, such as an island.
    Related,
}

/// A point on the map, and the gazetteer it comes from.
#[derive(Debug, Clone, PartialEq)]
pub struct Coordinates {
    pub lat: f64,
    pub lon: f64,
    pub precision: Precision,
    /// The gazetteer, e.g. `Pleiades`.
    pub source: String,
    /// The gazetteer's page for the point, when it has one.
    pub source_url: Option<String>,
}

/// Where a fact comes from: a publication on wol.jw.org.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Citation {
    /// The publication's symbol, e.g. `it-2`, `nwtsty`, `gl`.
    pub publication: String,
    /// Where in it, e.g. `it-2 p. 205, “LASEA” (WOL ¶3)`.
    pub location: String,
    /// The page on wol.jw.org.
    pub url: String,
    /// A short verbatim quote (at most 25 words), when there is one.
    pub quote: Option<String>,
}

/// What kind of remark a note is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    /// Two sources disagree; both sides are given.
    Conflict,
    /// Something the sources don't cover.
    Gap,
    Note,
}

/// A remark on a place or period, for a reader who wants the detail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtlasNote {
    pub kind: NoteKind,
    pub text: String,
}

/// Another site proposed for a place.
#[derive(Debug, Clone, PartialEq)]
pub struct AlternateSite {
    pub name: String,
    /// A point, when a gazetteer has one. Not drawn by default.
    pub coordinates: Option<Coordinates>,
    /// The publications reject this site.
    pub rejected: bool,
    pub note: Option<String>,
    pub citations: Vec<Citation>,
}

/// A place that appears in the accounts.
#[derive(Debug, Clone, PartialEq)]
pub struct Place {
    /// `place:<slug>`, e.g. `place:antioch-pisidia`.
    pub id: String,
    pub kind: PlaceKind,
    /// The New World Translation's name.
    pub name: String,
    /// Other spellings and modern names the publications use.
    pub alternate_names: Vec<String>,
    /// How sure the publications are of where it was.
    pub confidence: Confidence,
    /// `None` when no gazetteer point agrees with the publications (and for
    /// every region).
    pub coordinates: Option<Coordinates>,
    /// The place it lies in, e.g. St. Paul's Bay in Malta.
    pub parent: Option<String>,
    pub alternate_sites: Vec<AlternateSite>,
    pub citations: Vec<Citation>,
    pub notes: Vec<AtlasNote>,
}

/// A person who appears in the accounts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person {
    /// `person:<slug>`, e.g. `person:john-mark`.
    pub id: String,
    pub name: String,
    pub alternate_names: Vec<String>,
    pub citations: Vec<Citation>,
}

/// When something happened: a span of years. Years are CE when positive and
/// BCE when negative; there is no year 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dating {
    pub start: i32,
    pub end: i32,
    /// "About" or "c.": true on every date in the pilot.
    pub approx: bool,
    pub confidence: Confidence,
    /// The event has no date of its own and takes its period's.
    pub inherited: bool,
}

/// A verse, or half of one (`part` is `a` or `b`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct VersePoint {
    pub chapter: u32,
    pub verse: u32,
    pub part: Option<char>,
}

/// A passage within one Bible book.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scripture {
    /// The NWT book number, e.g. 44 for Acts.
    pub book: u32,
    pub start: VersePoint,
    /// Equal to `start` for a single verse.
    pub end: VersePoint,
    /// The full reference, e.g. `Acts 17:22b-31`.
    pub reference: String,
}

impl Scripture {
    /// Whether the passage shares a verse with chapters `first..=last` of
    /// `book`.
    pub fn overlaps_chapters(&self, book: u32, first: u32, last: u32) -> bool {
        self.book == book && self.start.chapter <= last && self.end.chapter >= first
    }
}

/// A stop on a period's route, as the map in *See the Good Land* labels it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteStop {
    /// The map's label, e.g. `Antioch (of Syria)`.
    pub label: String,
    pub place_id: String,
}

/// What a period is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PeriodKind {
    Journey,
    Custody,
}

/// A named span of time, such as Paul's second missionary tour.
#[derive(Debug, Clone, PartialEq)]
pub struct Period {
    /// `period:<slug>`.
    pub id: String,
    pub kind: PeriodKind,
    pub name: String,
    pub alternate_names: Vec<String>,
    pub dating: Dating,
    pub scripture: Scripture,
    /// The route in travel order; places may repeat (a return visit), and
    /// regions, which have no point, are on it too. Empty for a stay.
    pub route: Vec<RouteStop>,
    pub citations: Vec<Citation>,
    pub notes: Vec<AtlasNote>,
}

/// Whether an event is a journey between places or something that happened
/// in one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Leg,
    Stop,
}

/// An outline-level part of the account, titled as the NWT study edition's
/// outline titles it.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    /// `event:<slug>`, e.g. `event:acts-16-11-15`.
    pub id: String,
    pub kind: EventKind,
    pub name: String,
    pub scripture: Scripture,
    /// Its order in the account.
    pub sequence: u32,
    /// Usually one; none for an event between periods (the Jerusalem
    /// meeting of Acts 15 falls between the first and second tours).
    pub period_ids: Vec<String>,
    /// In travel order for a leg.
    pub place_ids: Vec<String>,
    pub person_ids: Vec<String>,
    pub dating: Dating,
    pub citations: Vec<Citation>,
}

/// A source the app must credit wherever it shows the data it gave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attribution {
    pub name: String,
    /// What it supplied, e.g. `Coordinates`.
    pub supplied: String,
    pub url: String,
    pub license: String,
    pub license_url: String,
}

// ---- The raw files -------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawNames {
    nwt: String,
    #[serde(default)]
    alternate: Vec<String>,
}

#[derive(Deserialize)]
struct RawCitation {
    publication: String,
    location: String,
    url: String,
    quote: Option<String>,
}

impl From<RawCitation> for Citation {
    fn from(c: RawCitation) -> Self {
        Citation {
            publication: c.publication,
            location: c.location,
            url: c.url,
            quote: c.quote,
        }
    }
}

#[derive(Deserialize)]
struct RawNote {
    kind: NoteKind,
    text: String,
}

#[derive(Deserialize)]
struct RawCoordinates {
    lat: f64,
    lon: f64,
    source: String,
    source_url: Option<String>,
    precision: Option<Precision>,
}

impl RawCoordinates {
    fn into_coordinates(self) -> Coordinates {
        Coordinates {
            lat: self.lat,
            lon: self.lon,
            // An alternate site's point gives no precision: it marks the site.
            precision: self.precision.unwrap_or(Precision::Precise),
            source: self.source,
            source_url: self.source_url,
        }
    }
}

#[derive(Deserialize)]
struct RawIdentification {
    confidence: Confidence,
}

#[derive(Deserialize)]
struct RawAlternateSite {
    name: String,
    coordinates: Option<RawCoordinates>,
    status: Option<String>,
    note: Option<String>,
    #[serde(default)]
    citations: Vec<RawCitation>,
}

#[derive(Deserialize)]
struct RawPlace {
    id: String,
    #[serde(rename = "type")]
    kind: PlaceKind,
    names: RawNames,
    identification: RawIdentification,
    coordinates: Option<RawCoordinates>,
    parent: Option<String>,
    #[serde(default)]
    alternate_sites: Vec<RawAlternateSite>,
    #[serde(default)]
    citations: Vec<RawCitation>,
    #[serde(default)]
    notes: Vec<RawNote>,
}

#[derive(Deserialize)]
struct RawPerson {
    id: String,
    names: RawNames,
    #[serde(default)]
    citations: Vec<RawCitation>,
}

#[derive(Deserialize, Clone, Copy)]
struct RawYear {
    year: i32,
    #[serde(default)]
    approx: bool,
}

#[derive(Deserialize)]
struct RawDate {
    start: RawYear,
    end: RawYear,
    confidence: Confidence,
    basis: Option<String>,
}

#[derive(Deserialize)]
struct RawVerse {
    chapter: u32,
    verse: u32,
    part: Option<String>,
}

#[derive(Deserialize)]
struct RawScriptureRef {
    book: u32,
    book_name: String,
    start: RawVerse,
    end: RawVerse,
}

#[derive(Deserialize)]
struct RawRouteStop {
    label: String,
    place: String,
}

#[derive(Deserialize)]
struct RawPeriod {
    id: String,
    #[serde(rename = "type")]
    kind: PeriodKind,
    names: RawNames,
    date: RawDate,
    scripture: String,
    scripture_ref: RawScriptureRef,
    #[serde(default)]
    route_gl: Vec<RawRouteStop>,
    #[serde(default)]
    citations: Vec<RawCitation>,
    #[serde(default)]
    notes: Vec<RawNote>,
}

#[derive(Deserialize)]
struct RawEvent {
    id: String,
    #[serde(rename = "type")]
    kind: EventKind,
    names: RawNames,
    scripture: String,
    scripture_ref: RawScriptureRef,
    sequence: u32,
    #[serde(default)]
    periods: Vec<String>,
    #[serde(default)]
    places: Vec<String>,
    #[serde(default)]
    people: Vec<String>,
    date: RawDate,
    #[serde(default)]
    citations: Vec<RawCitation>,
}

#[derive(Deserialize)]
struct PlacesFile {
    version: String,
    places: Vec<RawPlace>,
}

#[derive(Deserialize)]
struct PeopleFile {
    version: String,
    people: Vec<RawPerson>,
}

#[derive(Deserialize)]
struct PeriodsFile {
    version: String,
    periods: Vec<RawPeriod>,
}

#[derive(Deserialize)]
struct EventsFile {
    version: String,
    events: Vec<RawEvent>,
}

// ---- Conversion ----------------------------------------------------------

fn part(raw: Option<String>) -> Result<Option<char>, String> {
    match raw.as_deref() {
        None => Ok(None),
        Some("a") => Ok(Some('a')),
        Some("b") => Ok(Some('b')),
        Some(other) => Err(format!("verse part {other:?} is not a or b")),
    }
}

fn verse_point(raw: RawVerse) -> Result<VersePoint, String> {
    Ok(VersePoint {
        chapter: raw.chapter,
        verse: raw.verse,
        part: part(raw.part)?,
    })
}

/// The reference for `start..=end` of `book_name`, in the style of the
/// WOL: `-` within a chapter, `–` across chapters, `, ` for two verses in a
/// row, and half verses as `22a` or `22b`.
pub fn format_reference(book_name: &str, start: VersePoint, end: VersePoint) -> String {
    let verse = |v: VersePoint| match v.part {
        Some(p) => format!("{}{p}", v.verse),
        None => v.verse.to_string(),
    };
    let first = format!("{book_name} {}:{}", start.chapter, verse(start));
    if start == end {
        first
    } else if start.chapter != end.chapter {
        format!("{first}–{}:{}", end.chapter, verse(end))
    } else if end.verse == start.verse + 1 && start.part.is_none() && end.part.is_none() {
        format!("{first}, {}", verse(end))
    } else {
        format!("{first}-{}", verse(end))
    }
}

fn scripture(raw: RawScriptureRef) -> Result<Scripture, String> {
    let start = verse_point(raw.start)?;
    let end = verse_point(raw.end)?;
    Ok(Scripture {
        book: raw.book,
        reference: format_reference(&raw.book_name, start, end),
        start,
        end,
    })
}

fn dating(raw: &RawDate) -> Dating {
    Dating {
        start: raw.start.year,
        end: raw.end.year,
        approx: raw.start.approx || raw.end.approx,
        confidence: raw.confidence,
        inherited: raw.basis.as_deref() == Some(INHERITED),
    }
}

const INHERITED: &str = "inherited from period";

fn citations(raw: Vec<RawCitation>) -> Vec<Citation> {
    raw.into_iter().map(Into::into).collect()
}

fn notes(raw: Vec<RawNote>) -> Vec<AtlasNote> {
    raw.into_iter()
        .map(|n| AtlasNote {
            kind: n.kind,
            text: n.text,
        })
        .collect()
}

struct Dataset {
    version: String,
    places: Vec<Place>,
    people: Vec<Person>,
    /// Chronological: by start year, then where they start in the account.
    periods: Vec<Period>,
    /// By sequence.
    events: Vec<Event>,
    place_index: HashMap<String, usize>,
    person_index: HashMap<String, usize>,
    period_index: HashMap<String, usize>,
}

/// The WOL's book abbreviations, which the files' `scripture` strings use,
/// e.g. `Ac` for Acts.
const ABBREVIATIONS: &[(u32, &str)] = &[(44, "Ac")];

fn parse(places: &str, people: &str, periods: &str, events: &str) -> Result<Dataset, String> {
    let places: PlacesFile = serde_json::from_str(places).map_err(|e| format!("places: {e}"))?;
    let people: PeopleFile = serde_json::from_str(people).map_err(|e| format!("people: {e}"))?;
    let periods: PeriodsFile =
        serde_json::from_str(periods).map_err(|e| format!("periods: {e}"))?;
    let events: EventsFile = serde_json::from_str(events).map_err(|e| format!("events: {e}"))?;
    let version = places.version.clone();
    for (file, v) in [
        ("people", &people.version),
        ("periods", &periods.version),
        ("events", &events.version),
    ] {
        if *v != version {
            return Err(format!("{file} is version {v}, places is {version}"));
        }
    }

    let places = places
        .places
        .into_iter()
        .map(|p| {
            let alternate_sites = p
                .alternate_sites
                .into_iter()
                .map(|s| AlternateSite {
                    name: s.name,
                    coordinates: s.coordinates.map(RawCoordinates::into_coordinates),
                    rejected: s.status.as_deref() == Some("rejected"),
                    note: s.note,
                    citations: citations(s.citations),
                })
                .collect();
            Place {
                id: p.id,
                kind: p.kind,
                name: p.names.nwt,
                alternate_names: p.names.alternate,
                confidence: p.identification.confidence,
                coordinates: p.coordinates.map(RawCoordinates::into_coordinates),
                parent: p.parent,
                alternate_sites,
                citations: citations(p.citations),
                notes: notes(p.notes),
            }
        })
        .collect::<Vec<_>>();

    let people = people
        .people
        .into_iter()
        .map(|p| Person {
            id: p.id,
            name: p.names.nwt,
            alternate_names: p.names.alternate,
            citations: citations(p.citations),
        })
        .collect::<Vec<_>>();

    let mut raw_texts = Vec::new();
    let mut periods = periods
        .periods
        .into_iter()
        .map(|p| {
            let dating = dating(&p.date);
            raw_texts.push((p.id.clone(), p.scripture.clone(), p.scripture_ref.book));
            Ok(Period {
                id: p.id,
                kind: p.kind,
                name: p.names.nwt,
                alternate_names: p.names.alternate,
                dating,
                scripture: scripture(p.scripture_ref)?,
                route: p
                    .route_gl
                    .into_iter()
                    .map(|s| RouteStop {
                        label: s.label,
                        place_id: s.place,
                    })
                    .collect(),
                citations: citations(p.citations),
                notes: notes(p.notes),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    periods.sort_by_key(|p| (p.dating.start, p.scripture.book, p.scripture.start));

    let mut events = events
        .events
        .into_iter()
        .map(|e| {
            let dating = dating(&e.date);
            raw_texts.push((e.id.clone(), e.scripture.clone(), e.scripture_ref.book));
            Ok(Event {
                id: e.id,
                kind: e.kind,
                name: e.names.nwt,
                scripture: scripture(e.scripture_ref)?,
                sequence: e.sequence,
                period_ids: e.periods,
                place_ids: e.places,
                person_ids: e.people,
                dating,
                citations: citations(e.citations),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    events.sort_by_key(|e| e.sequence);

    let index = |ids: Vec<&String>, kind: &str| -> Result<HashMap<String, usize>, String> {
        let mut map = HashMap::new();
        for (i, id) in ids.into_iter().enumerate() {
            let slug = id
                .strip_prefix(kind)
                .and_then(|rest| rest.strip_prefix(':'))
                .ok_or_else(|| format!("{id} is not a {kind}:<slug> id"))?;
            if slug.is_empty()
                || !slug
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            {
                return Err(format!("{id} has a malformed slug"));
            }
            if map.insert(id.clone(), i).is_some() {
                return Err(format!("{id} appears twice"));
            }
        }
        Ok(map)
    };
    let place_index = index(places.iter().map(|p| &p.id).collect(), "place")?;
    let person_index = index(people.iter().map(|p| &p.id).collect(), "person")?;
    let period_index = index(periods.iter().map(|p| &p.id).collect(), "period")?;
    index(events.iter().map(|e| &e.id).collect(), "event")?;

    let dataset = Dataset {
        version,
        places,
        people,
        periods,
        events,
        place_index,
        person_index,
        period_index,
    };
    check(&dataset, &raw_texts)?;
    Ok(dataset)
}

/// The consistency rules from the design doc. Any failure is a data bug.
fn check(d: &Dataset, raw_texts: &[(String, String, u32)]) -> Result<(), String> {
    let place = |id: &str, from: &str| {
        if d.place_index.contains_key(id) {
            Ok(())
        } else {
            Err(format!("{from} names unknown {id}"))
        }
    };
    for p in &d.places {
        if let Some(parent) = &p.parent {
            place(parent, &p.id)?;
        }
        if let Some(c) = &p.coordinates {
            if !(-90.0..=90.0).contains(&c.lat) || !(-180.0..=180.0).contains(&c.lon) {
                return Err(format!("{} has coordinates off the globe", p.id));
            }
        }
        if p.kind == PlaceKind::Region && p.coordinates.is_some() {
            return Err(format!("{} is a region with a point", p.id));
        }
    }
    let dates = |id: &str, t: &Dating| {
        if t.start == 0 || t.end == 0 {
            return Err(format!("{id} has year 0"));
        }
        if t.start > t.end {
            return Err(format!("{id} ends before it starts"));
        }
        Ok(())
    };
    let range = |id: &str, s: &Scripture| {
        if s.start > s.end {
            return Err(format!("{id} has a scripture that ends before it starts"));
        }
        Ok(())
    };
    for p in &d.periods {
        dates(&p.id, &p.dating)?;
        range(&p.id, &p.scripture)?;
        if p.dating.inherited {
            return Err(format!("{} is a period that inherits its date", p.id));
        }
        for stop in &p.route {
            place(&stop.place_id, &p.id)?;
        }
    }
    for e in &d.events {
        dates(&e.id, &e.dating)?;
        range(&e.id, &e.scripture)?;
        if e.dating.inherited && e.period_ids.is_empty() {
            return Err(format!("{} inherits a date but is in no period", e.id));
        }
        for id in &e.place_ids {
            place(id, &e.id)?;
        }
        for id in &e.person_ids {
            if !d.person_index.contains_key(id) {
                return Err(format!("{} names unknown {id}", e.id));
            }
        }
        for id in &e.period_ids {
            let period = d
                .period_index
                .get(id)
                .map(|&i| &d.periods[i])
                .ok_or_else(|| format!("{} names unknown {id}", e.id))?;
            if e.dating.inherited
                && (e.dating.start, e.dating.end) != (period.dating.start, period.dating.end)
            {
                return Err(format!("{} inherits a date {id} doesn't have", e.id));
            }
            let s = &e.scripture;
            let ps = &period.scripture;
            let (start, end) = (strip(s.start), strip(s.end));
            if s.book != ps.book || start < strip(ps.start) || end > strip(ps.end) {
                return Err(format!("{} ({}) lies outside {id}", e.id, s.reference));
            }
        }
    }
    // The files' own scripture strings, in WOL abbreviations, must be what
    // the structured references format back to.
    for (id, text, book) in raw_texts {
        let abbreviation = ABBREVIATIONS
            .iter()
            .find(|(b, _)| b == book)
            .map(|(_, a)| *a)
            .ok_or_else(|| format!("{id}: no abbreviation for book {book}"))?;
        let scripture = d
            .periods
            .iter()
            .find(|p| &p.id == id)
            .map(|p| &p.scripture)
            .or_else(|| d.events.iter().find(|e| &e.id == id).map(|e| &e.scripture))
            .ok_or_else(|| format!("{id} vanished"))?;
        let formatted = format_reference(abbreviation, scripture.start, scripture.end);
        if formatted != *text {
            return Err(format!(
                "{id}: scripture {text:?} but its reference formats as {formatted:?}"
            ));
        }
    }
    Ok(())
}

/// A verse without its half, for range checks: a half verse lies within
/// its whole verse.
fn strip(v: VersePoint) -> VersePoint {
    VersePoint { part: None, ..v }
}

fn dataset() -> &'static Dataset {
    static DATA: OnceLock<Dataset> = OnceLock::new();
    DATA.get_or_init(|| {
        parse(PLACES, PEOPLE, PERIODS, EVENTS).unwrap_or_else(|e| panic!("atlas data: {e}"))
    })
}

// ---- The API -------------------------------------------------------------

/// The map and timeline dataset. It needs no storage: the data is part of
/// the build, so every call is cheap and never touches the disk.
#[derive(Debug, Clone, Copy, Default)]
pub struct Atlas;

impl Atlas {
    /// The dataset's version, e.g. `pilot-2026-10-28.2`.
    pub fn version(&self) -> String {
        dataset().version.clone()
    }

    /// Every period, in time order.
    pub fn periods(&self) -> Vec<Period> {
        dataset().periods.clone()
    }

    /// The period `id`; `NotFound` if there is none.
    pub fn period(&self, id: &str) -> Result<Period, CoreError> {
        let d = dataset();
        d.period_index
            .get(id)
            .map(|&i| d.periods[i].clone())
            .ok_or(CoreError::NotFound)
    }

    /// The events of period `id` in the order of the account; `NotFound` if
    /// there is no such period.
    pub fn events(&self, period_id: &str) -> Result<Vec<Event>, CoreError> {
        let d = dataset();
        if !d.period_index.contains_key(period_id) {
            return Err(CoreError::NotFound);
        }
        Ok(d.events
            .iter()
            .filter(|e| e.period_ids.iter().any(|p| p == period_id))
            .cloned()
            .collect())
    }

    /// Every event, in the order of the account.
    pub fn all_events(&self) -> Vec<Event> {
        dataset().events.clone()
    }

    /// The events whose passage shares a verse with chapters
    /// `first_chapter..=last_chapter` of Bible book `book`, in the order of
    /// the account. Empty where the dataset has nothing.
    pub fn events_in_chapters(
        &self,
        book: u32,
        first_chapter: u32,
        last_chapter: u32,
    ) -> Vec<Event> {
        dataset()
            .events
            .iter()
            .filter(|e| {
                e.scripture
                    .overlaps_chapters(book, first_chapter, last_chapter)
            })
            .cloned()
            .collect()
    }

    /// The events at place `id` (or at a place inside it), in the order of
    /// the account; `NotFound` if there is no such place.
    pub fn events_at(&self, place_id: &str) -> Result<Vec<Event>, CoreError> {
        let d = dataset();
        if !d.place_index.contains_key(place_id) {
            return Err(CoreError::NotFound);
        }
        let within = |id: &String| {
            id == place_id
                || d.place_index
                    .get(id)
                    .and_then(|&i| d.places[i].parent.as_deref())
                    == Some(place_id)
        };
        Ok(d.events
            .iter()
            .filter(|e| e.place_ids.iter().any(within))
            .cloned()
            .collect())
    }

    /// Every place, in the files' order.
    pub fn places(&self) -> Vec<Place> {
        dataset().places.clone()
    }

    /// The place `id`; `NotFound` if there is none.
    pub fn place(&self, id: &str) -> Result<Place, CoreError> {
        let d = dataset();
        d.place_index
            .get(id)
            .map(|&i| d.places[i].clone())
            .ok_or(CoreError::NotFound)
    }

    /// Every person, in the files' order.
    pub fn people(&self) -> Vec<Person> {
        dataset().people.clone()
    }

    /// The person `id`; `NotFound` if there is none.
    pub fn person(&self, id: &str) -> Result<Person, CoreError> {
        let d = dataset();
        d.person_index
            .get(id)
            .map(|&i| d.people[i].clone())
            .ok_or(CoreError::NotFound)
    }

    /// The sources to credit wherever coordinates are shown (their licences
    /// require it).
    pub fn attributions(&self) -> Vec<Attribution> {
        vec![
            Attribution {
                name: "Pleiades".into(),
                supplied: "Coordinates".into(),
                url: "https://pleiades.stoa.org".into(),
                license: "CC BY 3.0".into(),
                license_url: "https://creativecommons.org/licenses/by/3.0/".into(),
            },
            Attribution {
                name: "OpenBible.info Bible Geocoding".into(),
                supplied: "Coordinate cross-checks".into(),
                url: "https://www.openbible.info/geo/".into(),
                license: "CC BY 4.0".into(),
                license_url: "https://creativecommons.org/licenses/by/4.0/".into(),
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn atlas() -> Atlas {
        Atlas
    }

    #[test]
    fn the_files_parse_and_pass_every_check() {
        let d = parse(PLACES, PEOPLE, PERIODS, EVENTS).unwrap();
        assert_eq!(d.version, "pilot-2026-10-28.2");
        assert_eq!(d.places.len(), 68);
        assert_eq!(d.people.len(), 18);
        assert_eq!(d.periods.len(), 5);
        assert_eq!(d.events.len(), 47);
    }

    fn with_events(f: impl FnOnce(&mut serde_json::Value)) -> Result<Dataset, String> {
        let mut events: serde_json::Value = serde_json::from_str(EVENTS).unwrap();
        f(&mut events);
        parse(PLACES, PEOPLE, PERIODS, &events.to_string())
    }

    fn first_event(v: &mut serde_json::Value) -> &mut serde_json::Value {
        &mut v["events"][0]
    }

    #[test]
    fn year_zero_is_rejected() {
        let err = with_events(|v| first_event(v)["date"]["start"]["year"] = 0.into())
            .err()
            .unwrap();
        assert!(err.contains("year 0"), "{err}");
    }

    #[test]
    fn a_date_that_ends_before_it_starts_is_rejected() {
        let err = with_events(|v| {
            let e = first_event(v);
            e["date"]["start"]["year"] = 50.into();
            e["date"]["end"]["year"] = 49.into();
            e["date"]["basis"] = "cited".into();
        })
        .err()
        .unwrap();
        assert!(err.contains("ends before it starts"), "{err}");
    }

    #[test]
    fn an_inherited_date_must_match_its_period() {
        let err = with_events(|v| first_event(v)["date"]["end"]["year"] = 49.into())
            .err()
            .unwrap();
        assert!(err.contains("inherits"), "{err}");
    }

    #[test]
    fn unknown_references_are_rejected() {
        let err = with_events(|v| first_event(v)["places"][0] = "place:atlantis".into())
            .err()
            .unwrap();
        assert!(err.contains("place:atlantis"), "{err}");
        let err = with_events(|v| first_event(v)["people"][0] = "person:nobody".into())
            .err()
            .unwrap();
        assert!(err.contains("person:nobody"), "{err}");
    }

    #[test]
    fn duplicate_and_malformed_ids_are_rejected() {
        let err = with_events(|v| {
            let id = v["events"][1]["id"].clone();
            first_event(v)["id"] = id;
        })
        .err()
        .unwrap();
        assert!(err.contains("twice"), "{err}");
        let err = with_events(|v| first_event(v)["id"] = "acts-13-1-3".into())
            .err()
            .unwrap();
        assert!(err.contains("event:<slug>"), "{err}");
        let err = with_events(|v| first_event(v)["id"] = "event:Acts 13".into())
            .err()
            .unwrap();
        assert!(err.contains("malformed slug"), "{err}");
    }

    #[test]
    fn an_event_outside_its_period_is_rejected() {
        let err = with_events(|v| {
            let e = first_event(v);
            e["scripture"] = "Ac 12:1-3".into();
            e["scripture_ref"]["start"]["chapter"] = 12.into();
            e["scripture_ref"]["end"]["chapter"] = 12.into();
        })
        .err()
        .unwrap();
        assert!(err.contains("lies outside"), "{err}");
    }

    #[test]
    fn a_scripture_string_must_match_its_reference() {
        let err = with_events(|v| first_event(v)["scripture"] = "Ac 13:1-4".into())
            .err()
            .unwrap();
        assert!(err.contains("formats as"), "{err}");
    }

    #[test]
    fn mismatched_versions_are_rejected() {
        let mut people: serde_json::Value = serde_json::from_str(PEOPLE).unwrap();
        people["version"] = "other".into();
        let err = parse(PLACES, &people.to_string(), PERIODS, EVENTS)
            .err()
            .unwrap();
        assert!(err.contains("version"), "{err}");
    }

    #[test]
    fn references_format_in_wol_style() {
        let v = |chapter, verse, part| VersePoint {
            chapter,
            verse,
            part,
        };
        assert_eq!(
            format_reference("Acts", v(13, 1, None), v(13, 3, None)),
            "Acts 13:1-3"
        );
        assert_eq!(
            format_reference("Acts", v(13, 4, None), v(13, 4, None)),
            "Acts 13:4"
        );
        assert_eq!(
            format_reference("Acts", v(13, 1, None), v(14, 28, None)),
            "Acts 13:1–14:28"
        );
        assert_eq!(
            format_reference("Acts", v(16, 11, None), v(16, 12, None)),
            "Acts 16:11, 12"
        );
        assert_eq!(
            format_reference("Acts", v(17, 22, Some('b')), v(17, 31, None)),
            "Acts 17:22b-31"
        );
    }

    #[test]
    fn periods_are_in_time_order() {
        let periods = atlas().periods();
        let ids: Vec<_> = periods.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "period:paul-first-missionary-journey",
                "period:paul-second-missionary-journey",
                "period:paul-third-missionary-journey",
                "period:paul-arrest-and-custody-in-caesarea",
                "period:paul-trip-to-rome",
            ]
        );
        let first = &periods[0];
        assert_eq!(first.name, "Paul’s first missionary tour");
        assert_eq!((first.dating.start, first.dating.end), (47, 48));
        assert!(first.dating.approx);
        assert_eq!(first.scripture.reference, "Acts 13:1–14:28");
        assert_eq!(first.route[0].place_id, "place:antioch-syria");
        assert!(periods[3].route.is_empty());
    }

    #[test]
    fn a_periods_events_come_in_account_order() {
        let events = atlas()
            .events("period:paul-first-missionary-journey")
            .unwrap();
        assert_eq!(events[0].id, "event:acts-13-1-3");
        assert_eq!(events[0].kind, EventKind::Stop);
        assert!(events[0].dating.inherited);
        assert!(events.windows(2).all(|w| w[0].sequence < w[1].sequence));
        assert!(events
            .iter()
            .all(|e| e.scripture.start.chapter >= 13 && e.scripture.end.chapter <= 14));
        assert!(matches!(
            atlas().events("period:nowhere"),
            Err(CoreError::NotFound)
        ));
    }

    #[test]
    fn events_in_a_chapter() {
        let atlas = atlas();
        let in_16 = atlas.events_in_chapters(44, 16, 16);
        assert!(!in_16.is_empty());
        assert!(in_16
            .iter()
            .all(|e| e.scripture.start.chapter <= 16 && e.scripture.end.chapter >= 16));
        assert!(in_16
            .iter()
            .any(|e| e.place_ids.iter().any(|p| p == "place:philippi")));
        // Before the journeys, and another book.
        assert!(atlas.events_in_chapters(44, 1, 12).is_empty());
        assert!(atlas.events_in_chapters(43, 16, 16).is_empty());
    }

    #[test]
    fn places_and_their_events() {
        let atlas = atlas();
        let derbe = atlas.place("place:derbe").unwrap();
        assert_eq!(derbe.name, "Derbe");
        assert_eq!(derbe.kind, PlaceKind::City);
        assert_eq!(derbe.confidence, Confidence::Established);
        let c = derbe.coordinates.unwrap();
        assert_eq!(c.source, "Pleiades");
        assert!((c.lat - 37.349).abs() < 0.01);

        // Withheld: Insight disagrees with the gazetteer.
        let lasea = atlas.place("place:lasea").unwrap();
        assert!(lasea.coordinates.is_none());
        assert_eq!(lasea.notes[0].kind, NoteKind::Conflict);

        let galatia = atlas.place("place:galatia").unwrap();
        assert_eq!(galatia.kind, PlaceKind::Region);
        assert!(galatia.coordinates.is_none());

        let malta = atlas.place("place:malta").unwrap();
        assert!(malta.alternate_sites.iter().any(|s| s.rejected));
        // St. Paul's Bay lies in Malta, so its events are Malta's too.
        let at_malta = atlas.events_at("place:malta").unwrap();
        assert!(at_malta.iter().all(|e| e
            .period_ids
            .contains(&"period:paul-trip-to-rome".to_string())));
        assert!(!at_malta.is_empty());

        let philippi = atlas.events_at("place:philippi").unwrap();
        assert!(philippi.windows(2).all(|w| w[0].sequence < w[1].sequence));
        assert!(matches!(
            atlas.place("place:atlantis"),
            Err(CoreError::NotFound)
        ));
        assert!(matches!(
            atlas.events_at("place:atlantis"),
            Err(CoreError::NotFound)
        ));
    }

    #[test]
    fn people() {
        let atlas = atlas();
        let paul = atlas.person("person:paul").unwrap();
        assert_eq!(paul.alternate_names, ["Saul"]);
        assert_eq!(atlas.people().len(), 18);
        assert!(matches!(
            atlas.person("person:nobody"),
            Err(CoreError::NotFound)
        ));
    }

    #[test]
    fn every_drawable_place_is_in_the_mediterranean() {
        for p in atlas().places() {
            if let Some(c) = p.coordinates {
                assert!((30.0..45.0).contains(&c.lat), "{}", p.id);
                assert!((10.0..40.0).contains(&c.lon), "{}", p.id);
            }
        }
    }
}
