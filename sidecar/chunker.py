import re
from collections.abc import Iterator

SENTENCE_END = re.compile(r"(?<=[.!?…])[\"”’')\]]*\s+(?=[\"“‘'(\[]?[A-ZÀ-Ý0-9])")
TERMINAL = (".", "!", "?", "…", ":", ";", '"', "”", "’", "'", ")", "]")
MAX_SENTENCES, MAX_CHARS = 3, 300


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


def _sentences(text: str) -> Iterator[tuple[int, str]]:
    pos = 0
    for m in SENTENCE_END.finditer(text):
        yield pos, text[pos : m.start()]
        pos = m.end()
    yield pos, text[pos:]


def chunk_blocks(blocks: list[dict], from_block_id: str | None, skip_types: set[str]) -> Iterator[dict]:
    """Yield {chunkId, blockId, text}: 1–3 sentences each. blockId is where the chunk starts."""
    readable = [b for b in blocks if b["type"] not in skip_types]
    paras = _paragraphs(readable)
    start_at = next((i for i, (_, segs) in enumerate(paras) if any(bid == from_block_id for _, bid in segs)), 0)
    n = 0
    for pi, (text, segs) in enumerate(paras[start_at:], start=start_at):
        # When resuming inside a merged paragraph, begin at the sentence that contains the requested block.
        from_off = next((off for off, bid in segs if bid == from_block_id), 0) if pi == start_at else 0
        group: list[tuple[int, str]] = []

        def block_at(off: int) -> str:
            return [bid for o, bid in segs if o <= off][-1]

        def flush():
            nonlocal n
            if group:
                yield {"chunkId": n, "blockId": block_at(group[0][0]), "text": " ".join(s for _, s in group)}
                n += 1
                group.clear()

        for off, s in _sentences(text):
            s = s.strip()
            if not s or off + len(s) <= from_off:
                continue
            if group and (len(group) >= MAX_SENTENCES or sum(len(g) for _, g in group) + len(s) > MAX_CHARS):
                yield from flush()
            group.append((off, s))
        yield from flush()
