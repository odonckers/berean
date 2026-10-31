"""Check every Berean theme token set against the studio's contrast floors.

Reads tokens.json (the repo schema, next to this script), writes
contrast-table.md and contrast-table.csv next to it, prints a summary, and
exits 1 if any line fails. WCAG 2.x relative luminance; CIEDE2000 for
highlight separation; Machado et al. 2009 (severity 1.0) for CVD.

    python3 docs/design/themes/contrast.py           # re-check and rewrite the tables
    python3 docs/design/themes/contrast.py --check   # re-check only; writes nothing (for CI)

Python 3 standard library only; color maths is in colorlib.py.
Adapted from Kerning & Co.'s contrast.py: only the loader, the paths and
--check changed. The checks and floors are unchanged.
"""
import json, csv, os, sys, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from colorlib import contrast, delta_e, delta_e_cvd, hex_to_oklch

# Pairs that collapse under CVD simulation; must also differ in OKLCH lightness.
CVD_PAIRS = [('yellow', 'orange'), ('blue', 'purple'), ('pink', 'orange'), ('green', 'blue')]
DL_FLOOR, DL_TARGET = 0.05, 0.08

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK_ONLY = '--check' in sys.argv[1:]


def load_tokens(path):
    """Read the repo schema and return the studio layout the checks below index into."""
    R = json.load(open(path, encoding='utf-8'))
    cap = lambda m: m[0].upper() + m[1:]
    T = {'meta': {'modes': R['modes']}, 'themes': {}, 'accents': {}, 'material3': {}}
    for tid, th in R['themes'].items():
        T['themes'][tid] = {'name': th['name'], 'modes': th['modes']}
        slots = {}
        for s in th['accents']['slots']:
            d = {'name': s['name']}
            for m, v in s['modes'].items():
                d[m] = v['hex']
                d['onAccent' + cap(m)] = v['onAccent']
            slots[str(s['slot'])] = d
        T['accents'][tid] = {'slots': slots}
        T['material3'][tid] = th['material3']
    return T


T = load_tokens(os.path.join(HERE, 'tokens.json'))
MODES = T['meta']['modes']
rows = []      # every individual check
cvd_notes = [] # informational

def add(theme, mode, group, check, fg, bg, value, floor, target=None, info=False, unit=':1', strong=None):
    ok = value >= floor - 1e-9
    status = 'INFO' if info else ('PASS' if ok else 'FAIL')
    if info and not ok:
        status = 'NOTE'
    extra = ''
    if target is not None:
        extra = 'target met' if value >= target else f'below {target}{unit} target'
    if strong is not None:
        extra = (extra + '; ' if extra else '') + ('≥4.5 usable as text' if value >= strong else 'non-text only (<4.5)')
    rows.append(dict(theme=theme, mode=mode, group=group, check=check, fg=fg, bg=bg,
                     value=round(value, 3 if value < 1 else 2), floor=floor, status=status, note=extra))

for tid, th in T['themes'].items():
    for mode in MODES:
        s = th['modes'][mode]; ic = mode.endswith('IC')
        surf = {'background': s['background'], 'surface': s['surface'], 'surfaceRaised': s['surfaceRaised'], 'surfaceSunken': s['surfaceSunken']}
        tp = s['textPrimary']
        for n, c in surf.items():
            fl = 7.0 if (ic or n in ('background', 'surfaceRaised')) else 4.5
            add(tid, mode, 'textPrimary', f'textPrimary on {n}', tp, c, contrast(tp, c), fl, target=7.0)
        for h in s['highlights']:
            add(tid, mode, 'textOnHighlight', f"textPrimary on {h['key']} ({h['name']})", tp, h['hex'], contrast(tp, h['hex']), 7.0 if ic else 4.5, target=7.0)
        add(tid, mode, 'textOnSelection', 'textPrimary on selection', tp, s['selection'], contrast(tp, s['selection']), 7.0)
        # selection must never be mistaken for a highlight (studio rule, Phase 2): ΔE2000 ≥ 10 to every highlight in the set
        for h in s['highlights']:
            add(tid, mode, 'selectionΔE', f"ΔE2000 selection vs {h['key']} ({h['name']})", s['selection'], h['hex'], delta_e(s['selection'], h['hex']), 10.0, unit='')
        sp = min(delta_e(s['selection'], s[n]) for n in ('background', 'surface', 'surfaceRaised'))
        add(tid, mode, 'selectionVsPage', 'ΔE2000 selection vs page (min of background/surface/surfaceRaised)', s['selection'], s['surfaceRaised'], sp, 8.0, unit='')
        for n, c in surf.items():
            add(tid, mode, 'textSecondary', f'textSecondary on {n}', s['textSecondary'], c, contrast(s['textSecondary'], c), 7.0 if ic else 4.5)
        for n, c in surf.items():
            add(tid, mode, 'textTertiary', f'textTertiary (placeholder) on {n}', s['textTertiary'], c, contrast(s['textTertiary'], c), 4.5 if ic else 3.0)
        for n, c in surf.items():
            add(tid, mode, 'outline', f'outline on {n}', s['outline'], c, contrast(s['outline'], c), 4.5 if ic else 3.0)
        for n, c in surf.items():
            add(tid, mode, 'noteMarker', f'noteMarker on {n}', s['noteMarker'], c, contrast(s['noteMarker'], c), 4.5 if ic else 3.0)
        for n, c in surf.items():
            add(tid, mode, 'focusRing', f'focusRing on {n}', s['focusRing'], c, contrast(s['focusRing'], c), 3.0)
        for n, c in list(surf.items())[:3]:
            add(tid, mode, 'destructive', f'destructive on {n}', s['destructive'], c, contrast(s['destructive'], c), 4.5 if ic else 3.0, strong=4.5)
        for n, c in list(surf.items())[:3]:
            add(tid, mode, 'separator', f'linkUnderline on {n} (decorative; the underline itself is the non-colour cue, link text is textPrimary)',
                s['linkUnderline'], c, contrast(s['linkUnderline'], c), 1.0, info=True)
        for n, c in surf.items():
            add(tid, mode, 'separator', f'separator on {n} (decorative)', s['separator'], c, contrast(s['separator'], c), 1.0, info=True)
        # accents
        for k, slot in T['accents'][tid]['slots'].items():
            a = slot[mode]; on = slot['onAccent' + mode[0].upper() + mode[1:]]
            for n, c in list(surf.items())[:3]:
                add(tid, mode, 'accent', f"accent {k} {slot['name']} on {n}", a, c, contrast(a, c), 4.5 if ic else 3.0, strong=4.5)
            add(tid, mode, 'onAccent', f"onAccent on accent {k} {slot['name']}", on, a, contrast(on, a), 7.0 if ic else 4.5)
            for n, c in list(surf.items())[:3]:
                add(tid, mode, 'focusRing', f"accent {k} as focus ring on {n}", a, c, contrast(a, c), 3.0)
        # highlights: perceptual separation
        hl = s['highlights']
        for h in hl:
            v = min(delta_e(h['hex'], s[p]) for p in ('background', 'surface', 'surfaceRaised'))
            add(tid, mode, 'highlightVsPage', f"ΔE2000 {h['key']} vs page (min of background/surface/surfaceRaised)", h['hex'], s['surfaceRaised'], v, 12.0, unit='')
        neigh = [(hl[i], hl[(i + 1) % 6]) for i in range(6)]
        for a, b in neigh:
            add(tid, mode, 'highlightΔE', f"ΔE2000 {a['key']}–{b['key']} (neighbours)", a['hex'], b['hex'], delta_e(a['hex'], b['hex']), 15.0, unit='')
        allp = min(itertools.combinations(hl, 2), key=lambda p: delta_e(p[0]['hex'], p[1]['hex']))
        add(tid, mode, 'highlightΔE', f"ΔE2000 min of all 15 pairs ({allp[0]['key']}–{allp[1]['key']})", allp[0]['hex'], allp[1]['hex'],
            delta_e(allp[0]['hex'], allp[1]['hex']), 15.0, info=True, unit='')
        for kind in ('deuteranopia', 'protanopia', 'tritanopia'):
            pairs = sorted(((delta_e_cvd(a['hex'], b['hex'], kind), a, b) for a, b in itertools.combinations(hl, 2)), key=lambda x: x[0])
            v, a, b = pairs[0]
            add(tid, mode, 'highlightCVD', f"{kind} min ΔE2000 ({a['key']} {a['name']}–{b['key']} {b['name']})", a['hex'], b['hex'], v, 10.0, info=True, unit='')
            for v, a, b in pairs:
                if v < 8:
                    cvd_notes.append((tid, mode, kind, f"{a['key']} {a['name']}–{b['key']} {b['name']}", round(v, 1),
                                      'collapses (<5)' if v < 5 else 'close (5–8)'))
        # lightness separation for the CVD-prone pairs
        byk = {h['key']: h for h in hl}
        for ka, kb in CVD_PAIRS:
            a, b = byk[ka], byk[kb]
            dl = abs(hex_to_oklch(a['hex'])[0] - hex_to_oklch(b['hex'])[0])
            add(tid, mode, 'highlightΔL', f"OKLCH ΔL {ka} {a['name']}–{kb} {b['name']}", a['hex'], b['hex'], dl, DL_FLOOR, target=DL_TARGET, unit='')
        v, kind, ka, kb = min((delta_e_cvd(byk[x]['hex'], byk[y]['hex'], k), k, x, y) for x, y in CVD_PAIRS
                              for k in ('deuteranopia', 'protanopia', 'tritanopia'))
        add(tid, mode, 'highlightCVD', f"min simulated ΔE2000 over the 4 ΔL pairs ({kind}, {ka}–{kb})", byk[ka]['hex'], byk[kb]['hex'], v, 8.0, info=True, unit='')
        # Material 3
        m = T['material3'][tid][mode]
        conts = ['surface', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest']
        for c in conts:
            add(tid, mode, 'M3', f'M3 onSurface on {c}', m['onSurface'], m[c], contrast(m['onSurface'], m[c]), 7.0 if ic else 4.5, target=7.0)
            add(tid, mode, 'M3', f'M3 onSurfaceVariant on {c}', m['onSurfaceVariant'], m[c], contrast(m['onSurfaceVariant'], m[c]), 7.0 if ic else 4.5)
            add(tid, mode, 'M3', f'M3 outline on {c}', m['outline'], m[c], contrast(m['outline'], m[c]), 4.5 if ic else 3.0)
            add(tid, mode, 'M3', f'M3 primary on {c}', m['primary'], m[c], contrast(m['primary'], m[c]), 4.5 if ic else 3.0, strong=4.5)
            add(tid, mode, 'M3', f'M3 error on {c}', m['error'], m[c], contrast(m['error'], m[c]), 4.5 if ic else 3.0, strong=4.5)
            add(tid, mode, 'M3', f'M3 outlineVariant on {c} (decorative)', m['outlineVariant'], m[c], contrast(m['outlineVariant'], m[c]), 1.0, info=True)
        add(tid, mode, 'M3', 'M3 onPrimary on primary', m['onPrimary'], m['primary'], contrast(m['onPrimary'], m['primary']), 7.0 if ic else 4.5)
        add(tid, mode, 'M3', 'M3 onPrimaryContainer on primaryContainer', m['onPrimaryContainer'], m['primaryContainer'],
            contrast(m['onPrimaryContainer'], m['primaryContainer']), 7.0 if ic else 4.5)
        add(tid, mode, 'M3', 'M3 onSurface on primaryContainer', m['onSurface'], m['primaryContainer'], contrast(m['onSurface'], m['primaryContainer']), 7.0 if ic else 4.5)
        add(tid, mode, 'M3', 'M3 onSecondaryContainer on secondaryContainer', m['onSecondaryContainer'], m['secondaryContainer'],
            contrast(m['onSecondaryContainer'], m['secondaryContainer']), 7.0 if ic else 4.5)
        add(tid, mode, 'M3', 'M3 onSurface on secondaryContainer', m['onSurface'], m['secondaryContainer'], contrast(m['onSurface'], m['secondaryContainer']), 7.0 if ic else 4.5)
        add(tid, mode, 'M3', 'M3 onError on error', m['onError'], m['error'], contrast(m['onError'], m['error']), 7.0 if ic else 4.5)

# ---------------- output ----------------
if not CHECK_ONLY:
    with open(os.path.join(HERE, 'contrast-table.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

fails = [r for r in rows if r['status'] == 'FAIL']
groups = ['textPrimary', 'textOnHighlight', 'textOnSelection', 'textSecondary', 'textTertiary', 'outline', 'noteMarker',
          'accent', 'onAccent', 'focusRing', 'destructive', 'highlightVsPage', 'highlightΔE', 'highlightΔL', 'highlightCVD', 'selectionΔE', 'selectionVsPage', 'M3']
L = ['# Berean themes: contrast table', '',
     'Generated by `contrast.py` from `tokens.json`. WCAG 2.x relative-luminance contrast; CIEDE2000 for highlight separation; '
     'Machado et al. 2009 (severity 1.0, linear sRGB) for colour-vision simulation. '
     'PASS/FAIL lines are hard floors; INFO/NOTE lines are informational (decorative separators, all-pairs ΔE, CVD).', '',
     f"**Result: {'ALL PASS' if not fails else str(len(fails)) + ' FAIL'}** — {len(rows)} checks, "
     f"{sum(r['status']=='PASS' for r in rows)} pass, {len(fails)} fail, {sum(r['status'] in ('INFO','NOTE') for r in rows)} informational.", '',
     '## Summary: minimum value per check (theme × mode)', '',
     '| theme | mode | ' + ' | '.join(groups) + ' |', '|' + '---|' * (len(groups) + 2)]
summary = {}
for tid in T['themes']:
    for mode in MODES:
        cells = []
        for g in groups:
            rs = [r for r in rows if r['theme'] == tid and r['mode'] == mode and r['group'] == g and not r['check'].endswith('(decorative)')]
            if g == 'highlightΔE':
                rs = [r for r in rs if 'neighbours' in r['check']]
            mn = min(rs, key=lambda r: r['value'])
            summary[(tid, mode, g)] = mn['value']
            flag = '' if all(r['status'] in ('PASS', 'INFO', 'NOTE') for r in rs) else ' ✗'
            cells.append(f"{mn['value']}{flag}")
        L.append(f'| {tid} | {mode} | ' + ' | '.join(cells) + ' |')
L += ['', 'Floors: text 4.5 (7 on background/surfaceRaised, 7 everywhere in IC; selection 7 in every set); textSecondary 4.5 (IC 7); textTertiary 3 (IC 4.5, placeholders only); '
      'outline and noteMarker 3 (IC 4.5); accents 3 on background/surface/surfaceRaised (IC 4.5), with “usable as text” noted at 4.5; onAccent 4.5 (IC 7); '
      'focusRing 3; each highlight ΔE2000 ≥ 12 from the page (studio addition, so a highlight never disappears); highlight neighbours ΔE2000 ≥ 15 (orange wraps to yellow); OKLCH ΔL ≥ 0.05 (target 0.08) for the CVD-prone pairs yellow–orange, blue–purple, pink–orange, green–blue; selection ΔE2000 ≥ 10 from every highlight in its set and ≥ 8 from the page (studio addition, so it stays visible).', '']
if cvd_notes:
    L += ['## Colour-vision notes: highlight pairs under ΔE2000 8 when simulated', '',
          'Highlights carry no meaning (they are spoken by hue name, never used to encode state), so this cannot break WCAG 1.4.1. Listed so the picker can avoid placing these pairs side by side.', '',
          '| theme | mode | simulation | pair | ΔE2000 | verdict |', '|---|---|---|---|---|---|']
    L += [f'| {a} | {b} | {c} | {d} | {e} | {f} |' for a, b, c, d, e, f in cvd_notes]
    L.append('')
L += ['## All checks', '']
for tid in T['themes']:
    for mode in MODES:
        L += [f'### {tid} · {mode}', '', '| group | check | fg | bg | value | floor | status | note |', '|---|---|---|---|---|---|---|---|']
        for r in rows:
            if r['theme'] == tid and r['mode'] == mode:
                L.append(f"| {r['group']} | {r['check']} | `{r['fg']}` | `{r['bg']}` | {r['value']} | {r['floor']} | {r['status']} | {r['note']} |")
        L.append('')
if not CHECK_ONLY:
    open(os.path.join(HERE, 'contrast-table.md'), 'w', encoding='utf-8').write('\n'.join(L))
print('\n'.join(L[:8 + 4 * 4 + 4]))
for r in fails:
    print('FAIL', r['theme'], r['mode'], r['check'], r['fg'], r['bg'], r['value'], '<', r['floor'])
sys.exit(1 if fails else 0)
