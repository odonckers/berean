//! TEMPORARY probe (reverted in the next commit): prints how the catalog maps
//! MEPS document ids to publications across languages.
mod common;
#[path = "common/trimmed_catalog.rs"]
mod trimmed_catalog;

use rusqlite::Connection;

#[test]
fn probe() {
    let conn = Connection::open(trimmed_catalog::trimmed()).unwrap();
    let mut out = String::new();
    for t in ["PublicationDocument", "Publication", "PublicationRootKey"] {
        let sql: String = conn
            .query_row("SELECT sql FROM sqlite_master WHERE name = ?1", [t], |r| {
                r.get(0)
            })
            .unwrap();
        out += &format!("{sql}\n");
    }
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM PublicationDocument", [], |r| r.get(0))
        .unwrap();
    let pubs: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT PublicationId) FROM PublicationDocument",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let all: i64 = conn
        .query_row("SELECT COUNT(*) FROM Publication", [], |r| r.get(0))
        .unwrap();
    out += &format!("PublicationDocument rows {n}, pubs with docs {pubs} of {all}\n");
    let mut stmt = conn
        .prepare("SELECT * FROM PublicationDocument LIMIT 3")
        .unwrap();
    let cols = stmt.column_count();
    let mut rows = stmt.query([]).unwrap();
    while let Some(r) = rows.next().unwrap() {
        let v: Vec<String> = (0..cols)
            .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
            .collect();
        out += &format!("row {}\n", v.join(" | "));
    }
    for doc in [2026521i64, 2026520, 1001061147, 1102011094, 202026252] {
        let mut stmt = conn
            .prepare(
                "SELECT p.Id, p.Symbol, p.KeySymbol, p.MepsLanguageId, p.IssueTagNumber, p.PublicationTypeId, p.PublicationRootKeyId \
                 FROM PublicationDocument d JOIN Publication p ON p.Id = d.PublicationId WHERE d.DocumentId = ?1",
            )
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([doc], |r| {
                Ok(format!(
                    "{}:{}:{}:{}:{}:t{}:root{}",
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        out += &format!("doc {doc}: {rows:?}\n");
    }
    // Per type: how many publications have document rows.
    let mut stmt = conn
        .prepare(
            "SELECT p.PublicationTypeId, COUNT(*), SUM(EXISTS (SELECT 1 FROM PublicationDocument d WHERE d.PublicationId = p.Id)) \
             FROM Publication p GROUP BY 1 ORDER BY 1",
        )
        .unwrap();
    let rows: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "t{}={}/{}",
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(1)?
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    out += &format!("types with docs/total: {rows:?}\n");
    // Root keys: does one root key span languages?
    let mut stmt = conn
        .prepare("SELECT p.PublicationRootKeyId, p.Symbol, p.MepsLanguageId FROM Publication p WHERE p.Symbol IN ('w26','ll','nwt','nwtsty','lff') ORDER BY 2, 3 LIMIT 40")
        .unwrap();
    let rows: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "{}:{}:{}",
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    out += &format!("root keys: {rows:?}\n");
    // Symbols that differ between en and es for the same root key.
    let diff: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Publication a JOIN Publication b ON a.PublicationRootKeyId = b.PublicationRootKeyId \
             WHERE a.MepsLanguageId = 0 AND b.MepsLanguageId = 1 AND a.Symbol <> b.Symbol",
            [],
            |r| r.get(0),
        )
        .unwrap_or(-1);
    out += &format!("root-key pairs with different symbols: {diff}\n");
    panic!("PROBE\n{out}");
}
