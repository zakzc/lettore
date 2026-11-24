import re
from collections.abc import Iterator

SENTENCE_END = re.compile(r"(?<=[.!?…])[\"”’')\]]*\s+(?=[\"“‘'(\[]?[A-ZÀ-Ý0-9])")
# A period after these does not end a sentence ("Dr. Smith", "J. Smith", "e.g. this").
ABBREVIATION = re.compile(r"(?:\b(?:Dr|Dra|Mr|Mrs|Ms|Prof|Sr|Sra|Jr|St|vs|etc|Fig|No)|\b[A-Z]|e\.g|i\.e)\.$")
TERMINAL = (".", "!", "?", "…", ":", ";", '"', "”", "’", "'", ")", "]")


def _paragraphs(blocks: list[dict]) -> list[tuple[str, list[tuple[int, str]]]]:
    """Join body blocks that break mid-sentence (column/page breaks) so they are spoken as one flow.

    Returns [(text, [(start offset, blockId), ...])].
    """
    paras: list[tuple[str, list[tuple[int, str]], str]] = []
    for b in blocks:
        text = b["text"]
        if paras:
            prev, segs, prev_type = paras[-1]
            if prev_type == "body" == b["type"] and not prev.endswith(TERMINAL) and text[:1].islower():
                if prev.endswith("-") and len(prev) > 1 and prev[-2].isalpha():
                    joined, start = prev[:-1] + text, len(prev) - 1  # de-hyphenate
                else:
                    joined, start = f"{prev} {text}", len(prev) + 1
                paras[-1] = (joined, segs + [(start, b["id"])], prev_type)
                continue
        paras.append((text, [(0, b["id"])], b["type"]))
    return [(t, s) for t, s, _ in paras]


def _sentences(text: str) -> Iterator[tuple[int, int]]:
    """Yield (start, end) offsets of each sentence in text."""
    pieces, pos = [], 0
    for m in SENTENCE_END.finditer(text):
        pieces.append((pos, m.start()))
        pos = m.end()
    pieces.append((pos, len(text)))
    merged: list[tuple[int, int]] = []
    for a, b in pieces:
        if merged and ABBREVIATION.search(text[merged[-1][0] : merged[-1][1]]):
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    for a, b in merged:
        while a < b and text[a].isspace():
            a += 1
        while b > a and text[b - 1].isspace():
            b -= 1
        if a < b:
            yield a, b


def chunk_blocks(blocks: list[dict], from_block_id: str | None, skip_types: set[str]) -> Iterator[dict]:
    """Yield one chunk per sentence: {chunkId, blockId, text, spans}.

    spans = [{blockId, start, end}]: where the sentence sits in each block's text (a sentence that runs across a
    column or page break covers two blocks). blockId is the block where the sentence starts.
    """
    paras = _paragraphs([b for b in blocks if b["type"] not in skip_types])
    start_at = next((i for i, (_, segs) in enumerate(paras) if any(bid == from_block_id for _, bid in segs)), 0)
    n = 0
    for pi, (text, segs) in enumerate(paras[start_at:], start=start_at):
        # When resuming inside a merged paragraph, begin at the sentence that contains the requested block.
        from_off = next((off for off, bid in segs if bid == from_block_id), 0) if pi == start_at else 0
        bounds = [(off, segs[i + 1][0] if i + 1 < len(segs) else len(text), bid) for i, (off, bid) in enumerate(segs)]
        for a, b in _sentences(text):
            if b <= from_off:
                continue
            spans = [
                {"blockId": bid, "start": max(a, lo) - lo, "end": min(b, hi) - lo}
                for lo, hi, bid in bounds
                if max(a, lo) < min(b, hi)
            ]
            if not spans:
                continue
            yield {"chunkId": n, "blockId": spans[0]["blockId"], "text": text[a:b], "spans": spans}
            n += 1
