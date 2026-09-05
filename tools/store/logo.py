RED = "#8f2323"; DEEP = "#5a1414"; CREAM = "#f3e9d2"; BLACK = "#1a1412"; GOLD = "#d9a441"

def sawtooth(y, up, n=9, h=26, fill=CREAM):
    step = 512 / n; pts = []
    for i in range(n):
        x = i * step
        pts.append(f"M{x:.1f} {y} l{step/2:.1f} {-h if up else h} l{step/2:.1f} {h if up else -h}z")
    return f"<path d='{' '.join(pts)}' fill='{fill}'/>"

def diamond(cx, cy, r, fill):
    return f"<path d='M{cx} {cy-r} L{cx+r} {cy} L{cx} {cy+r} L{cx-r} {cy}z' fill='{fill}'/>"

def mark(with_bands=True, rounded=112, size=512):
    """the eye of the sadu, holding the crescent"""
    bg = (f"<defs><linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='{RED}'/><stop offset='1' stop-color='{DEEP}'/></linearGradient></defs>"
          f"<rect width='512' height='512' rx='{rounded}' fill='url(#bg)'/>")
    bands = ""
    if with_bands:
        bands = (sawtooth(92, up=False, h=28) + sawtooth(420, up=True, h=28) +
                 f"<rect x='0' y='124' width='512' height='5' fill='{GOLD}'/><rect x='0' y='383' width='512' height='5' fill='{GOLD}'/>")
    cx, cy = 256, 256
    eye = (diamond(cx, cy, 140, CREAM) + diamond(cx, cy, 112, BLACK) + diamond(cx, cy, 86, CREAM) +
           diamond(cx, cy, 60, BLACK))
    # the crescent, a moon cut from a moon, sitting in the black heart of the eye
    crescent = (f"<circle cx='{cx+4}' cy='{cy}' r='34' fill='{CREAM}'/>"
                f"<circle cx='{cx+18}' cy='{cy-5}' r='30' fill='{BLACK}'/>")
    gold_thread = (f"<path d='M{cx} {cy-140} L{cx+140} {cy} L{cx} {cy+140} L{cx-140} {cy}z' fill='none' stroke='{GOLD}' stroke-width='6'/>")
    return f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' width='{size}' height='{size}'>{bg}{bands}{eye}{crescent}{gold_thread}</svg>"

# the icon, the maskable one with more safe area, and a wordmark
open('/tmp/logo/icon.svg', 'w').write(mark())
# maskable: the same mark on a full bleed square, everything within the middle 80 percent
m = mark(rounded=0)
open('/tmp/logo/maskable.svg', 'w').write(m)
# a flat mark on nothing, for the status bar and dark uses: cream only
flat = (f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' width='512' height='512'>"
        + diamond(256, 256, 200, CREAM) + diamond(256, 256, 156, 'none').replace("fill='none'", f"fill='{RED}'") + diamond(256, 256, 116, CREAM) + diamond(256, 256, 80, RED)
        + f"<circle cx='260' cy='256' r='44' fill='{CREAM}'/><circle cx='278' cy='249' r='39' fill='{RED}'/></svg>")
open('/tmp/logo/mark-flat.svg', 'w').write(flat)
print('final drawn')
