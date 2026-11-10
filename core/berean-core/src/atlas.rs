//! The map and timeline dataset: where and when an account happened, how
//! sure the publications are, and which publication says so.
//!
//! Four JSON files under `data/atlas/` (places, people, periods, events),
//! committed as the source of truth and compiled in; see
//! `docs/design/map-timeline-data.md`. They are parsed and checked once, on
//! first use, through `OnceLock`, as `languages.rs` does with its table. The
//! files are part of the build, so a malformed or inconsistent dataset is a
//! bug and panics; the unit tests load it.
//!
//! The pilot covers Paul's missionary journeys (Acts 13–28). Coordinates come
//! from Pleiades, cross-checked with OpenBible.info, and only where they agree
//! with the publications: a place without coordinates is listed but never
//! drawn, and a gazetteer point that failed the check is not exposed at all.
//! Wherever coordinates are shown, [`attribution`] must be shown too.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use serde::Deserialize;

const PLACES: &str = include_str!("../data/atlas/places.json");
const PEOPLE: &str = include_str!("../data/atlas/people.json");
const PERIODS: &str = include_str!("../data/atlas/periods.json");
const EVENTS: &str = include_str!("../data/atlas/events.json");

/// How sure the publications are of an identification or a date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    /// The publication names the site, or the date, without hedging.
    Established,
    /// The publication hedges ("usually identified", "about"), or locates
    /// the place only by distance.
    Likely,
    /// The publication names competing sites, or gives no location.
    Uncertain,
}

/// What kind of place it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaceKind {
    City,
    Port,
    Harbor,
    Island,
    Region,
    Cape,
    Bay,
    /// A stopping place on a road, such as the Three Taverns.
    Station,
}

/// How exactly the gazetteer point marks the place (Pleiades'
/// `locationPrecision`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Precision {
    /// The site itself.
    Precise,
    /// Approximately.
    Rough,
    /// A representative point for something larger, such as an island.
    Related,
}

/// A point on the map, in degrees (WGS 84).
#[derive(Debug, Clone, PartialEq)]
pub struct Coordinates {
    pub lat: f64,
    pub lon: f64,
    /// `None` only for an alternate site, whose source gives none.
    pub precision: Option<Precision>,
    /// The gazetteer, e.g. `Pleiades`.
    pub source: String,
    /// The gazetteer's page for the point, when it has one.
    pub source_url: Option<String>,
}

/// A publication that says so. The app shows `location` (and `quote`, at
/// most 25 words, verbatim) and links out to `url`; it never reproduces
/// whole articles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Citation {
    /// The publication symbol, e.g. `it-2`, `nwtsty`, `gl`.
    pub publication: String,
    /// The printed page or appendix, e.g. `it-2 p. 205, “LASEA” (WOL ¶3)`.
    pub location: String,
    /// The wol.jw.org page.
    pub url: String,
    pub quote: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    /// Two sources disagree; both sides are recorded.
    Conflict,
    /// Something the sources don't settle.
    Gap,
    Note,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtlasNote {
    pub kind: NoteKind,
    pub text: String,
}

/// Another site proposed for a place.
#[derive(Debug, Clone, PartialEq)]
pub struct AlternateSite {
    pub name: String,
    pub coordinates: Option<Coordinates>,
    /// The publication rejects this site.
    pub rejected: bool,
    pub note: Option<String>,
    pub citations: Vec<Citation>,
}

/// A city, port, island, region and so on.
#[derive(Debug, Clone, PartialEq)]
pub struct Place {
    /// `place:<slug>`, e.g. `place:antioch-pisidia`.
    pub id: String,
    pub kind: PlaceKind,
    /// The NWT rendering, e.g. `Antioch`.
    pub name: String,
    /// Other spellings and modern names the publications use.
    pub alternate_names: Vec<String>,
    pub confidence: Confidence,
    /// `None` when no gazetteer point agrees with the publications, and for
    /// regions, which have no geometry yet.
    pub coordinates: Option<Coordinates>,
    /// The place it lies in, e.g. Malta for St. Paul's Bay.
    pub parent_id: Option<String>,
    pub alternate_sites: Vec<AlternateSite>,
    pub citations: Vec<Citation>,
    pub notes: Vec<AtlasNote>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person {
    /// `person:<slug>`, e.g. `person:john-mark`.
    pub id: String,
    pub name: String,
    pub alternate_names: Vec<String>,
    pub citations: Vec<Citation>,
}

/// A span of years. Years are signed: C.E. positive, B.C.E. negative, and
/// there is no year 0. Both ends are inclusive; a single year has
/// `start == end`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateSpan {
    pub start: i32,
    pub end: i32,
    /// "c." or "about". True on every pilot date.
    pub approx: bool,
    pub confidence: Confidence,
    /// The event has no date of its own and takes its period's.
    pub inherited: bool,
}

/// One end of a passage. `part` is `a` or `b` for half a verse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersePoint {
    pub chapter: u32,
    pub verse: u32,
    pub part: Option<String>,
}

/// A passage within one Bible book, both ends inclusive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Passage {
    /// The NWT book number (Acts is 44).
    pub book: u32,
    /// The book's English name, e.g. `Acts`.
    pub book_name: String,
    pub start: VersePoint,
    pub end: VersePoint,
    /// As the publications write it, e.g. `Ac 17:22b-31` or `Ac 13:1–14:28`.
    pub citation: String,
    /// With the book's full name, e.g. `Acts 17:22b-31`.
    pub reference: String,
}

impl Passage {
    /// Whether the passage holds any of chapter `chapter` of `book` (or, with
    /// `verse`, that verse; a half verse counts).
    pub fn covers(&self, book: u32, chapter: u32, verse: Option<u32>) -> bool {
        if book != self.book {
            return false;
        }
        match verse {
            None => self.start.chapter <= chapter && chapter <= self.end.chapter,
            Some(v) => {
                (self.start.chapter, self.start.verse) <= (chapter, v)
                    && (chapter, v) <= (self.end.chapter, self.end.verse)
            }
        }
    }

    /// Whether `other` lies wholly inside this passage (half verses count
    /// as the whole verse).
    pub fn contains(&self, other: &Passage) -> bool {
        self.book == other.book
            && (self.start.chapter, self.start.verse) <= (other.start.chapter, other.start.verse)
            && (other.end.chapter, other.end.verse) <= (self.end.chapter, self.end.verse)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PeriodKind {
    Journey,
    Custody,
}

/// One stop on a period's route, in order, as the map in *See the Good
/// Land* labels it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteStop {
    /// The map's label, e.g. `Antioch (of Syria)`.
    pub label: String,
    pub place_id: String,
}

/// A named span of time, such as Paul's second missionary tour.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Period {
    /// `period:<slug>`.
    pub id: String,
    pub kind: PeriodKind,
    pub name: String,
    pub alternate_names: Vec<String>,
    pub date: DateSpan,
    pub passage: Passage,
    /// Empty for a period spent in one place, such as the custody in
    /// Caesarea. A stop may be a region with no coordinates: skip it when
    /// drawing.
    pub route: Vec<RouteStop>,
    pub citations: Vec<Citation>,
    pub notes: Vec<AtlasNote>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    /// A journey from place to place.
    Leg,
    /// Something that happened in one place.
    Stop,
}

/// A leg or stop, at the level of the NWT Study Edition's Acts outline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    /// `event:<slug>`, e.g. `event:acts-16-11-15`.
    pub id: String,
    pub kind: EventKind,
    /// The outline heading.
    pub title: String,
    pub passage: Passage,
    /// Its order in the account, from 1.
    pub sequence: u32,
    /// Usually one; two when the event both ends one period and opens the
    /// next.
    pub period_ids: Vec<String>,
    /// In the order the account visits them.
    pub place_ids: Vec<String>,
    pub person_ids: Vec<String>,
    pub date: DateSpan,
    pub citations: Vec<Citation>,
}

/// A line of credit the app must show wherever it shows coordinates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attribution {
    /// e.g. `Pleiades`.
    pub name: String,
    pub url: String,
    /// e.g. `CC BY 3.0`.
    pub license: String,
    pub license_url: String,
}

/// The whole dataset.
#[derive(Debug)]
pub struct Atlas {
    version: String,
    places: Vec<Place>,
    people: Vec<Person>,
    periods: Vec<Period>,
    events: Vec<Event>,
    place_index: HashMap<String, usize>,
    person_index: HashMap<String, usize>,
    period_index: HashMap<String, usize>,
    event_index: HashMap<String, usize>,
}

/// The compiled-in dataset. Panics if it doesn't load: the unit tests load it.
pub fn atlas() -> &'static Atlas {
    static ATLAS: OnceLock<Atlas> = OnceLock::new();
    ATLAS.get_or_init(|| {
        Atlas::parse(PLACES, PEOPLE, PERIODS, EVENTS).unwrap_or_else(|e| panic!("data/atlas: {e}"))
    })
}

/// The credits for the coordinates: Pleiades (the points) and OpenBible.info
/// (the cross-check).
pub fn attribution() -> Vec<Attribution> {
    vec![
        Attribution {
            name: "Pleiades".into(),
            url: "https://pleiades.stoa.org".into(),
            license: "CC BY 3.0".into(),
            license_url: "https://creativecommons.org/licenses/by/3.0/".into(),
        },
        Attribution {
            name: "OpenBible.info Bible Geocoding".into(),
            url: "https://www.openbible.info/geo/".into(),
            license: "CC BY 4.0".into(),
            license_url: "https://creativecommons.org/licenses/by/4.0/".into(),
        },
    ]
}

impl Atlas {
    /// The dataset's version, e.g. `pilot-2026-10-28.2`.
    pub fn version(&self) -> &str {
        &self.version
    }

    /// Every place, in the file's order.
    pub fn places(&self) -> &[Place] {
        &self.places
    }

    pub fn place(&self, id: &str) -> Option<&Place> {
        self.place_index.get(id).map(|&i| &self.places[i])
    }

    /// Every person, in the file's order.
    pub fn people(&self) -> &[Person] {
        &self.people
    }

    pub fn person(&self, id: &str) -> Option<&Person> {
        self.person_index.get(id).map(|&i| &self.people[i])
    }

    /// Every period, earliest first (by start year, then by where its
    /// passage starts).
    pub fn periods(&self) -> &[Period] {
        &self.periods
    }

    pub fn period(&self, id: &str) -> Option<&Period> {
        self.period_index.get(id).map(|&i| &self.periods[i])
    }

    /// Every event, in the order of the account.
    pub fn events(&self) -> &[Event] {
        &self.events
    }

    pub fn event(&self, id: &str) -> Option<&Event> {
        self.event_index.get(id).map(|&i| &self.events[i])
    }

    /// The events of period `period_id`, in the order of the account. Empty
    /// for an unknown id.
    pub fn events_in_period(&self, period_id: &str) -> Vec<&Event> {
        self.events
            .iter()
            .filter(|e| e.period_ids.iter().any(|p| p == period_id))
            .collect()
    }

    /// The events at place `place_id` (or at a place inside it, such as St.
    /// Paul's Bay for Malta), in the order of the account.
    pub fn events_at_place(&self, place_id: &str) -> Vec<&Event> {
        self.events
            .iter()
            .filter(|e| {
                e.place_ids.iter().any(|p| {
                    p == place_id
                        || self.place(p).and_then(|p| p.parent_id.as_deref()) == Some(place_id)
                })
            })
            .collect()
    }

    /// The events whose passage holds any of chapter `chapter` of `book`
    /// (or, with `verse`, that verse), in the order of the account.
    pub fn events_in_passage(&self, book: u32, chapter: u32, verse: Option<u32>) -> Vec<&Event> {
        self.events
            .iter()
            .filter(|e| e.passage.covers(book, chapter, verse))
            .collect()
    }

    /// Parses and checks the four files. Every check in
    /// `docs/design/map-timeline-data.md` § Tests runs here, so a dataset
    /// that loads is consistent.
    fn parse(places: &str, people: &str, periods: &str, events: &str) -> Result<Atlas, String> {
        let places: raw::PlacesFile =
            serde_json::from_str(places).map_err(|e| format!("places.json: {e}"))?;
        let people: raw::PeopleFile =
            serde_json::from_str(people).map_err(|e| format!("people.json: {e}"))?;
        let periods: raw::PeriodsFile =
            serde_json::from_str(periods).map_err(|e| format!("periods.json: {e}"))?;
        let events: raw::EventsFile =
            serde_json::from_str(events).map_err(|e| format!("events.json: {e}"))?;

        let version = places.version.clone();
        for (file, v) in [
            ("people.json", &people.version),
            ("periods.json", &periods.version),
            ("events.json", &events.version),
        ] {
            if *v != version {
                return Err(format!(
                    "{file}: version {v:?}, places.json has {version:?}"
                ));
            }
        }

        let places = places
            .places
            .into_iter()
            .map(raw::Place::convert)
            .collect::<Result<Vec<_>, _>>()?;
        let people: Vec<Person> = people
            .people
            .into_iter()
            .map(raw::Person::convert)
            .collect();
        let mut periods = periods
            .periods
            .into_iter()
            .map(raw::Period::convert)
            .collect::<Result<Vec<_>, _>>()?;
        let mut events = events
            .events
            .into_iter()
            .map(raw::Event::convert)
            .collect::<Result<Vec<_>, _>>()?;

        periods.sort_by_key(|p| {
            (
                p.date.start,
                p.passage.book,
                p.passage.start.chapter,
                p.passage.start.verse,
            )
        });
        events.sort_by_key(|e| e.sequence);

        let place_index = index("place", places.iter().map(|p| &p.id))?;
        let person_index = index("person", people.iter().map(|p| &p.id))?;
        let period_index = index("period", periods.iter().map(|p| &p.id))?;
        let event_index = index("event", events.iter().map(|e| &e.id))?;

        let atlas = Atlas {
            version,
            places,
            people,
            periods,
            events,
            place_index,
            person_index,
            period_index,
            event_index,
        };
        atlas.check()?;
        Ok(atlas)
    }

    /// The cross-file checks: references resolve, sequences are unique, and
    /// events agree with their periods.
    fn check(&self) -> Result<(), String> {
        for place in &self.places {
            if let Some(parent) = &place.parent_id {
                if self.place(parent).is_none() {
                    return Err(format!("{}: unknown parent {parent}", place.id));
                }
            }
            if place.kind == PlaceKind::Region && place.coordinates.is_some() {
                return Err(format!("{}: a region has no point", place.id));
            }
        }
        for period in &self.periods {
            for stop in &period.route {
                if self.place(&stop.place_id).is_none() {
                    return Err(format!(
                        "{}: unknown route place {}",
                        period.id, stop.place_id
                    ));
                }
            }
        }
        let mut sequences = HashSet::new();
        for event in &self.events {
            if event.sequence == 0 || !sequences.insert(event.sequence) {
                return Err(format!(
                    "{}: sequence {} is 0 or repeated",
                    event.id, event.sequence
                ));
            }
            for id in &event.place_ids {
                if self.place(id).is_none() {
                    return Err(format!("{}: unknown place {id}", event.id));
                }
            }
            for id in &event.person_ids {
                if self.person(id).is_none() {
                    return Err(format!("{}: unknown person {id}", event.id));
                }
            }
            for id in &event.period_ids {
                let Some(period) = self.period(id) else {
                    return Err(format!("{}: unknown period {id}", event.id));
                };
                if !period.passage.contains(&event.passage) {
                    return Err(format!(
                        "{}: {} is outside {} ({})",
                        event.id, event.passage.citation, period.id, period.passage.citation
                    ));
                }
                if event.date.inherited
                    && (event.date.start, event.date.end, event.date.confidence)
                        != (period.date.start, period.date.end, period.date.confidence)
                {
                    return Err(format!(
                        "{}: inherits a date that differs from {}",
                        event.id, period.id
                    ));
                }
            }
            if event.date.inherited && event.period_ids.is_empty() {
                return Err(format!("{}: inherits a date but has no period", event.id));
            }
        }
        Ok(())
    }
}

/// Maps each id to its position, checking that ids are unique and look like
/// `<kind>:<slug>` (lowercase ASCII letters, digits and hyphens).
fn index<'a>(
    kind: &str,
    ids: impl Iterator<Item = &'a String>,
) -> Result<HashMap<String, usize>, String> {
    let mut map = HashMap::new();
    for (i, id) in ids.enumerate() {
        let slug = id
            .strip_prefix(kind)
            .and_then(|s| s.strip_prefix(':'))
            .ok_or_else(|| format!("{id}: should start with {kind}:"))?;
        let well_formed = !slug.is_empty()
            && !slug.starts_with('-')
            && !slug.ends_with('-')
            && slug
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !well_formed {
            return Err(format!("{id}: malformed slug"));
        }
        if map.insert(id.clone(), i).is_some() {
            return Err(format!("{id}: repeated"));
        }
    }
    Ok(map)
}

/// Formats a passage as the publications do: "-" within a chapter, "–"
/// across chapters, ", " for two consecutive verses, and the half-verse
/// letter after its verse.
fn format_passage(book: &str, start: &VersePoint, end: &VersePoint) -> String {
    let verse = |p: &VersePoint| format!("{}{}", p.verse, p.part.as_deref().unwrap_or(""));
    let from = format!("{book} {}:{}", start.chapter, verse(start));
    if start == end {
        from
    } else if start.chapter != end.chapter {
        format!("{from}–{}:{}", end.chapter, verse(end))
    } else if end.verse == start.verse + 1 && start.part.is_none() && end.part.is_none() {
        format!("{from}, {}", verse(end))
    } else {
        format!("{from}-{}", verse(end))
    }
}

/// The serde shapes of the files, converted and checked into the public
/// types.
mod raw {
    use super::*;

    #[derive(Deserialize)]
    pub struct PlacesFile {
        pub version: String,
        pub places: Vec<Place>,
    }

    #[derive(Deserialize)]
    pub struct PeopleFile {
        pub version: String,
        pub people: Vec<Person>,
    }

    #[derive(Deserialize)]
    pub struct PeriodsFile {
        pub version: String,
        pub periods: Vec<Period>,
    }

    #[derive(Deserialize)]
    pub struct EventsFile {
        pub version: String,
        pub events: Vec<Event>,
    }

    #[derive(Deserialize)]
    pub struct Names {
        pub nwt: String,
        #[serde(default)]
        pub alternate: Vec<String>,
    }

    #[derive(Deserialize)]
    pub struct Identification {
        pub confidence: Confidence,
    }

    #[derive(Deserialize)]
    pub struct Coordinates {
        pub lat: f64,
        pub lon: f64,
        pub precision: Option<Precision>,
        pub source: String,
        pub source_url: Option<String>,
    }

    impl Coordinates {
        fn convert(self, owner: &str) -> Result<super::Coordinates, String> {
            if !(-90.0..=90.0).contains(&self.lat) || !(-180.0..=180.0).contains(&self.lon) {
                return Err(format!("{owner}: coordinates out of range"));
            }
            Ok(super::Coordinates {
                lat: self.lat,
                lon: self.lon,
                precision: self.precision,
                source: self.source,
                source_url: self.source_url,
            })
        }
    }

    #[derive(Deserialize)]
    pub struct Citation {
        pub publication: String,
        pub location: String,
        pub url: String,
        pub quote: Option<String>,
    }

    impl Citation {
        fn convert(self) -> super::Citation {
            super::Citation {
                publication: self.publication,
                location: self.location,
                url: self.url,
                quote: self.quote,
            }
        }
    }

    fn citations(owner: &str, c: Vec<Citation>) -> Result<Vec<super::Citation>, String> {
        c.into_iter()
            .map(|c| {
                if !c.url.starts_with("https://wol.jw.org/") {
                    return Err(format!("{owner}: citation {:?} is not a WOL page", c.url));
                }
                if let Some(q) = &c.quote {
                    let words = q.split_whitespace().count();
                    if words == 0 || words > 25 {
                        return Err(format!("{owner}: quote of {words} words"));
                    }
                }
                Ok(c.convert())
            })
            .collect()
    }

    #[derive(Deserialize)]
    pub struct Note {
        pub kind: NoteKind,
        pub text: String,
    }

    fn notes(n: Vec<Note>) -> Vec<AtlasNote> {
        n.into_iter()
            .map(|n| AtlasNote {
                kind: n.kind,
                text: n.text,
            })
            .collect()
    }

    #[derive(Deserialize)]
    pub struct AlternateSite {
        pub name: String,
        pub coordinates: Option<Coordinates>,
        pub status: Option<String>,
        pub note: Option<String>,
        #[serde(default)]
        pub citations: Vec<Citation>,
    }

    #[derive(Deserialize)]
    pub struct Place {
        pub id: String,
        #[serde(rename = "type")]
        pub kind: PlaceKind,
        pub names: Names,
        pub identification: Identification,
        pub coordinates: Option<Coordinates>,
        pub parent: Option<String>,
        #[serde(default)]
        pub alternate_sites: Vec<AlternateSite>,
        #[serde(default)]
        pub citations: Vec<Citation>,
        #[serde(default)]
        pub notes: Vec<Note>,
        // `rejected_coordinates` is review metadata: the app never draws it,
        // so it is not read.
    }

    impl Place {
        pub fn convert(self) -> Result<super::Place, String> {
            let id = self.id;
            let alternate_sites = self
                .alternate_sites
                .into_iter()
                .map(|s| {
                    let rejected = match s.status.as_deref() {
                        None => false,
                        Some("rejected") => true,
                        Some(other) => {
                            return Err(format!("{id}: alternate site status {other:?}"))
                        }
                    };
                    Ok(super::AlternateSite {
                        name: s.name,
                        coordinates: s.coordinates.map(|c| c.convert(&id)).transpose()?,
                        rejected,
                        note: s.note,
                        citations: citations(&id, s.citations)?,
                    })
                })
                .collect::<Result<_, String>>()?;
            Ok(super::Place {
                kind: self.kind,
                name: self.names.nwt,
                alternate_names: self.names.alternate,
                confidence: self.identification.confidence,
                coordinates: self.coordinates.map(|c| c.convert(&id)).transpose()?,
                parent_id: self.parent,
                alternate_sites,
                citations: citations(&id, self.citations)?,
                notes: notes(self.notes),
                id,
            })
        }
    }

    #[derive(Deserialize)]
    pub struct Person {
        pub id: String,
        pub names: Names,
        #[serde(default)]
        pub citations: Vec<Citation>,
    }

    impl Person {
        pub fn convert(self) -> super::Person {
            super::Person {
                id: self.id,
                name: self.names.nwt,
                alternate_names: self.names.alternate,
                citations: self.citations.into_iter().map(Citation::convert).collect(),
            }
        }
    }

    #[derive(Deserialize)]
    pub struct Year {
        pub year: i32,
        #[serde(default)]
        pub approx: bool,
    }

    #[derive(Deserialize)]
    pub struct Date {
        pub start: Year,
        pub end: Year,
        pub confidence: Confidence,
        pub basis: Option<String>,
    }

    impl Date {
        fn convert(self, owner: &str) -> Result<DateSpan, String> {
            if self.start.year == 0 || self.end.year == 0 {
                return Err(format!("{owner}: year 0 (there is none)"));
            }
            if self.start.year > self.end.year {
                return Err(format!("{owner}: date starts after it ends"));
            }
            let inherited = match self.basis.as_deref() {
                None | Some("cited") => false,
                Some("inherited from period") => true,
                Some(other) => return Err(format!("{owner}: date basis {other:?}")),
            };
            Ok(DateSpan {
                start: self.start.year,
                end: self.end.year,
                approx: self.start.approx || self.end.approx,
                confidence: self.confidence,
                inherited,
            })
        }
    }

    #[derive(Deserialize)]
    pub struct Point {
        pub chapter: u32,
        pub verse: u32,
        pub part: Option<String>,
    }

    #[derive(Deserialize)]
    pub struct ScriptureRef {
        pub book: u32,
        pub book_name: String,
        pub start: Point,
        pub end: Point,
    }

    /// The structured reference, checked against its free-text twin: it
    /// must format back to exactly the same string.
    fn passage(owner: &str, scripture: String, r: ScriptureRef) -> Result<Passage, String> {
        if !(1..=66).contains(&r.book) {
            return Err(format!("{owner}: book {}", r.book));
        }
        let point = |p: Point| -> Result<VersePoint, String> {
            if p.chapter == 0 {
                return Err(format!("{owner}: chapter 0"));
            }
            match p.part.as_deref() {
                None | Some("a") | Some("b") => {}
                Some(other) => return Err(format!("{owner}: verse part {other:?}")),
            }
            Ok(VersePoint {
                chapter: p.chapter,
                verse: p.verse,
                part: p.part,
            })
        };
        let start = point(r.start)?;
        let end = point(r.end)?;
        let order = |p: &VersePoint| (p.chapter, p.verse, p.part.clone().unwrap_or_default());
        if order(&start) > order(&end) {
            return Err(format!("{owner}: {scripture} starts after it ends"));
        }
        let (abbreviation, _) = scripture
            .split_once(' ')
            .ok_or_else(|| format!("{owner}: scripture {scripture:?}"))?;
        if format_passage(abbreviation, &start, &end) != scripture {
            return Err(format!(
                "{owner}: scripture {scripture:?} doesn't match its scripture_ref"
            ));
        }
        Ok(Passage {
            book: r.book,
            reference: format_passage(&r.book_name, &start, &end),
            book_name: r.book_name,
            start,
            end,
            citation: scripture,
        })
    }

    #[derive(Deserialize)]
    pub struct RouteStop {
        pub label: String,
        pub place: String,
    }

    #[derive(Deserialize)]
    pub struct Period {
        pub id: String,
        #[serde(rename = "type")]
        pub kind: PeriodKind,
        pub names: Names,
        pub date: Date,
        pub scripture: String,
        pub scripture_ref: ScriptureRef,
        #[serde(default)]
        pub route_gl: Vec<RouteStop>,
        #[serde(default)]
        pub citations: Vec<Citation>,
        #[serde(default)]
        pub notes: Vec<Note>,
    }

    impl Period {
        pub fn convert(self) -> Result<super::Period, String> {
            let id = self.id;
            if self.date.basis.as_deref() == Some("inherited from period") {
                return Err(format!("{id}: a period can't inherit a date"));
            }
            Ok(super::Period {
                kind: self.kind,
                name: self.names.nwt,
                alternate_names: self.names.alternate,
                date: self.date.convert(&id)?,
                passage: passage(&id, self.scripture, self.scripture_ref)?,
                route: self
                    .route_gl
                    .into_iter()
                    .map(|s| super::RouteStop {
                        label: s.label,
                        place_id: s.place,
                    })
                    .collect(),
                citations: citations(&id, self.citations)?,
                notes: notes(self.notes),
                id,
            })
        }
    }

    #[derive(Deserialize)]
    pub struct Event {
        pub id: String,
        #[serde(rename = "type")]
        pub kind: EventKind,
        pub names: Names,
        pub scripture: String,
        pub scripture_ref: ScriptureRef,
        pub sequence: u32,
        #[serde(default)]
        pub periods: Vec<String>,
        #[serde(default)]
        pub places: Vec<String>,
        #[serde(default)]
        pub people: Vec<String>,
        pub date: Date,
        #[serde(default)]
        pub citations: Vec<Citation>,
    }

    impl Event {
        pub fn convert(self) -> Result<super::Event, String> {
            let id = self.id;
            Ok(super::Event {
                kind: self.kind,
                title: self.names.nwt,
                passage: passage(&id, self.scripture, self.scripture_ref)?,
                sequence: self.sequence,
                period_ids: self.periods,
                place_ids: self.places,
                person_ids: self.people,
                date: self.date.convert(&id)?,
                citations: citations(&id, self.citations)?,
                id,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pilot_loads() {
        let a = atlas();
        assert_eq!(a.version(), "pilot-2026-10-28.2");
        assert_eq!(a.places().len(), 68);
        assert_eq!(a.people().len(), 18);
        assert_eq!(a.periods().len(), 5);
        assert_eq!(a.events().len(), 47);
        // Lasea's gazetteer point failed the check against Insight, so it is
        // not drawn; regions have no point.
        assert!(a.place("place:lasea").unwrap().coordinates.is_none());
        assert!(a
            .places()
            .iter()
            .filter(|p| p.kind == PlaceKind::Region)
            .all(|p| p.coordinates.is_none()));
        assert_eq!(
            a.places()
                .iter()
                .filter(|p| p.coordinates.is_some())
                .count(),
            50
        );
    }

    #[test]
    fn periods_are_in_order_and_events_follow_the_account() {
        let a = atlas();
        let starts: Vec<i32> = a.periods().iter().map(|p| p.date.start).collect();
        assert_eq!(starts, [47, 49, 52, 56, 58]);
        assert_eq!(a.periods()[0].id, "period:paul-first-missionary-journey");
        assert!(a.events().windows(2).all(|w| w[0].sequence < w[1].sequence));
        let first = &a.events()[0];
        assert_eq!(first.id, "event:acts-13-1-3");
        assert_eq!(first.passage.reference, "Acts 13:1-3");
        assert_eq!(first.passage.citation, "Ac 13:1-3");
        assert!(first.date.inherited);
        assert_eq!((first.date.start, first.date.end), (47, 48));
    }

    #[test]
    fn lookups() {
        let a = atlas();
        let derbe = a.place("place:derbe").unwrap();
        assert_eq!(derbe.name, "Derbe");
        assert_eq!(derbe.confidence, Confidence::Established);
        let c = derbe.coordinates.as_ref().unwrap();
        assert!((c.lat - 37.349).abs() < 0.01 && (c.lon - 33.362).abs() < 0.01);
        assert_eq!(c.precision, Some(Precision::Precise));
        assert_eq!(c.source, "Pleiades");
        assert!(a.place("place:nowhere").is_none());
        assert_eq!(a.person("person:paul").unwrap().alternate_names, ["Saul"]);

        let trip1 = a.events_in_period("period:paul-first-missionary-journey");
        assert!(!trip1.is_empty());
        assert!(trip1.windows(2).all(|w| w[0].sequence < w[1].sequence));
        assert!(a.events_in_period("period:none").is_empty());

        // Malta holds St. Paul's Bay, so its events count for Malta too.
        let bay = a.events_at_place("place:st-pauls-bay");
        assert_eq!(bay.len(), 1);
        let malta = a.events_at_place("place:malta");
        assert!(malta.iter().any(|e| e.id == bay[0].id));
        assert!(malta.windows(2).all(|w| w[0].sequence < w[1].sequence));
    }

    #[test]
    fn events_in_a_passage() {
        let a = atlas();
        // Paul on the Areopagus, Ac 17:22b-31.
        let at = a.events_in_passage(44, 17, Some(25));
        assert_eq!(at.len(), 1, "{at:?}");
        assert_eq!(at[0].passage.citation, "Ac 17:22b-31");
        // Verse 22 is split between two events.
        assert_eq!(a.events_in_passage(44, 17, Some(22)).len(), 2);
        assert!(a.events_in_passage(44, 17, None).len() >= 3);
        assert!(a.events_in_passage(44, 1, None).is_empty());
        assert!(a.events_in_passage(43, 17, None).is_empty());
    }

    #[test]
    fn passages_format_as_the_publications_do() {
        let p = |c, v, part: Option<&str>| VersePoint {
            chapter: c,
            verse: v,
            part: part.map(String::from),
        };
        assert_eq!(
            format_passage("Ac", &p(16, 6, None), &p(16, 6, None)),
            "Ac 16:6"
        );
        assert_eq!(
            format_passage("Ac", &p(16, 6, None), &p(16, 7, None)),
            "Ac 16:6, 7"
        );
        assert_eq!(
            format_passage("Ac", &p(16, 6, None), &p(16, 10, None)),
            "Ac 16:6-10"
        );
        assert_eq!(
            format_passage("Ac", &p(17, 22, Some("b")), &p(17, 31, None)),
            "Ac 17:22b-31"
        );
        assert_eq!(
            format_passage("Acts", &p(13, 1, None), &p(14, 28, None)),
            "Acts 13:1–14:28"
        );
        // Every pilot string round-trips (the loader checks it).
        let a = atlas();
        let refs = a
            .events()
            .iter()
            .map(|e| &e.passage)
            .chain(a.periods().iter().map(|p| &p.passage));
        for passage in refs {
            assert!(
                passage.reference.starts_with("Acts "),
                "{}",
                passage.reference
            );
        }
    }

    #[test]
    fn attribution_names_both_gazetteers() {
        let names: Vec<String> = attribution().into_iter().map(|a| a.license).collect();
        assert_eq!(names, ["CC BY 3.0", "CC BY 4.0"]);
    }

    fn parse_with(edit: impl Fn(&mut serde_json::Value)) -> Result<Atlas, String> {
        let mut events: serde_json::Value = serde_json::from_str(EVENTS).unwrap();
        edit(&mut events);
        Atlas::parse(PLACES, PEOPLE, PERIODS, &events.to_string())
    }

    #[test]
    fn bad_data_is_rejected() {
        let first = |v: &mut serde_json::Value| -> serde_json::Value { v["events"][0].clone() };
        // No year 0.
        let e = parse_with(|v| v["events"][0]["date"]["start"]["year"] = 0.into()).unwrap_err();
        assert!(e.contains("year 0"), "{e}");
        // Dates and passages run forwards.
        let e = parse_with(|v| v["events"][0]["date"]["end"]["year"] = 46.into()).unwrap_err();
        assert!(e.contains("starts after"), "{e}");
        let e =
            parse_with(|v| v["events"][0]["scripture_ref"]["end"]["verse"] = 0.into()).unwrap_err();
        assert!(
            e.contains("starts after") || e.contains("doesn't match"),
            "{e}"
        );
        // The free text and the structured reference agree.
        let e = parse_with(|v| v["events"][0]["scripture"] = "Ac 13:1-4".into()).unwrap_err();
        assert!(e.contains("doesn't match"), "{e}");
        // References resolve.
        let e = parse_with(|v| v["events"][0]["places"][0] = "place:atlantis".into()).unwrap_err();
        assert!(e.contains("unknown place"), "{e}");
        let e =
            parse_with(|v| v["events"][0]["people"] = vec!["person:nobody"].into()).unwrap_err();
        assert!(e.contains("unknown person"), "{e}");
        // Ids are unique and well formed.
        let e = parse_with(|v| {
            let copy = first(v);
            v["events"].as_array_mut().unwrap().push(copy);
        })
        .unwrap_err();
        assert!(e.contains("repeated"), "{e}");
        let e = parse_with(|v| v["events"][0]["id"] = "event:Acts 13".into()).unwrap_err();
        assert!(e.contains("malformed"), "{e}");
        let e = parse_with(|v| v["events"][0]["id"] = "place:acts-13".into()).unwrap_err();
        assert!(e.contains("should start with event:"), "{e}");
        // An inherited date matches its period's, and the passage lies
        // inside the period's.
        let e = parse_with(|v| v["events"][0]["date"]["end"]["year"] = 50.into()).unwrap_err();
        assert!(e.contains("inherits a date that differs"), "{e}");
        let e = parse_with(|v| {
            v["events"][0]["scripture"] = "Ac 12:1-3".into();
            v["events"][0]["scripture_ref"]["start"]["chapter"] = 12.into();
            v["events"][0]["scripture_ref"]["end"]["chapter"] = 12.into();
        })
        .unwrap_err();
        assert!(e.contains("outside"), "{e}");
        // Quotes stay short.
        let e = parse_with(|v| {
            v["events"][0]["citations"][0]["quote"] = "word ".repeat(26).trim().into();
        })
        .unwrap_err();
        assert!(e.contains("quote of 26 words"), "{e}");
    }
}
