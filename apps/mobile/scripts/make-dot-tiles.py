#!/usr/bin/env python3
"""Studyspace dot grid tiles (guide §4): one white dot on transparent, tinted
canvasDot at runtime. 1 px dots every 14 px (phones), 1.2 px every 28 px
(tablets), at @1x/@2x/@3x so React Native picks the screen's density.

Run from apps/mobile: python3 scripts/make-dot-tiles.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets" / "studyspace"
TILES = [(14, 1.0), (28, 1.2)]  # spacing, dot diameter, in dp
SCALES = [1, 2, 3]
SUPERSAMPLE = 16


def tile(spacing: int, dot: float, scale: int) -> Image.Image:
    size = spacing * scale
    d = dot * scale
    # Centred in the tile; an odd whole-pixel dot moves half a pixel onto
    # the pixel grid so it draws crisp instead of smeared over four pixels.
    centre = size / 2 + (0.5 if round(d) % 2 == 1 and abs(d - round(d)) < 1e-9 else 0)
    big = Image.new("L", (size * SUPERSAMPLE, size * SUPERSAMPLE), 0)
    r = d / 2 * SUPERSAMPLE
    c = centre * SUPERSAMPLE
    ImageDraw.Draw(big).ellipse((c - r, c - r, c + r, c + r), fill=255)
    alpha = big.resize((size, size), Image.Resampling.BOX)
    img = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    img.putalpha(alpha)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for spacing, dot in TILES:
        for scale in SCALES:
            suffix = "" if scale == 1 else f"@{scale}x"
            path = OUT / f"dot-{spacing}{suffix}.png"
            tile(spacing, dot, scale).save(path, optimize=True)
            print(path.relative_to(OUT.parent.parent))


if __name__ == "__main__":
    main()
