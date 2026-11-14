"""Small helpers to build a deck by duplicating and filling slides of a .pptx template.

python-pptx cannot duplicate slides, so `duplicate()` copies a slide's shape tree and
re-points every relationship (images, OLE objects, hyperlinks) at the new slide part.
Unused template slides are dropped at the end; python-pptx only saves parts that are
still reachable, so their media disappears from the output too.
"""
from __future__ import annotations

import copy
import re
from typing import Iterable, Sequence, Union

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

# Template palette (taken from the AIERP Summit template)
RED = "D01012"
DARK_RED = "750909"
YELLOW = "FFD100"
ICE = "C9F2F8"
INK = "262626"
GREY = "F2F2F2"
MID_GREY = "6B6B6B"
WHITE = "FFFFFF"
CODE_BG = "1F1F24"

BODY_FONT = "Segoe UI"
BODY_FONT_BOLD = "Segoe UI Semibold"
CODE_FONT = "Consolas"


# --------------------------------------------------------------------------- slides
def duplicate(prs, src):
    """Append a copy of `src` (a template slide) to the deck and return it."""
    new = prs.slides.add_slide(src.slide_layout)
    rid_map = {}
    for rid, rel in src.part.rels.items():
        if rel.reltype.endswith("/slideLayout") or rel.reltype.endswith("/notesSlide"):
            continue
        if rel.is_external:
            rid_map[rid] = new.part.rels.get_or_add_ext_rel(rel.reltype, rel.target_ref)
        elif rel.reltype.endswith("/tags"):
            # tag parts must have a single owner: give the copy its own part
            from pptx.opc.package import Part
            src_part = rel.target_part
            clone = Part(new.part.package.next_partname("/ppt/tags/tag%d.xml"),
                         src_part.content_type, new.part.package, src_part.blob)
            rid_map[rid] = new.part.relate_to(clone, rel.reltype)
        else:
            rid_map[rid] = new.part.rels.get_or_add(rel.reltype, rel.target_part)
    new_el, src_el = new._element, src._element
    new_el.replace(new_el.find(qn("p:cSld")), copy.deepcopy(src_el.find(qn("p:cSld"))))
    for el in new_el.iter():
        for attr, val in list(el.attrib.items()):
            if attr.startswith("{%s}" % R_NS) and val in rid_map:
                el.attrib[attr] = rid_map[val]
    # python-pptx caches the shape collections (lazyproperty) on first access; reset them
    for cached in ("shapes", "placeholders"):
        new.__dict__.pop(cached, None)
    return new


def drop_slides(prs, keep_from: int):
    """Remove the first `keep_from` slides (the original template slides)."""
    sld_ids = prs.slides._sldIdLst
    for sld_id in list(sld_ids)[:keep_from]:
        prs.part.drop_rel(sld_id.get(qn("r:id")))
        sld_ids.remove(sld_id)


def shape(slide, shape_id: int):
    for s in _iter_shapes(slide.shapes):
        if s.shape_id == shape_id:
            return s
    raise KeyError(f"shape id {shape_id} not found on slide")


def _iter_shapes(shapes):
    for s in shapes:
        yield s
        if s.shape_type == 6:  # group
            yield from _iter_shapes(s.shapes)


def remove(slide, *shape_ids: int):
    for sid in shape_ids:
        el = shape(slide, sid)._element
        el.getparent().remove(el)


def remove_empty_placeholders(slide):
    for ph in list(slide.placeholders):
        if ph.placeholder_format.type is not None and "SLIDE_NUMBER" in str(ph.placeholder_format.type):
            continue
        if ph.has_text_frame and not ph.text_frame.text.strip():
            ph._element.getparent().remove(ph._element)


def notes(slide, text: str):
    slide.notes_slide.notes_text_frame.text = text.strip()


def move(shp, x=None, y=None, w=None, h=None):
    if x is not None:
        shp.left = Inches(x)
    if y is not None:
        shp.top = Inches(y)
    if w is not None:
        shp.width = Inches(w)
    if h is not None:
        shp.height = Inches(h)


def replace_picture(slide, shape_id: int, image_path: str):
    """Swap the image used by a picture or a blip-filled shape."""
    shp = shape(slide, shape_id)
    _, rid = slide.part.get_or_add_image_part(image_path)
    blip = shp._element.find(".//" + qn("a:blip"))
    blip.set(qn("r:embed"), rid)


# --------------------------------------------------------------------------- text
Run = Union[str, dict]
Para = Union[str, dict, Sequence[Run]]


def set_text(shp, paras: Union[Para, Sequence[Para]], **para_defaults):
    """Replace a shape's text, reusing the first paragraph/run formatting of the template.

    A paragraph is a string, a dict ({"runs": [...], "size": 14, "b": True, ...}) or a list of
    runs. A run is a string or a dict ({"t": "text", "b": True, "color": "D01012", "font": ...}).
    Run-level keys: t, b, i, size, color, font. Paragraph-level keys: runs/t, align, bullet,
    space_after, plus run-level defaults applied to all runs of that paragraph.
    """
    if isinstance(paras, (str, dict)):
        paras = [paras]
    tx = shp.text_frame._txBody
    old_ps = tx.findall(qn("a:p"))
    tmpl_p = old_ps[0]
    tmpl_r = tmpl_p.find(qn("a:r"))
    if tmpl_r is None:
        for p in old_ps:
            if p.find(qn("a:r")) is not None:
                tmpl_r = p.find(qn("a:r"))
                break
    tmpl_rpr = tmpl_r.find(qn("a:rPr")) if tmpl_r is not None else None
    for p in old_ps:
        tx.remove(p)

    for para in paras:
        if isinstance(para, str):
            para = {"runs": [para]}
        elif isinstance(para, (list, tuple)):
            para = {"runs": list(para)}
        else:
            para = dict(para)
            if "t" in para and "runs" not in para:
                para["runs"] = [para.pop("t")]
        opts = {**para_defaults, **{k: v for k, v in para.items() if k != "runs"}}
        p = copy.deepcopy(tmpl_p)
        for child in list(p):
            if child.tag in (qn("a:r"), qn("a:br"), qn("a:fld")):
                p.remove(child)
        ppr = p.find(qn("a:pPr"))
        if ppr is None:
            ppr = etree.SubElement(p, qn("a:pPr"))
            p.insert(0, ppr)
        _apply_para(ppr, opts)
        end = p.find(qn("a:endParaRPr"))
        for run in para["runs"]:
            if isinstance(run, str):
                run = {"t": run}
            r = etree.Element(qn("a:r"))
            rpr = copy.deepcopy(tmpl_rpr) if tmpl_rpr is not None else etree.Element(qn("a:rPr"))
            rpr.tag = qn("a:rPr")
            _apply_run(rpr, {**{k: opts[k] for k in ("b", "i", "size", "color", "font") if k in opts}, **run})
            r.append(rpr)
            t = etree.SubElement(r, qn("a:t"))
            t.text = run["t"]
            if end is not None:
                end.addprevious(r)
            else:
                p.append(r)
        tx.append(p)


def _apply_para(ppr, o):
    if "align" in o:
        ppr.set("algn", {"l": "l", "c": "ctr", "r": "r"}[o["align"]])
    if "size" in o:
        ln = ppr.find(qn("a:lnSpc"))
        if ln is not None and ln.find(qn("a:spcPts")) is not None:
            ln.find(qn("a:spcPts")).set("val", str(int(o["size"] * 115)))
    if o.get("bullet") is False:
        for tag in ("a:buChar", "a:buAutoNum", "a:buNone"):
            for el in ppr.findall(qn(tag)):
                ppr.remove(el)
        etree.SubElement(ppr, qn("a:buNone"))
    if "space_after" in o:
        for el in ppr.findall(qn("a:spcAft")):
            ppr.remove(el)
        sa = etree.Element(qn("a:spcAft"))
        etree.SubElement(sa, qn("a:spcPts")).set("val", str(int(o["space_after"] * 100)))
        # spcAft must come after lnSpc/spcBef and before bullets
        anchor = ppr.find(qn("a:spcBef")) if ppr.find(qn("a:spcBef")) is not None else ppr.find(qn("a:lnSpc"))
        if anchor is not None:
            anchor.addnext(sa)
        else:
            ppr.insert(0, sa)


def _apply_run(rpr, o):
    if "size" in o:
        rpr.set("sz", str(int(o["size"] * 100)))
    if "b" in o:
        rpr.set("b", "1" if o["b"] else "0")
    if "i" in o:
        rpr.set("i", "1" if o["i"] else "0")
    if "color" in o:
        for tag in ("a:solidFill", "a:gradFill", "a:noFill"):
            for el in rpr.findall(qn(tag)):
                rpr.remove(el)
        fill = etree.Element(qn("a:solidFill"))
        etree.SubElement(fill, qn("a:srgbClr")).set("val", o["color"])
        # solidFill goes after ln and before latin/ea/cs
        ln = rpr.find(qn("a:ln"))
        if ln is not None:
            ln.addnext(fill)
        else:
            rpr.insert(0, fill)
    if "font" in o:
        for tag in ("a:latin", "a:ea", "a:cs", "a:sym"):
            for el in rpr.findall(qn(tag)):
                el.set("typeface", o["font"])
        if rpr.find(qn("a:latin")) is None:
            lat = etree.Element(qn("a:latin"))
            lat.set("typeface", o["font"])
            after = rpr.find(qn("a:solidFill"))
            if after is not None:
                after.addnext(lat)
            else:
                rpr.insert(0, lat)


# --------------------------------------------------------------------------- new shapes
def box(slide, x, y, w, h, fill=None, line=None, line_w=1.0, radius=True, dash=False, name=None, shadow=False):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
                                 Inches(x), Inches(y), Inches(w), Inches(h))
    if radius:
        shp.adjustments[0] = 0.08 if isinstance(radius, bool) else radius
    if fill:
        shp.fill.solid()
        shp.fill.fore_color.rgb = RGBColor.from_string(fill)
    else:
        shp.fill.background()
    if line:
        shp.line.color.rgb = RGBColor.from_string(line)
        shp.line.width = Pt(line_w)
        if dash:
            from pptx.enum.dml import MSO_LINE
            shp.line.dash_style = MSO_LINE.DASH
    else:
        shp.line.fill.background()
    if not shadow:
        sppr = shp._element.spPr
        etree.SubElement(sppr, qn("a:effectLst"))
    if name:
        shp.name = name
    shp.text_frame.text = ""
    return shp


def text(slide, x, y, w, h, paras, size=14, color=INK, font=BODY_FONT, b=False, i=False,
         align="l", anchor="t", margin=0.0, name=None, wrap=True, line_spacing=None, target=None):
    """Add a text box. `paras` as in set_text (strings, dicts or run lists)."""
    shp = target or slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = shp.text_frame
    tf.word_wrap = wrap
    tf.auto_size = None
    for side in ("left", "right", "top", "bottom"):
        setattr(tf, f"margin_{side}", Inches(margin))
    tf.vertical_anchor = {"t": MSO_ANCHOR.TOP, "m": MSO_ANCHOR.MIDDLE, "b": MSO_ANCHOR.BOTTOM}[anchor]
    if isinstance(paras, (str, dict)):
        paras = [paras]
    first = True
    for para in paras:
        if isinstance(para, str):
            para = {"runs": [para]}
        elif isinstance(para, (list, tuple)):
            para = {"runs": list(para)}
        elif "t" in para and "runs" not in para:
            para = {**para, "runs": [para["t"]]}
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}[para.get("align", align)]
        if para.get("space_after") is not None:
            p.space_after = Pt(para["space_after"])
        if para.get("space_before") is not None:
            p.space_before = Pt(para["space_before"])
        if line_spacing:
            p.line_spacing = line_spacing
        for run in para["runs"]:
            if isinstance(run, str):
                run = {"t": run}
            r = p.add_run()
            r.text = run["t"]
            f = r.font
            f.name = run.get("font", para.get("font", font))
            f.size = Pt(run.get("size", para.get("size", size)))
            f.bold = run.get("b", para.get("b", b))
            f.italic = run.get("i", para.get("i", i))
            f.color.rgb = RGBColor.from_string(run.get("color", para.get("color", color)))
    if name:
        shp.name = name
    return shp


def arrow(slide, x1, y1, x2, y2, color=INK, width=1.75, both=False, dash=False):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = RGBColor.from_string(color)
    c.line.width = Pt(width)
    ln = c.line._get_or_add_ln()
    if dash:
        etree.SubElement(ln, qn("a:prstDash")).set("val", "dash")
    if both:
        he = etree.SubElement(ln, qn("a:headEnd"))
        he.set("type", "triangle")
    te = etree.SubElement(ln, qn("a:tailEnd"))
    te.set("type", "triangle")
    return c


def picture(slide, path, x, y, w=None, h=None):
    return slide.shapes.add_picture(path, Inches(x), Inches(y),
                                    Inches(w) if w else None, Inches(h) if h else None)


# --------------------------------------------------------------------------- code
_TS_KEYWORDS = {
    "const", "let", "await", "async", "if", "for", "of", "new", "return", "function", "import",
    "from", "export", "true", "false", "else", "type", "interface",
}
_TOKEN = re.compile(r"(//.*$)|(\"[^\"]*\"|'[^']*'|`[^`]*`)|([A-Za-z_$][\w$]*)|(\s+)|(.)")


def code_runs(line: str, size: float):
    runs = []
    for m in _TOKEN.finditer(line):
        comment, string, ident, ws, other = m.groups()
        if comment:
            runs.append({"t": comment, "color": "8A8F98", "i": True})
        elif string:
            runs.append({"t": string, "color": "F7B2A8"})
        elif ident:
            runs.append({"t": ident, "color": YELLOW if ident in _TS_KEYWORDS else (ICE if ident[0].isupper() else "EDEDED")})
        else:
            runs.append({"t": ws or other, "color": "EDEDED"})
    if not runs:
        runs = [{"t": " ", "color": "EDEDED"}]
    for r in runs:
        r["font"] = CODE_FONT
        r["size"] = size
    return runs


def code_panel(slide, x, y, w, h, code: str, size=13, label=None):
    panel = box(slide, x, y, w, h, fill=CODE_BG, radius=0.04, name="Code panel")
    top = y + 0.15
    if label:
        text(slide, x + 0.25, y + 0.12, w - 0.5, 0.3,
             [{"t": label, "b": True}], size=11, color=YELLOW, font=BODY_FONT_BOLD, name="Code label")
        top += 0.35
    lines = code.strip("\n").splitlines()
    text(slide, x + 0.25, top, w - 0.5, h - (top - y) - 0.1,
         [{"runs": code_runs(l, size)} for l in lines], size=size, font=CODE_FONT, name="Code")
    return panel


# --------------------------------------------------------------------------- package hygiene
P14_NS = "http://schemas.microsoft.com/office/powerpoint/2010/main"


def set_sections(prs, sections):
    """Rewrite the section list. `sections` is [(name, slide_count), ...] covering every slide.

    The template ships its own section list; once its slides are dropped, stale section entries
    point at slide ids that no longer exist and PowerPoint reports the file as needing repair.
    """
    import uuid

    pres = prs.part._element
    sld_ids = [s.get("id") for s in prs.slides._sldIdLst]
    assert sum(n for _, n in sections) == len(sld_ids), "sections must cover every slide"
    ext_lst = pres.find(qn("p:extLst"))
    if ext_lst is None:
        ext_lst = etree.SubElement(pres, qn("p:extLst"))
    for ext in list(ext_lst):
        if ext.find("{%s}sectionLst" % P14_NS) is not None:
            ext_lst.remove(ext)
    ext = etree.Element(qn("p:ext"), uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}")
    sec_lst = etree.SubElement(ext, "{%s}sectionLst" % P14_NS, nsmap={"p14": P14_NS})
    i = 0
    for name, n in sections:
        sec = etree.SubElement(sec_lst, "{%s}section" % P14_NS, name=name, id="{%s}" % str(uuid.uuid4()).upper())
        ids = etree.SubElement(sec, "{%s}sldIdLst" % P14_NS)
        for sid in sld_ids[i:i + n]:
            etree.SubElement(ids, "{%s}sldId" % P14_NS, id=sid)
        i += n
    ext_lst.insert(0, ext)


def drop_revision_parts(prs):
    """Remove the template's co-authoring history (it references the template's own slides)."""
    for rid, rel in list(prs.part.rels.items()):
        if rel.reltype.endswith("/changesInfo") or rel.reltype.endswith("/revisionInfo"):
            prs.part.drop_rel(rid)


def fix_duplicate_shape_ids(prs):
    """Give every shape on a slide a unique id (the template itself reuses a few)."""
    for slide in prs.slides:
        els = list(slide._element.iter(qn("p:cNvPr")))
        next_id = max(int(el.get("id")) for el in els) + 1
        seen = set()
        for el in els:
            if el.get("id") in seen:
                el.set("id", str(next_id))
                next_id += 1
            seen.add(el.get("id"))


def text_shadow(shp, from_paragraph=0):
    """Soft dark shadow under the text runs, for legibility over busy artwork."""
    for p in shp.text_frame._txBody.findall(qn("a:p"))[from_paragraph:]:
        for rpr in p.iter(qn("a:rPr")):
            for old in rpr.findall(qn("a:effectLst")):
                rpr.remove(old)
            eff = etree.fromstring(
                '<a:effectLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                '<a:outerShdw blurRad="50800" dist="19050" dir="2700000" algn="tl" rotWithShape="0">'
                '<a:srgbClr val="000000"><a:alpha val="85000"/></a:srgbClr></a:outerShdw></a:effectLst>')
            # effectLst goes right after the fill, before highlight/fonts
            fill = rpr.find(qn("a:solidFill"))
            if fill is not None:
                fill.addnext(eff)
            elif rpr.find(qn("a:ln")) is not None:
                rpr.find(qn("a:ln")).addnext(eff)
            else:
                rpr.insert(0, eff)


# --------------------------------------------------------------------------- size
def optimize_pngs(pptx_path: str, cache_dir: str):
    """Losslessly recompress every PNG in the package (oxipng), caching results by hash.

    Keeps the deck smaller for download and e-mail; pixels are unchanged.
    """
    import hashlib
    import os
    import zipfile

    try:
        import oxipng
    except ImportError:  # optional dependency
        print("pyoxipng not installed; skipping PNG optimization")
        return
    os.makedirs(cache_dir, exist_ok=True)
    tmp = pptx_path + ".tmp"
    with zipfile.ZipFile(pptx_path) as src, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename.startswith("ppt/media/") and info.filename.lower().endswith(".png"):
                key = os.path.join(cache_dir, hashlib.sha1(data).hexdigest() + ".png")
                if not os.path.exists(key):
                    opt = oxipng.optimize_from_memory(data, level=2)
                    with open(key, "wb") as fh:
                        fh.write(opt if len(opt) < len(data) else data)
                with open(key, "rb") as fh:
                    data = fh.read()
            dst.writestr(info.filename, data)
    os.replace(tmp, pptx_path)
