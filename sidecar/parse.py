import re
import uuid
from collections import Counter

import pymupdf

LIGATURES = str.maketrans({"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "­": ""})
PRIVATE_USE = re.compile("[\ue000-\uf8ff]")  # symbol-font bullets etc. are noise for TTS
PAGE_NUM = re.compile(r"^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(of|/)\s*\d{1,4})?$", re.I)
QUOTE_MARKS = "\"“”«»‘’'"
MARGIN = 0.08  # fraction of page height treated as header/footer zone


def _clean(lines: list[str]) -> str:
    out = ""
    for line in (PRIVATE_USE.sub(" ", l.translate(LIGATURES)).strip() for l in lines):
        if not line:
            continue
        if out.endswith("-") and line[0].islower() and len(out) > 1 and out[-2].isalpha():
            out = out[:-1] + line  # de-hyphenate
        else:
            out = f"{out} {line}" if out else line
    return re.sub(r"\s+", " ", out).strip()


def _raw_blocks(page: pymupdf.Page) -> list[dict]:
    blocks = []
    for b in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        if b.get("type") != 0:
            continue
        lines, sizes, bold, italic, chars = [], Counter(), 0, 0, 0
        for l in b.get("lines", []):
            spans = [s for s in l.get("spans", []) if s.get("text", "").strip()]
            lines.append("".join(s["text"] for s in spans))
            for s in spans:
                n = len(s["text"].strip())
                chars += n
                sizes[round(s.get("size", 0), 1)] += n
                bold += n if (s.get("flags", 0) & 16 or "bold" in s.get("font", "").lower()) else 0
                italic += n if (s.get("flags", 0) & 2 or "italic" in s.get("font", "").lower()) else 0
        text = _clean(lines)
        if not text or not chars:
            continue
        blocks.append({
            "text": text, "bbox": [round(v, 1) for v in b["bbox"]], "lines": len(lines),
            "size": sizes.most_common(1)[0][0], "bold": bold / chars > 0.6, "italic": italic / chars > 0.6,
            "chars": chars,
        })
    return blocks


def _reading_order(blocks: list[dict], width: float) -> list[dict]:
    """Full-width blocks split the page into bands; two-column bands read left column then right."""
    mid = width / 2
    wide = lambda b: b["bbox"][0] < mid - width * 0.05 and b["bbox"][2] > mid + width * 0.05
    out, band = [], []

    def flush():
        left = [b for b in band if b["bbox"][0] < mid]
        right = [b for b in band if b["bbox"][0] >= mid]
        if len(left) > 1 and len(right) > 1:
            band.sort(key=lambda b: (b["bbox"][0] >= mid, b["bbox"][1]))
        else:
            band.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
        out.extend(band)
        band.clear()

    for b in sorted(blocks, key=lambda b: b["bbox"][1]):
        if wide(b):
            flush()
            out.append(b)
        else:
            band.append(b)
    flush()
    return out


def _norm(text: str) -> str:
    return re.sub(r"\d+", "#", text.lower())


def parse_pdf(path: str) -> dict:
    with pymupdf.open(path) as doc:
        if doc.needs_pass:
            raise ValueError("PDF is password-protected")
        pages = [(p.rect.width, p.rect.height, _raw_blocks(p)) for p in doc]
        toc = [{"level": lvl, "title": title, "page": pg} for lvl, title, pg in doc.get_toc()]

    if not any(bl for _, _, bl in pages):
        raise ValueError("no text layer (scanned PDF? OCR is not supported yet)")

    # Body font size and left margin: the most common by character count.
    size_chars, left_chars = Counter(), Counter()
    for _, _, blocks in pages:
        for b in blocks:
            size_chars[b["size"]] += b["chars"]
            left_chars[round(b["bbox"][0] / 5) * 5] += b["chars"]
    body_size = size_chars.most_common(1)[0][0] if size_chars else 10.0
    body_left = left_chars.most_common(1)[0][0] if left_chars else 0

    # Header/footer: margin text whose digits-normalised form repeats across pages.
    margin_text = Counter()
    for w, h, blocks in pages:
        seen = {_norm(b["text"]) for b in blocks if b["bbox"][3] < h * MARGIN * 1.5 or b["bbox"][1] > h * (1 - MARGIN * 1.5)}
        margin_text.update(seen)

    heading_sizes = sorted({b["size"] for _, _, bl in pages for b in bl if b["size"] >= body_size * 1.15}, reverse=True)

    out_pages = []
    for n, (w, h, blocks) in enumerate(pages, start=1):
        result = []
        for b in _reading_order(blocks, w):
            in_margin = b["bbox"][3] < h * MARGIN * 1.5 or b["bbox"][1] > h * (1 - MARGIN * 1.5)
            if in_margin and (PAGE_NUM.match(b["text"]) or margin_text[_norm(b["text"])] >= 3):
                continue
            entry = {"id": f"p{n}b{len(result)}", "text": b["text"], "bbox": b["bbox"]}
            short = len(b["text"]) < 150 and b["lines"] <= 3
            if b["size"] >= body_size * 1.15 and short:
                entry.update(type="heading", level=min(heading_sizes.index(b["size"]) + 1, 3) if b["size"] in heading_sizes else 3)
            elif b["bold"] and short and b["size"] >= body_size * 0.98 and not b["text"].endswith((",", ";")):
                entry.update(type="heading", level=3)
            elif b["size"] < body_size * 0.85 and b["bbox"][1] > h * 0.6:
                entry["type"] = "footnote"
            elif b["italic"] or (b["bbox"][0] - body_left > 18 and b["bbox"][2] < w - 18 - body_left) or (
                b["text"][0] in QUOTE_MARKS and b["text"][-1] in QUOTE_MARKS and len(b["text"]) > 40
            ):
                entry["type"] = "quote"
            else:
                entry["type"] = "body"
            result.append(entry)
        out_pages.append({"n": n, "width": w, "height": h, "blocks": result})

    return {"docId": uuid.uuid4().hex, "pages": out_pages, "toc": toc}
