#!/usr/bin/env python3
"""Generate Evidra brand assets from the mark's geometry.

The mark is an evidence graph: two triangles sharing a baseline, with the apex
node picked out in mint — the decision that the surrounding evidence supports.

Drawn from coordinates rather than by rescaling the source PNG, so every size
stays sharp. Rendered at 4x and downsampled, since Pillow has no anti-aliased
line primitive.

Two outputs, sized differently on purpose:
  connector icon — square, read at 32-64px in a connector list
  GitHub avatar  — GitHub crops avatars to a circle, so the mark has to sit
                   inside the inscribed circle or its corners get cut

Run: python3 scripts/build-brand-assets.py
"""
from PIL import Image, ImageDraw
from pathlib import Path

INK = (0, 0, 0)
NODE = (248, 249, 249)
ACCENT = (107, 214, 164)  # #6BD6A4, sampled from the source mark
SS = 4  # supersample factor

# Node positions in unit space, measured off the original mark.
BASE_Y = 0.835  # one baseline for all three feet; measuring each separately
                # left a visible dip under the centre node
BL, BM, BR = (0.19, BASE_Y), (0.49, BASE_Y), (0.79, BASE_Y)
PEAK, APEX = (0.34, 0.47), (0.63, 0.23)
EDGES = [(BL, PEAK), (PEAK, BM), (PEAK, APEX), (APEX, BM), (APEX, BR), (BL, BM), (BM, BR)]
NODES = [(BL, 0.044, NODE), (BM, 0.044, NODE), (BR, 0.044, NODE),
         (PEAK, 0.040, NODE), (APEX, 0.058, ACCENT)]


# At small sizes the full graph collapses into a smudge, so the mark reduces:
# the outer frame and the mint apex carry the identity, the interior does not.
SIMPLE_EDGES = [(BL, PEAK), (PEAK, APEX), (APEX, BR), (BL, BR)]
SIMPLE_NODES = [(BL, 0.05, NODE), (BR, 0.05, NODE), (PEAK, 0.045, NODE), (APEX, 0.075, ACCENT)]


def draw_mark(draw, cx, cy, scale, stroke, simplified=False):
    """Place the mark centred on (cx, cy), `scale` px across its unit box."""
    edges = SIMPLE_EDGES if simplified else EDGES
    nodes = SIMPLE_NODES if simplified else NODES

    def px(point):
        return (cx + (point[0] - 0.49) * scale, cy + (point[1] - 0.53) * scale)

    for a, b in edges:
        draw.line([px(a), px(b)], fill=NODE, width=stroke)
        # Pillow butt-caps every line, leaving notches where edges meet. Cap
        # each end with a dot so the joins read as one continuous frame.
        for point in (a, b):
            x, y = px(point)
            r = stroke / 2
            draw.ellipse([x - r, y - r, x + r, y + r], fill=NODE)

    for point, radius, colour in nodes:
        x, y = px(point)
        r = radius * scale
        draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)


def render(size, mark_fraction, corner_fraction):
    canvas = size * SS
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    radius = int(canvas * corner_fraction)
    draw.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=radius, fill=INK)

    # Below ~64px a proportional stroke thins to near-invisibility and the mint
    # node disappears, so small sizes get a heavier mark rather than a faithful
    # miniature of the large one.
    simplified = size <= 64
    if simplified:
        mark_fraction *= 1.15
        stroke_fraction = 0.05
    elif size <= 128:
        stroke_fraction = 0.034
    else:
        stroke_fraction = 0.028

    draw_mark(
        draw,
        canvas / 2,
        canvas / 2,
        canvas * mark_fraction,
        stroke=int(canvas * stroke_fraction),
        simplified=simplified
    )
    return image.resize((size, size), Image.LANCZOS)


def main():
    out = Path("docs/brand")
    out.mkdir(parents=True, exist_ok=True)

    # Connector icon: square with soft corners, mark at a comfortable weight.
    for size in (1024, 512, 256, 128, 64, 32):
        render(size, mark_fraction=0.62, corner_fraction=0.18).save(out / f"evidra-icon-{size}.png")

    # Avatar: fully rounded, mark pulled in so nothing clips when circle-cropped.
    for size in (1024, 460, 200):
        render(size, mark_fraction=0.52, corner_fraction=0.5).save(out / f"evidra-avatar-{size}.png")

    # Square-cornered variant for contexts that apply their own masking.
    render(1024, mark_fraction=0.58, corner_fraction=0.0).save(out / "evidra-icon-square-1024.png")

    print(f"Wrote {len(list(out.glob('*.png')))} files to {out}/")


if __name__ == "__main__":
    main()
