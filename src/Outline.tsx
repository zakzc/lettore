import { useEffect, useMemo } from "react";
import { Icon } from "./icons";
import { outlineItems } from "./outlineItems";
import { play } from "./player";
import { useAppSelector } from "./store";

export function Outline() {
  const { pages, toc } = useAppSelector((s) => s.document);
  const currentBlockId = useAppSelector((s) => s.player.currentBlockId);
  const items = useMemo(() => outlineItems(pages, toc), [pages, toc]);

  // Active section = last entry at or before the spoken block.
  const active = useMemo(() => {
    if (!currentBlockId) return -1;
    const order = new Map(pages.flatMap((p) => p.blocks).map((b, i) => [b.id, i]));
    const cur = order.get(currentBlockId);
    if (cur === undefined) return -1;
    let found = -1;
    items.forEach((it, i) => {
      const pos = order.get(it.blockId);
      if (pos !== undefined && pos <= cur) found = i;
    });
    return found;
  }, [pages, items, currentBlockId]);

  useEffect(() => {
    document.getElementById(`ol-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (page: number) => document.getElementById(`page-${page}`)?.scrollIntoView({ block: "start" });

  return (
    <nav className="outline" aria-label="Outline">
      <h2>Outline</h2>
      {items.length === 0 && <p className="muted">No headings found in this document.</p>}
      <ul>
        {items.map((it, i) => (
          <li key={i} id={`ol-${i}`} className={i === active ? "active" : ""} style={{ paddingLeft: 8 + (Math.min(it.level, 4) - 1) * 12 }}>
            <button className="ol-title" title={`${it.title} · p. ${it.page}`} onClick={() => go(it.page)}>
              {it.title}
            </button>
            <span className="ol-page">{it.page}</span>
            <button className="ol-play" aria-label={`Read from ${it.title}`} title="Read from here" onClick={() => play(it.blockId)}>
              <Icon name="play" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
