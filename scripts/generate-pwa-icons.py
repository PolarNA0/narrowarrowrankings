#!/usr/bin/env python3
"""Generate the PWA icon set from the bundled brand arrow.

Run `python3 scripts/generate-pwa-icons.py` after changing the arrow asset or
the palette. Requires Pillow (`pip install Pillow`).

The icons are committed, so this is only re-run when the brand changes.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src/assets/icons/1356331491746910319.png"  # Narrow Arrow
OUT = ROOT / "public/icons"

TOP = (16, 20, 37)  # #101425, the shell background's top stop
BOTTOM = (10, 10, 10)  # #0a0a0a, its bottom stop
ACCENT = (56, 189, 248)  # #38bdf8, --app-accent


def vertical_gradient(size: tuple[int, int]) -> Image.Image:
    w, h = size
    strip = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        strip.putpixel((0, y), tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    return strip.resize((w, h))


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255
    )
    return mask


def accent_glow(size: int, center: tuple[int, int], radius: int, strength: int) -> Image.Image:
    falloff = Image.new("L", (size, size), 0)
    ImageDraw.Draw(falloff).ellipse(
        [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius],
        fill=strength,
    )
    falloff = falloff.filter(ImageFilter.GaussianBlur(radius * 0.55))
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.paste(Image.new("RGBA", (size, size), ACCENT + (255,)), (0, 0), falloff)
    return layer


def build(size: int, arrow_scale: float, corner_ratio: float) -> Image.Image:
    """One icon: gradient tile, accent glow, arrow centred.

    `corner_ratio` 0 gives a full-bleed square, which is what the maskable and
    Apple icons want (the platform applies its own mask); a rounded tile looks
    better for the plain icons on desktop.
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    background = vertical_gradient((size, size)).convert("RGBA")
    canvas.paste(background, (0, 0), rounded_mask((size, size), int(size * corner_ratio)))
    canvas.alpha_composite(accent_glow(size, (size // 2, int(size * 0.44)), int(size * 0.34), 80))

    arrow = Image.open(SRC).convert("RGBA")
    side = int(size * arrow_scale)
    arrow = arrow.resize((side, side), Image.LANCZOS)
    canvas.alpha_composite(arrow, ((size - side) // 2, (size - side) // 2))
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    build(192, 0.62, 0.22).save(OUT / "icon-192.png")
    build(512, 0.62, 0.22).save(OUT / "icon-512.png")
    # Maskable: the arrow has to survive an aggressive circular crop, so it is
    # scaled down into the safe zone and the background bleeds to the edges.
    build(512, 0.46, 0.0).save(OUT / "maskable-512.png")
    build(180, 0.62, 0.0).save(OUT / "apple-touch-icon.png")
    build(64, 0.66, 0.22).save(OUT / "favicon-64.png")
    print(f"wrote icons to {OUT}")


if __name__ == "__main__":
    main()
