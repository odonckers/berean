//! Strict parsing of the ISO-8601 instants the catalog and `.jwpub`
//! manifests carry, e.g. `2026-04-29T04:32:02Z` (a manifest's `timestamp`)
//! and `2026-04-29T04:32:02+00:00` (a catalog `LastModified`).

/// Seconds since the Unix epoch (UTC) of `s`, which must be exactly
/// `YYYY-MM-DDTHH:MM:SS`, optional fractional seconds `.d+` (dropped), then
/// `Z` or `±HH:MM`. Anything else, or a field out of range (a leap second
/// included), => `None`.
pub(crate) fn parse(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    if b[13] != b':' || b[16] != b':' {
        return None;
    }
    let year = digits(&b[0..4])?;
    let month = digits(&b[5..7])?;
    let day = digits(&b[8..10])?;
    let hour = digits(&b[11..13])?;
    let min = digits(&b[14..16])?;
    let sec = digits(&b[17..19])?;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    if hour > 23 || min > 59 || sec > 59 {
        return None;
    }

    let mut rest = &b[19..];
    if rest[0] == b'.' {
        let n = rest[1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if n == 0 {
            return None;
        }
        rest = &rest[1 + n..];
    }
    let offset = match rest {
        [b'Z'] => 0,
        [sign @ (b'+' | b'-'), h1, h2, b':', m1, m2] => {
            let (oh, om) = (digits(&[*h1, *h2])?, digits(&[*m1, *m2])?);
            if oh > 23 || om > 59 {
                return None;
            }
            let offset = oh * 3600 + om * 60;
            if *sign == b'-' {
                -offset
            } else {
                offset
            }
        }
        _ => return None,
    };

    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3600 + min * 60 + sec - offset)
}

/// The value of `b`, which must be all ASCII digits.
fn digits(b: &[u8]) -> Option<i64> {
    b.iter().try_fold(0i64, |n, c| {
        c.is_ascii_digit().then(|| n * 10 + i64::from(c - b'0'))
    })
}

/// True when `yyyymmdd` is a real proleptic Gregorian civil day,
/// `YYYY * 10000 + MM * 100 + DD` with year 1 to 9999.
pub(crate) fn valid_yyyymmdd(yyyymmdd: i32) -> bool {
    let n = i64::from(yyyymmdd);
    let (year, month, day) = (n / 10_000, n / 100 % 100, n % 100);
    (1..=9999).contains(&year)
        && (1..=12).contains(&month)
        && (1..=days_in_month(year, month)).contains(&day)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// The Monday and Sunday of the week (Monday to Sunday) holding the valid
/// day `yyyymmdd`, both as `YYYYMMDD`.
pub(crate) fn week_of(yyyymmdd: i32) -> (i32, i32) {
    let n = i64::from(yyyymmdd);
    let days = days_from_civil(n / 10_000, n / 100 % 100, n % 100);
    // 1970-01-01 was a Thursday: day 0 is weekday 3 counting Monday as 0.
    let monday = days - (days + 3).rem_euclid(7);
    (yyyymmdd_of(monday), yyyymmdd_of(monday + 6))
}

/// `YYYY-MM-DD` (a catalog `DatedText` date) for the valid day `yyyymmdd`.
pub(crate) fn iso_date(yyyymmdd: i32) -> String {
    let n = yyyymmdd;
    format!("{:04}-{:02}-{:02}", n / 10_000, n / 100 % 100, n % 100)
}

/// The `YYYYMMDD` of the day `days` after 1970-01-01 (Howard Hinnant's
/// `civil_from_days`).
fn yyyymmdd_of(days: i64) -> i32 {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year * 10_000 + month * 100 + day) as i32
}

/// Days from 1970-01-01 to the given proleptic Gregorian date (Howard
/// Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_and_known_values() {
        assert_eq!(parse("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse("2026-04-29T04:32:02Z"), Some(1_777_437_122));
        assert_eq!(parse("2000-03-01T00:00:00Z"), Some(951_868_800));
        assert_eq!(parse("1969-12-31T23:59:59Z"), Some(-1));
    }

    #[test]
    fn manifest_and_catalog_formats_agree() {
        assert_eq!(
            parse("2026-04-29T04:32:02Z"),
            parse("2026-04-29T04:32:02+00:00")
        );
        assert_eq!(
            parse("2026-04-29T04:32:02-00:00"),
            parse("2026-04-29T04:32:02+00:00")
        );
    }

    #[test]
    fn offsets_convert_to_utc() {
        let utc = parse("2026-04-29T04:32:02Z").unwrap();
        // 06:32 at +02:00 is 04:32 UTC.
        assert_eq!(parse("2026-04-29T06:32:02+02:00"), Some(utc));
        assert_eq!(parse("2026-04-29T04:32:02+02:00"), Some(utc - 2 * 3600));
        assert_eq!(parse("2026-04-28T23:02:02-05:30"), Some(utc));
    }

    #[test]
    fn fractional_seconds_are_dropped() {
        let whole = parse("2026-04-29T04:32:02Z");
        assert_eq!(parse("2026-04-29T04:32:02.999Z"), whole);
        assert_eq!(parse("2026-04-29T04:32:02.1+00:00"), whole);
    }

    #[test]
    fn leap_days() {
        assert!(parse("2024-02-29T00:00:00Z").is_some());
        assert!(parse("2000-02-29T00:00:00Z").is_some());
        assert_eq!(parse("2023-02-29T00:00:00Z"), None);
        assert_eq!(parse("1900-02-29T00:00:00Z"), None);
        assert_eq!(
            parse("2024-03-01T00:00:00Z").unwrap() - parse("2024-02-29T00:00:00Z").unwrap(),
            86_400
        );
    }

    #[test]
    fn weeks_run_monday_to_sunday() {
        // Monday, mid-week, Sunday; across a month, a year and a leap day.
        assert_eq!(week_of(20261109), (20261109, 20261115));
        assert_eq!(week_of(20261112), (20261109, 20261115));
        assert_eq!(week_of(20261115), (20261109, 20261115));
        assert_eq!(week_of(20261029), (20261026, 20261101));
        assert_eq!(week_of(20270101), (20261228, 20270103));
        assert_eq!(week_of(20280301), (20280228, 20280305));
        assert_eq!(week_of(19700101), (19691229, 19700104));
        for d in [20261007, 20240229, 10101, 99991231] {
            let days = days_from_civil(
                i64::from(d) / 10_000,
                i64::from(d) / 100 % 100,
                i64::from(d) % 100,
            );
            assert_eq!(yyyymmdd_of(days), d);
        }
        assert_eq!(iso_date(20261109), "2026-11-09");
        assert_eq!(iso_date(10101), "0001-01-01");
    }

    #[test]
    fn civil_days() {
        for d in [20261007, 20240229, 20000229, 10101, 99991231, 20261231] {
            assert!(valid_yyyymmdd(d), "{d}");
        }
        for d in [
            0, -20261007, 20260007, 20261307, 20261000, 20261032, 20260431, 20230229, 19000229,
            1231, 100000101, 2026107,
        ] {
            assert!(!valid_yyyymmdd(d), "{d}");
        }
    }

    #[test]
    fn rejects() {
        for s in [
            "",
            "garbage",
            "2026-04-29",
            "2026-04-29 04:32:02Z",
            "2026-04-29t04:32:02Z",
            "2026-04-29T04:32:02",
            "2026-04-29T04:32Z",
            "2026-04-29T04:32:02z",
            "2026-04-29T04:32:02ZZ",
            "2026-04-29T04:32:02Z ",
            "2026-04-29T04:32:02+00:00x",
            "2026-04-29T04:32:02+0000",
            "2026-04-29T04:32:02+00",
            "2026-04-29T04:32:02.Z",
            "2026-04-29T04:32:02,5Z",
            "2026-13-01T00:00:00Z",
            "2026-00-01T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2026-04-00T00:00:00Z",
            "2026-04-29T24:00:00Z",
            "2026-04-29T04:60:00Z",
            "2026-04-29T04:32:60Z",
            "2026-04-29T04:32:02+24:00",
            "2026-04-29T04:32:02+00:60",
            "+026-04-29T04:32:02Z",
            "2026-4-29T04:32:02Z",
            "２026-04-29T04:32:02Z",
            "2026-04-29T04:32:0٢Z",
        ] {
            assert_eq!(parse(s), None, "{s:?}");
        }
    }
}
