#!/usr/bin/env python3
"""Build berean-core's MEPS language table from JW's public data.

Sources (all public, read-only GETs):
  * Language codes and names: https://b.jw-cdn.org/apis/mediator/v1/languages/E/all
  * MEPS language ids: the publication catalog (catalog.db, as fetched by
    scripts/fetch-fixtures.sh). The catalog has only numeric MepsLanguageId,
    so each JW code is matched to an id by asking pub-media
    (GETPUBMEDIALINKS) for a widely translated publication in that language
    and finding the single catalog row of that publication whose .jwpub size
    equals pub-media's filesize. Only unambiguous, non-conflicting matches
    are kept.

Usage: gen-languages.py <catalog.db> <revision-label> > languages.tsv
Python 3 standard library only.
"""
import concurrent.futures as cf
import json
import sqlite3
import sys
import urllib.request

API = "https://b.jw-cdn.org/apis"


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def main():
    cat = sqlite3.connect(sys.argv[1])
    label = sys.argv[2]
    langs = get(f"{API}/mediator/v1/languages/E/all")["languages"]
    rows = cat.execute(
        "SELECT p.KeySymbol, p.IssueTagNumber, a.Size, p.MepsLanguageId "
        "FROM Publication p JOIN PublicationAsset a ON a.PublicationId = p.Id"
    ).fetchall()
    by_pub = {}
    for sym, issue, size, lang in rows:
        by_pub.setdefault((sym, issue), {}).setdefault(size, set()).add(lang)
    all_ids = {r[3] for r in rows}

    # Greedy cover: publications that together reach every catalog language.
    langs_of = {k: set().union(*m.values()) for k, m in by_pub.items()}
    probes, left = [], set(all_ids)
    while left:
        best = max(langs_of, key=lambda k: (len(langs_of[k] & left), k))
        gain = langs_of[best] & left
        if len(gain) < 3 or len(probes) >= 40:
            break
        probes.append(best)
        left -= gain

    def probe(code):
        votes = {}
        for sym, issue in probes:
            url = (
                f"{API}/pub-media/GETPUBMEDIALINKS?output=json&fileformat=JWPUB"
                f"&pub={sym}&langwritten={code}"
            )
            if issue:
                url += f"&issue={issue // 100}"
            try:
                files = get(url).get("files", {}).get(code, {}).get("JWPUB", [])
            except Exception:
                continue
            for f in files:
                ids = by_pub[(sym, issue)].get(f["filesize"], set())
                if len(ids) == 1:
                    votes.setdefault(next(iter(ids)), 0)
                    votes[next(iter(ids))] += 1
            if sum(votes.values()) >= 2:
                break
        return code, votes

    with cf.ThreadPoolExecutor(16) as ex:
        results = dict(ex.map(probe, [l["code"] for l in langs]))

    mapped = {}
    for code, votes in results.items():
        if len(votes) == 1:
            mapped[code] = next(iter(votes))
    # Drop any id claimed by two codes: ambiguous, so not trusted.
    owners = {}
    for code, mid in mapped.items():
        owners.setdefault(mid, []).append(code)
    names = {l["code"]: l for l in langs}
    print(f"# MEPS language table, built by core/scripts/gen-languages.py")
    print(f"# version\t{label}")
    print("# meps_id\tcode\tname\tvernacular")
    for mid in sorted(owners):
        if len(owners[mid]) != 1:
            continue
        code = owners[mid][0]
        l = names[code]
        print(f"{mid}\t{code}\t{l['name']}\t{l['vernacular']}")
    print(
        f"covered {len([m for m in owners if len(owners[m]) == 1])} of "
        f"{len(all_ids)} catalog language ids",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
