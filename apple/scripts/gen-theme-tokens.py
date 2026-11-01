#!/usr/bin/env python3
"""Turn docs/design/themes/tokens.json into a checked-in ThemeTokens.swift.

themes-spec.md §12.1 asks for exactly this: a small script under apple/scripts/
that emits one value per theme x set with the 16 roles, highlights[6] keyed by
colour name in display order, and accents[6], so the apps parse no JSON at
launch.

Usage:
    apple/scripts/gen-theme-tokens.py           # write the Swift file
    apple/scripts/gen-theme-tokens.py --check   # exit 1 if it is out of date

Only the standard library is used, and the output is a pure function of
tokens.json: fixed theme/set/role/highlight/slot ordering and no timestamps, so
running it twice produces no diff.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# apple/scripts/gen-theme-tokens.py -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
TOKENS_JSON = REPO_ROOT / "docs" / "design" / "themes" / "tokens.json"
OUTPUT_SWIFT = (
    REPO_ROOT
    / "apple"
    / "Cupertino"
    / "Sources"
    / "CupertinoUI"
    / "ThemeTokens.swift"
)

# Fixed orders. These come from tokens.json itself (`themes` keys, `modes`,
# `roles`, `highlightFamilies`) and are asserted against it below, so a schema
# change is a loud failure rather than silent drift.
THEME_IDS = ["paper", "sepia", "stone", "sage"]
SETS = ["light", "dark", "lightIC", "darkIC"]
ROLES = [
    "background",
    "surface",
    "surfaceRaised",
    "surfaceSunken",
    "textPrimary",
    "textSecondary",
    "textTertiary",
    "outline",
    "separator",
    "linkUnderline",
    "accent",
    "onAccent",
    "destructive",
    "noteMarker",
    "selection",
    "focusRing",
]
HIGHLIGHT_KEYS = ["yellow", "green", "blue", "pink", "purple", "orange"]

HEX_RE = re.compile(r"^#([0-9A-F]{6})$")
RGBA_RE = re.compile(r"^rgba\((\d{1,3}),(\d{1,3}),(\d{1,3}),(0|1|0?\.\d+)\)$")

HEADER = """\
// ThemeTokens.swift — GENERATED FILE. DO NOT EDIT.
//
// Generated from docs/design/themes/tokens.json, the single source of truth for
// Berean's colour themes (docs/design/themes/themes-spec.md §12.1). Nothing
// here is hand-copied, and nothing parses JSON at launch.
//
// Regenerate with:
//
//     apple/scripts/gen-theme-tokens.py
//
// and check it is current with:
//
//     apple/scripts/gen-theme-tokens.py --check
//
// Contents: for each of the four themes, the four sets (light, dark, lightIC,
// darkIC) with all 16 roles, highlights[6] keyed by colour name in display
// order (yellow, green, blue, pink, purple, orange) with their names and spoken
// names, and accents[6] with their slot, name, hex and onAccent per set.
//
// tokens.json's `material3` block is Expo's (themes-spec §9) and is deliberately
// NOT generated here — with one exception. `scrim` and `scrimWarm` live only
// under `material3` because they are the file's only non-opaque values (§2), and
// the Mac shell needs scrimWarm behind the Omnisearch palette, so those two are
// carried over per set rather than hand-copied. Everything else M3 stays out.
//
// The supporting value types (ThemeColor, ThemeRoles, ThemeAccentSlot, …) are
// hand-written in ThemeColor.swift; set resolution is in ThemeResolution.swift.

// swiftlint:disable all
// swift-format-ignore-file"""


def fail(message: str) -> None:
    sys.stderr.write(f"gen-theme-tokens: {message}\n")
    sys.exit(2)


def hex_literal(value: str, what: str) -> str:
    match = HEX_RE.match(value)
    if not match:
        fail(f"{what}: expected an opaque #RRGGBB hex, got {value!r}")
    return f"0x{match.group(1)}"


def scrim_literal(value: str, what: str) -> str:
    match = RGBA_RE.match(value)
    if not match:
        fail(f"{what}: expected rgba(r,g,b,a), got {value!r}")
    red, green, blue, alpha = match.groups()
    for channel in (red, green, blue):
        if int(channel) > 255:
            fail(f"{what}: channel out of range in {value!r}")
    return (
        f"ThemeScrim(red: {int(red)}, green: {int(green)}, "
        f"blue: {int(blue)}, alpha: {float(alpha)})"
    )


def swift_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def camel(theme_id: str, suffix: str) -> str:
    return theme_id + suffix[0].upper() + suffix[1:]


def validate(tokens: dict) -> None:
    """Catch a tokens.json whose shape the emitter no longer understands."""
    if tokens.get("modes") != SETS:
        fail(f"tokens.json `modes` is {tokens.get('modes')!r}, expected {SETS!r}")
    if tokens.get("roles") != ROLES:
        fail("tokens.json `roles` no longer matches this generator's role list")
    families = tokens.get("highlightFamilies", [])
    if [f["key"] for f in families] != HIGHLIGHT_KEYS:
        fail("tokens.json `highlightFamilies` is not in the documented display order")
    if sorted(tokens.get("themes", {})) != sorted(THEME_IDS):
        fail(f"tokens.json `themes` keys are {sorted(tokens.get('themes', {}))!r}")
    defaults = tokens.get("defaults", {})
    if defaults.get("theme") not in THEME_IDS:
        fail(f"tokens.json `defaults.theme` is {defaults.get('theme')!r}")


def emit_roles(name: str, role_set: dict, m3_set: dict, where: str) -> str:
    lines = [f"    private static let {name} = ThemeRoles("]
    for role in ROLES:
        if role not in role_set:
            fail(f"{where}: missing role {role!r}")
        literal = hex_literal(role_set[role], f"{where}.{role}")
        lines.append(f"        {role}: ThemeColor(hex: {literal}),")

    highlights = role_set.get("highlights", [])
    if [h["key"] for h in highlights] != HIGHLIGHT_KEYS:
        fail(f"{where}.highlights is not in the documented display order")
    lines.append("        highlights: [")
    for highlight in highlights:
        literal = hex_literal(
            highlight["hex"], f"{where}.highlights.{highlight['key']}"
        )
        lines.append(
            "            ThemeHighlight("
            f"key: .{highlight['key']}, "
            f"name: {swift_string(highlight['name'])}, "
            f"spokenName: {swift_string(highlight['spokenName'])}, "
            f"color: ThemeColor(hex: {literal})),"
        )
    lines.append("        ],")

    lines.append(f"        scrim: {scrim_literal(m3_set['scrim'], where + '.scrim')},")
    lines.append(
        f"        scrimWarm: {scrim_literal(m3_set['scrimWarm'], where + '.scrimWarm')}"
    )
    lines.append("    )")
    return "\n".join(lines)


def emit_accents(theme_id: str, accents: dict, where: str) -> str:
    slots = sorted(accents["slots"], key=lambda slot: slot["slot"])
    if [slot["slot"] for slot in slots] != [1, 2, 3, 4, 5, 6]:
        fail(f"{where}: expected accent slots 1…6")

    lines = [f"    private static let {theme_id}Accents: [ThemeAccentSlot] = ["]
    for slot in slots:
        lines.append("        ThemeAccentSlot(")
        lines.append(f"            slot: {slot['slot']},")
        lines.append(f"            name: {swift_string(slot['name'])},")
        for index, set_name in enumerate(SETS):
            mode = slot["modes"][set_name]
            trail = "" if index == len(SETS) - 1 else ","
            hex_value = hex_literal(
                mode["hex"], f"{where}.slot{slot['slot']}.{set_name}.hex"
            )
            on_accent = hex_literal(
                mode["onAccent"], f"{where}.slot{slot['slot']}.{set_name}.onAccent"
            )
            lines.append(
                f"            {set_name}: ThemeAccentValue("
                f"color: ThemeColor(hex: {hex_value}), "
                f"onAccent: ThemeColor(hex: {on_accent})){trail}"
            )
        lines.append("        ),")
    lines.append("    ]")
    return "\n".join(lines)


def render(tokens: dict) -> str:
    validate(tokens)

    out: list[str] = [HEADER, "", "import Foundation", "", "public enum ThemeTokens {"]

    out.append("    /// `version` from tokens.json, so a mismatch is visible in tests.")
    out.append(
        f"    public static let tokensVersion = {swift_string(tokens['version'])}"
    )
    out.append("")
    out.append("    /// tokens.json `defaults`: Paper, accent slot 1, Automatic.")
    out.append(
        f"    public static let defaultTheme = ThemeID.{tokens['defaults']['theme']}"
    )
    out.append(
        "    public static let defaultAccentSlot = "
        f"{int(tokens['defaults']['accentSlot'])}"
    )
    out.append(
        "    public static let defaultAppearance = "
        f"ThemeAppearance.{tokens['defaults']['appearance']}"
    )
    out.append("")
    out.append("    /// Every theme, in the order tokens.json documents.")
    out.append(
        "    public static let allPalettes: [ThemePalette] = ["
        + ", ".join(THEME_IDS)
        + "]"
    )
    out.append("")
    out.append("    public static func palette(_ theme: ThemeID) -> ThemePalette {")
    out.append("        switch theme {")
    for theme_id in THEME_IDS:
        out.append(f"        case .{theme_id}: {theme_id}")
    out.append("        }")
    out.append("    }")

    for theme_id in THEME_IDS:
        theme = tokens["themes"][theme_id]
        out.append("")
        out.append(f"    // MARK: {theme['name']}")
        out.append("")
        out.append(f"    public static let {theme_id} = ThemePalette(")
        out.append(f"        id: .{theme_id},")
        out.append(f"        name: {swift_string(theme['name'])},")
        out.append(f"        character: {swift_string(theme['character'])},")
        out.append(f"        isDefault: {str(bool(theme['default'])).lower()},")
        for set_name in SETS:
            out.append(f"        {set_name}: {camel(theme_id, set_name)},")
        out.append(f"        accentSlots: {theme_id}Accents")
        out.append("    )")
        for set_name in SETS:
            out.append("")
            out.append(
                emit_roles(
                    camel(theme_id, set_name),
                    theme["modes"][set_name],
                    theme["material3"][set_name],
                    f"themes.{theme_id}.modes.{set_name}",
                )
            )
        out.append("")
        out.append(
            emit_accents(
                theme_id, theme["accents"], f"themes.{theme_id}.accents"
            )
        )

    out.append("}")
    out.append("")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; exit non-zero if the checked-in file is stale",
    )
    args = parser.parse_args()

    if not TOKENS_JSON.exists():
        fail(f"{TOKENS_JSON} not found")

    with TOKENS_JSON.open(encoding="utf-8") as handle:
        tokens = json.load(handle)

    generated = render(tokens)
    relative = OUTPUT_SWIFT.relative_to(REPO_ROOT)

    if args.check:
        if not OUTPUT_SWIFT.exists():
            sys.stderr.write(
                f"gen-theme-tokens: {relative} is missing.\n"
                "Run apple/scripts/gen-theme-tokens.py to create it.\n"
            )
            return 1
        current = OUTPUT_SWIFT.read_text(encoding="utf-8")
        if current != generated:
            sys.stderr.write(
                f"gen-theme-tokens: {relative} is out of date with "
                "docs/design/themes/tokens.json.\n"
                "Run apple/scripts/gen-theme-tokens.py and commit the result.\n"
            )
            return 1
        print(f"gen-theme-tokens: {relative} is up to date with tokens.json.")
        return 0

    OUTPUT_SWIFT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_SWIFT.write_text(generated, encoding="utf-8")
    print(f"gen-theme-tokens: wrote {relative}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
