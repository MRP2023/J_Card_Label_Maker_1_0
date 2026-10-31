"""
Extract the ORIGINAL vector geometry from the supplied cassette-label template PDFs.

Nothing is redrawn or approximated: every path is copied from the PDF's own drawing operators
(lines / cubic béziers / rectangles) and converted pt -> mm. Run:

    python -m venv .venv && .venv/Scripts/pip install pymupdf psd-tools   # one-off
    .venv/Scripts/python scripts/extract_templates.py template_for_label

Outputs (committed):
    src/templates/library.json          geometry used by the app (mm, origin = top-left of the bleed frame)
    template_inventory.json             every discovered file with format, size, role and verification status
"""
import json, os, re, sys, tempfile, zipfile, warnings, collections
warnings.filterwarnings("ignore")
import pymupdf as fitz

PT = 25.4 / 72
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "template_for_label"))
TMP = tempfile.mkdtemp(prefix="cassette_tpl_")

# ---------- helpers ----------
def r4(v): return round(v * PT, 4)

def role(c):
    if not c: return "other"
    r, g, b = c
    if r > .7 and g < .3 and b < .3: return "cut"        # red
    if b > .5 and r < .35: return "safety"                # blue
    if abs(r - g) < .06 and abs(g - b) < .06 and r < .3: return "bleed"  # black / dark grey
    return "other"

def subpaths(d):
    """Split a PyMuPDF drawing into continuous subpaths of (kind, pts) segments."""
    out, cur, end = [], [], None
    for it in d["items"]:
        k = it[0]
        if k == "re":
            if cur: out.append(cur); cur = []
            out.append([("re", it[1])]); end = None; continue
        pts = it[1:]
        start = pts[0]
        if end is None or abs(start.x - end.x) > .05 or abs(start.y - end.y) > .05:
            if cur: out.append(cur)
            cur = []
        cur.append((k, pts)); end = pts[-1]
    if cur: out.append(cur)
    return out

def sub_to_path(sub, ox, oy):
    f = lambda p: f"{r4(p.x) - ox:.4f} {r4(p.y) - oy:.4f}"
    if sub[0][0] == "re":
        r = sub[0][1]
        x0, y0, x1, y1 = r4(r.x0) - ox, r4(r.y0) - oy, r4(r.x1) - ox, r4(r.y1) - oy
        return f"M{x0:.4f} {y0:.4f}H{x1:.4f}V{y1:.4f}H{x0:.4f}Z"
    s = "M" + f(sub[0][1][0])
    for k, pts in sub:
        if k == "l": s += "L" + f(pts[1])
        elif k == "c": s += "C" + " ".join(f(p) for p in pts[1:])
    first, last = sub[0][1][0], sub[-1][1][-1]
    if abs(first.x - last.x) < .05 and abs(first.y - last.y) < .05: s += "Z"
    return s

def sub_bbox(sub):
    """True extents: béziers are sampled (control points can lie outside the curve)."""
    xs, ys = [], []
    for k, pts in sub:
        if k == "re": xs += [pts.x0, pts.x1]; ys += [pts.y0, pts.y1]
        elif k == "c":
            p0, p1, p2, p3 = pts
            for i in range(0, 41):
                u = i / 40; v = 1 - u
                xs.append(v**3 * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u**3 * p3.x)
                ys.append(v**3 * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u**3 * p3.y)
        else:
            for p in pts: xs.append(p.x); ys.append(p.y)
    return min(xs), min(ys), max(xs), max(ys)

def shape(sub, ox=0, oy=0):
    x0, y0, x1, y1 = sub_bbox(sub)
    return {"d": sub_to_path(sub, ox, oy),
            "bbox": {"x": round(r4(x0) - ox, 4), "y": round(r4(y0) - oy, 4), "w": round(r4(x1 - x0), 4), "h": round(r4(y1 - y0), 4)}}

def all_shapes(pdf):
    """[(role, subpath, dashes, fill)] for every stroked/filled vector path on page 1, tiny marks included."""
    out = []
    for d in fitz.open(pdf)[0].get_drawings():
        for sp in subpaths(d):
            out.append((role(d.get("color")), sp, d.get("dashes"), d.get("fill")))
    return out

def size(sub):
    x0, y0, x1, y1 = sub_bbox(sub); return (x1 - x0) * PT, (y1 - y0) * PT

def kind_of(sub):
    w, h = size(sub)
    return "circle" if abs(w - h) < .05 else "oval"

def zip_member(zname, member):
    d = os.path.join(TMP, os.path.splitext(zname)[0])
    if not os.path.isdir(d):
        os.makedirs(d)
        with zipfile.ZipFile(os.path.join(SRC, zname)) as z:
            z.extractall(d)
    return os.path.join(d, member)

def page_text(pdf):
    t = fitz.open(pdf)[0].get_text("text")
    return [re.sub(r"\s+", " ", l).strip() for l in t.splitlines() if l.strip()]

# ---------- template families ----------
FAMILIES = [
    dict(id="cl-nw", name="CL-NW (square corners, hub circles)", one_up=("CL-NW-1UP.zip", "CL-NW-1UP illustrator.pdf"),
         sheet="CL-NW-12UP.pdf", inner_behavior="cut-path",
         behavior_note="Both hub circles are red cut paths in the source file. The source gives no further wording."),
    dict(id="cl-sq", name="CL-SQ (rounded rectangle, oval window)", one_up=("CL-SQ-1UP.zip", "CL-SQ-1UP illustrator.pdf"),
         sheet="CL-SQ-12UP.pdf", inner_behavior="cutout",
         behavior_note="Source: 'ADD ART HERE / WE WILL CUT OUT'. The inner oval is a cutout (hole)."),
    dict(id="cl-wide", name="CL-WIDE (wide, oval window)", one_up=("CL-WIDE-1UP.zip", "CL-WIDE-1UP illustrator.pdf"),
         sheet="CL-WIDE-12UP-2022-06-02.pdf", inner_behavior="cutout",
         behavior_note="Source: 'ADD oval art here we will cut out'. The inner oval is a cutout (hole)."),
    dict(id="cl4rc-standard-2024", name="CL4RC Standard 2024", one_up=("CL4RC-standard-2024.zip", "CL4RC_1-UP label_2024-illustrator.pdf"),
         sheet="CL4RC_12-UP_Template.pdf", inner_behavior="cover-art",
         behavior_note="Source: 'PLEASE COVER THIS OVAL AREA WITH ART'. The inner oval is an artwork-covered region, not a hole."),
    dict(id="casslabela-roundbottom-2021", name="Cassette label, round bottom (2021)",
         one_up=("casslabela-roundbottom-1up-2021.zip", "casslabela-roundbottom-1up-illustrator-2021.pdf"), sheet=None,
         inner_behavior="cover-art",
         behavior_note="Source: 'PLEASE COVER THIS OVAL AREA WITH ART'. The inner oval is an artwork-covered region, not a hole."),
]

def build_family(f):
    pdf = zip_member(*f["one_up"])
    sh = all_shapes(pdf)
    by = collections.defaultdict(list)
    for r, sp, dash, fill in sh:
        w, h = size(sp)
        if w < 2 and h < 2: continue          # registration ticks
        by[r].append((sp, dash))
    cuts = sorted(by["cut"], key=lambda s: -(size(s[0])[0] * size(s[0])[1]))
    cut_sp = cuts[0][0]
    bleed_sp = sorted(by["bleed"], key=lambda s: -(size(s[0])[0] * size(s[0])[1]))[0][0]
    bx0, by0, _, _ = sub_bbox(bleed_sp)
    ox, oy = r4(bx0), r4(by0)                           # local origin = top-left of the bleed frame
    cut = shape(cut_sp, ox, oy)
    bleed = shape(bleed_sp, ox, oy)
    inner = []
    for i, (sp, _) in enumerate(cuts[1:]):
        s = shape(sp, ox, oy); s.update(id=f"inner-{i+1}", kind=kind_of(sp), behavior=f["inner_behavior"], wording=f["behavior_note"]); inner.append(s)
    safety = []
    for sp, dash in by["safety"]:
        s = shape(sp, ox, oy); w, h = size(sp); s.update(kind="line" if min(w, h) < 0.5 else "closed", dashed=bool(dash and dash != "[] 0")); safety.append(s)
    page = fitz.open(pdf)[0]
    t = dict(id=f["id"], name=f["name"], family=f["id"],
             verification="source-vector",
             verificationNote="Geometry copied from the vendor's vector PDF. Dimensions are exactly those of the source file.",
             sourceFiles=[f["one_up"][0] + "::" + f["one_up"][1]] + ([f["sheet"]] if f["sheet"] else []),
             artboardMm={"w": round(r4(page.rect.width), 4), "h": round(r4(page.rect.height), 4)},
             frame={"w": bleed["bbox"]["w"], "h": bleed["bbox"]["h"]}, frameOrigin={"x": round(ox, 4), "y": round(oy, 4)},
             cut=cut, bleed=bleed, safety=safety, inner=inner, instructions=page_text(pdf), sheet=None,
             innerBehavior=f["inner_behavior"], innerBehaviorNote=f["behavior_note"])
    # 12-up sheet: place the local frame so the cut path lands on each slot's cut path
    if f["sheet"]:
        sp_path = os.path.join(SRC, f["sheet"])
        page = fitz.open(sp_path)[0]
        cw, ch = cut["bbox"]["w"], cut["bbox"]["h"]
        slots = set()
        for r, sp, dash, fill in all_shapes(sp_path):
            w, h = size(sp)
            if abs(w - cw) < .1 and abs(h - ch) < .1:
                x0, y0, _, _ = sub_bbox(sp)
                slots.add((round(r4(x0) - cut["bbox"]["x"], 3), round(r4(y0) - cut["bbox"]["y"], 3)))
        slots = sorted(slots, key=lambda s: (round(s[1], 0), s[0]))
        t["sheet"] = dict(file=f["sheet"], paperMm={"w": round(r4(page.rect.width), 4), "h": round(r4(page.rect.height), 4)},
                          slots=[{"x": x, "y": y} for x, y in slots], slotCount=len(slots))
    return t

def build_cass2017():
    """The 2017 template ships only as a 12-up (vector PDF + PSD + PNG). The first slot is used as the 1-up."""
    pdf = zip_member("cass-labela-12-UP.zip", "cass-labela-2017-12up.pdf")
    shapes = all_shapes(pdf)
    cw, ch = 88.905, 41.451
    outers = [sp for r, sp, d, fill in shapes if abs(size(sp)[0] - cw) < .1 and abs(size(sp)[1] - ch) < .1]
    ovals = [(sp, fill) for r, sp, d, fill in shapes if abs(size(sp)[0] - 60.333) < .1 and abs(size(sp)[1] - 15.557) < .1]
    outers.sort(key=lambda sp: (round(sub_bbox(sp)[1], 0), sub_bbox(sp)[0]))
    first = outers[0]
    ox, oy = r4(sub_bbox(first)[0]), r4(sub_bbox(first)[1])
    cut = shape(first, ox, oy)
    inner = []
    for sp, fill in ovals:
        x0, y0, _, _ = sub_bbox(sp)
        if cut["bbox"]["x"] <= r4(x0) - ox <= cut["bbox"]["w"]:
            s = shape(sp, ox, oy)
            if s["bbox"]["x"] + s["bbox"]["w"] <= cut["bbox"]["w"] + .01 and s["bbox"]["y"] + s["bbox"]["h"] <= cut["bbox"]["h"] + .01:
                s.update(id="inner-1", kind="oval", behavior="unspecified",
                         wording="The source marks the oval but gives no cutting instruction. It is shown as an outline guide only, and artwork covers it."); inner = [s]; break
    page = fitz.open(pdf)[0]
    slots = sorted({(round(r4(sub_bbox(sp)[0]), 3), round(r4(sub_bbox(sp)[1]), 3)) for sp in outers}, key=lambda s: (round(s[1], 0), s[0]))
    slots = [{"x": x + 0.0, "y": y + 0.0} for x, y in slots]
    return dict(id="cass-labela-2017", name="Cassette label 2017 (12-up source)", family="cass-labela-2017",
                verification="source-vector",
                verificationNote="Geometry copied from the vendor's 12-up vector PDF (first slot). The source gives no separate bleed or safety lines, only 'bleed your image past the template lines'.",
                sourceFiles=["cass-labela-12-UP.zip::cass-labela-2017-12up.pdf"],
                artboardMm=None, frameOrigin=None,
                frame={"w": cut["bbox"]["w"], "h": cut["bbox"]["h"]}, cut=cut, bleed=None, safety=[], inner=inner,
                instructions=page_text(pdf), innerBehavior="unspecified",
                innerBehaviorNote="The source marks the oval but gives no cutting instruction.",
                sheet=dict(file="cass-labela-12-UP.zip::cass-labela-2017-12up.pdf",
                           paperMm={"w": round(r4(page.rect.width), 4), "h": round(r4(page.rect.height), 4)}, slots=[{"x": s["x"], "y": s["y"]} for s in slots], slotCount=len(slots)))

def build_gloss():
    pdf = zip_member("CL4RC-gloss.zip", "cl4rc-Gloss-1up.pdf")
    page = fitz.open(pdf)[0]
    img = page.get_images(full=True)[0]
    return dict(id="cl4rc-gloss", name="CL4RC Gloss (raster-only source)", family="cl4rc-gloss",
                verification="unverified-raster-only",
                verificationNote="The source files contain only a raster image (no vector paths). No outline can be extracted, and it is NOT assumed to match CL4RC Standard.",
                sourceFiles=["CL4RC-gloss.zip::cl4rc-Gloss-1up.pdf", "CL4RC-gloss.zip::cl4rc-Gloss-1up.psd",
                             "CL4RC-gloss.zip::cl4rc-Gloss Rounded corners 12-UP_SheetLabel_Template BLEED.pdf", "CL4RC-gloss.zip::cl4rc_Gloss Rounded corners 12-UP_SheetLabel_Template BLEED.psd"],
                artboardMm={"w": round(r4(page.rect.width), 4), "h": round(r4(page.rect.height), 4)},
                frame=None, frameOrigin=None, cut=None, bleed=None, safety=[], inner=[], instructions=["* INCLUDE ART IN THIS CENTER OVAL*", "*ALSO EXTEND ART TO OUTER RED LINE FOR CUTTING BLEED*"],
                sheet=None, rasterPixels={"w": img[2], "h": img[3]}, rasterDpi=300)

# ---------- inventory of every file ----------
def inventory():
    items = []
    from PIL import Image
    try:
        from psd_tools import PSDImage
    except Exception:
        PSDImage = None
    def describe(path, shown):
        ext = os.path.splitext(path)[1].lower().lstrip(".")
        e = dict(file=shown, format=ext, bytes=os.path.getsize(path))
        if ext == "pdf":
            doc = fitz.open(path); p = doc[0]
            drawings = p.get_drawings(); imgs = p.get_images(full=True)
            e.update(pages=doc.page_count, pageMm=[round(r4(p.rect.width), 3), round(r4(p.rect.height), 3)],
                     producer=doc.metadata.get("producer") or doc.metadata.get("creator") or None,
                     vectorPaths=len(drawings), embeddedImages=len(imgs),
                     kind="vector" if drawings and not imgs else ("raster" if imgs and not drawings else "mixed"))
            e["text"] = page_text(path)[:6]
        elif ext == "png":
            im = Image.open(path); dpi = im.info.get("dpi", (None, None))[0]
            e.update(pixels=list(im.size), dpi=round(dpi) if dpi else None, kind="raster",
                     mm=[round(im.size[0] / dpi * 25.4, 2), round(im.size[1] / dpi * 25.4, 2)] if dpi else None)
        elif ext == "psd" and PSDImage:
            psd = PSDImage.open(path); w, h = psd.size
            dpi = 300.0
            try:
                res = psd.image_resources.get_data(1005); dpi = res.horizontal / 65536.0 if res.horizontal > 4000 else res.horizontal
            except Exception: pass
            e.update(pixels=[w, h], dpi=dpi, mm=[round(w / dpi * 25.4, 2), round(h / dpi * 25.4, 2)], kind="raster",
                     layers=[l.name for l in psd])
        return e
    for name in sorted(os.listdir(SRC)):
        p = os.path.join(SRC, name)
        if os.path.isdir(p) or name.lower().endswith(".json"): continue
        if name.lower().endswith(".zip"):
            with zipfile.ZipFile(p) as z:
                zip_member(name, "x")
                for m in z.namelist():
                    if m.endswith("/") or m.startswith("__MACOSX"): continue
                    e = describe(zip_member(name, m), f"{name}::{m}")
                    items.append(e)
        else:
            items.append(describe(p, name))
    return items

lib = [build_family(f) for f in FAMILIES] + [build_cass2017(), build_gloss()]
os.makedirs(os.path.join(ROOT, "src", "templates"), exist_ok=True)
with open(os.path.join(ROOT, "src", "templates", "library.json"), "w") as fh:
    json.dump(lib, fh, indent=1)
inv = dict(generatedFrom=os.path.basename(SRC), units="mm",
           note="Every file found in the supplied directory. 'verification' describes the template geometry used by the app.",
           files=inventory(),
           templates=[{k: t[k] for k in ("id", "name", "verification", "verificationNote", "sourceFiles", "artboardMm")} |
                      dict(cutMm=(t["cut"]["bbox"] if t["cut"] else None), frameMm=t["frame"],
                           sheetSlots=(t["sheet"]["slotCount"] if t["sheet"] else 0)) for t in lib])
with open(os.path.join(ROOT, "template_inventory.json"), "w") as fh:
    json.dump(inv, fh, indent=1)
for t in lib:
    print(t["id"], t["verification"], t["frame"], (t["cut"]["bbox"] if t["cut"] else None), "inner", len(t["inner"]), "safety", len(t["safety"]), "slots", (t["sheet"] or {}).get("slotCount"))
