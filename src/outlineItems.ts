import type { Page } from "./store";

export type OutlineItem = { title: string; level: number; page: number; blockId: string };
type Toc = { level: number; title: string; page: number };

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** PDF bookmarks when present (matched to a heading block on that page), otherwise the detected headings. */
export function outlineItems(pages: Page[], toc: Toc[]): OutlineItem[] {
  const byPage = new Map(pages.map((p) => [p.n, p]));
  const items = toc.length
    ? toc.flatMap((t) => {
        const pg = byPage.get(t.page);
        const first = pg?.blocks[0];
        if (!pg || !first) return [];
        const key = norm(t.title).slice(0, 25);
        const hit = key ? pg.blocks.find((b) => b.type === "heading" && norm(b.text).includes(key)) : undefined;
        return [{ title: t.title.trim() || "(untitled)", level: Math.max(1, t.level), page: t.page, blockId: (hit ?? first).id }];
      })
    : pages.flatMap((p) =>
        p.blocks.filter((b) => b.type === "heading" && (b.level ?? 3) <= 2).map((b) => ({ title: b.text, level: b.level ?? 2, page: p.n, blockId: b.id })),
      );
  return items.slice(0, 2000);
}
