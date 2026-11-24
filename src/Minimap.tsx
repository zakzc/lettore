import { useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "./store";

const CANVAS_W = 104; // width of the page-thumbnail column, CSS px
const GAP = 6;
const TOP = 130; // viewport y below the sticky header and player card
const STRIPE = 2.8; // line pitch used to draw a text block as lines

type Slot = { n: number; y: number; h: number };

/** Right-hand navigator. Left: the pages around the reader drawn as lines of text (click/drag to scroll there).
 *  Right: a thin strip of the whole document (click/drag to jump to a page; ticks mark headings; the dot is the spoken position). */
export function Minimap() {
  const { pages, toc } = useAppSelector((s) => s.document);
  const currentBlockId = useAppSelector((s) => s.player.currentBlockId);
  const skipTypes = useAppSelector((s) => s.player.skipTypes);
  const theme = useAppSelector((s) => s.ui.theme);
  const total = pages.length;

  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const slots = useRef<Slot[]>([]);
  const dragging = useRef<"canvas" | "strip" | undefined>(undefined);
  const [view, setView] = useState({ top: 0, height: 0 });
  const [start, setStart] = useState(1);
  const [height, setHeight] = useState(600);
  const [tick, setTick] = useState(0); // bumps on scroll so the canvas redraws its viewport box
  const [hover, setHover] = useState<{ where: "canvas" | "strip"; page: number; y: number }>();

  useEffect(() => {
    const firstVisible = () => {
      let lo = 1;
      let hi = total;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const bottom = document.getElementById(`page-${mid}`)?.getBoundingClientRect().bottom ?? 0;
        if (bottom > TOP) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = document.documentElement.scrollHeight || 1;
        setView({ top: window.scrollY / h, height: window.innerHeight / h });
        if (!dragging.current) setStart(Math.max(1, firstVisible() - 1)); // keep the window still while dragging
        setTick((t) => t + 1);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(() => setHeight(root.current?.clientHeight ?? 600));
    if (root.current) ro.observe(root.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [total]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = CANVAS_W * dpr;
    c.height = height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const color = (v: string) => css.getPropertyValue(v).trim();
    const ink = color("--ink") || "#222";
    const muted = color("--muted") || "#888";
    const accent = color("--accent") || "#c8451d";
    const paper = color("--surface") || "#fff";

    const laid: Slot[] = [];
    let y = 0;
    for (let n = start; n <= total && y < height; n++) {
      const pg = pages[n - 1];
      if (!pg?.width || !pg?.height) continue;
      const k = CANVAS_W / pg.width;
      const h = pg.height * k;
      g.globalAlpha = 1;
      g.fillStyle = paper;
      g.fillRect(0, y, CANVAS_W, h);
      for (const b of pg.blocks) {
        const [x0, y0, x1, y1] = b.bbox ?? [];
        if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
        const bx = x0 * k, by = y + y0 * k, bw = (x1 - x0) * k, bh = (y1 - y0) * k;
        const current = b.id === currentBlockId;
        g.globalAlpha = skipTypes.includes(b.type) ? 0.25 : 1;
        if (current) {
          g.fillStyle = accent;
          g.globalAlpha = 0.25;
          g.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
          g.globalAlpha = 1;
        }
        g.fillStyle = current ? accent : b.type === "heading" ? ink : b.type === "quote" ? "#7c3aed" : muted;
        if (b.type === "heading") {
          g.fillRect(bx, by, bw, Math.max(2, Math.min(bh, 3.2)));
        } else {
          g.globalAlpha *= 0.7;
          for (let ly = by; ly < by + bh - 1; ly += STRIPE) {
            const last = ly + STRIPE >= by + bh - 1;
            g.fillRect(bx, ly, last ? bw * 0.6 : bw, 1.2); // last line of a block is usually short
          }
        }
      }
      g.globalAlpha = 1;
      laid.push({ n, y, h });
      y += h + GAP;
    }
    slots.current = laid;

    // The part of each page currently on screen.
    let top = Infinity;
    let bottom = -Infinity;
    for (const s of laid) {
      const r = document.getElementById(`page-${s.n}`)?.getBoundingClientRect();
      if (!r || r.height <= 0) continue;
      const a = Math.max(r.top, 0);
      const b = Math.min(r.bottom, window.innerHeight);
      if (b <= a) continue;
      top = Math.min(top, s.y + ((a - r.top) / r.height) * s.h);
      bottom = Math.max(bottom, s.y + ((b - r.top) / r.height) * s.h);
    }
    if (bottom > top) {
      g.fillStyle = accent;
      g.globalAlpha = 0.16;
      g.fillRect(0, top, CANVAS_W, bottom - top);
      g.globalAlpha = 1;
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.strokeRect(0.75, top, CANVAS_W - 1.5, bottom - top);
    }
  }, [pages, start, height, currentBlockId, skipTypes, theme, tick, total]);

  const marks = useMemo(() => {
    const fromToc = toc.filter((t) => t.level <= 2 && t.page >= 1 && t.page <= total).map((t) => ({ page: t.page, title: t.title }));
    const list = fromToc.length
      ? fromToc
      : pages.flatMap((p) => p.blocks.filter((b) => b.type === "heading" && (b.level ?? 3) <= 2).map((b) => ({ page: p.n, title: b.text })));
    return list.slice(0, 400);
  }, [pages, toc, total]);

  const playPage = useMemo(() => pages.find((p) => p.blocks.some((b) => b.id === currentBlockId))?.n, [pages, currentBlockId]);

  if (total < 2) return null;

  // --- thumbnail column ---
  const slotAt = (clientY: number) => {
    const top = canvas.current?.getBoundingClientRect().top ?? 0;
    const y = clientY - top;
    const list = slots.current;
    const s = list.find((s) => y >= s.y && y < s.y + s.h + GAP) ?? (y < 0 ? list[0] : list[list.length - 1]);
    return s ? { s, frac: Math.min(1, Math.max(0, (y - s.y) / s.h)), y } : undefined;
  };
  const scrollToSlot = (clientY: number) => {
    const hit = slotAt(clientY);
    const el = hit && document.getElementById(`page-${hit.s.n}`);
    if (!hit || !el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + hit.frac * el.offsetHeight - window.innerHeight * 0.35 });
  };

  // --- thin whole-document strip ---
  const pageAt = (clientY: number) => {
    const r = strip.current?.getBoundingClientRect();
    if (!r || r.height <= 0) return 1;
    return Math.min(total, Math.max(1, Math.floor(((clientY - r.top) / r.height) * total) + 1));
  };
  const go = (n: number) => document.getElementById(`page-${n}`)?.scrollIntoView({ block: "start" });
  const pct = (n: number) => `${((n - 1) / total) * 100}%`;
  const stripTitle = hover?.where === "strip" ? [...marks].reverse().find((m) => m.page <= hover.page)?.title : undefined;

  return (
    <div ref={root} className="minimap">
      <canvas
        ref={canvas}
        className="mm-canvas"
        style={{ width: CANVAS_W, height }}
        onPointerDown={(e) => {
          dragging.current = "canvas";
          e.currentTarget.setPointerCapture(e.pointerId);
          scrollToSlot(e.clientY);
        }}
        onPointerMove={(e) => {
          const hit = slotAt(e.clientY);
          if (hit) setHover({ where: "canvas", page: hit.s.n, y: hit.y });
          if (dragging.current === "canvas") scrollToSlot(e.clientY);
        }}
        onPointerUp={() => (dragging.current = undefined)}
        onPointerLeave={() => setHover(undefined)}
      />
      <div
        ref={strip}
        className="mm-strip"
        onPointerDown={(e) => {
          dragging.current = "strip";
          e.currentTarget.setPointerCapture(e.pointerId);
          go(pageAt(e.clientY));
        }}
        onPointerMove={(e) => {
          const page = pageAt(e.clientY);
          setHover({ where: "strip", page, y: e.clientY - (strip.current?.getBoundingClientRect().top ?? 0) });
          if (dragging.current === "strip") go(page);
        }}
        onPointerUp={() => (dragging.current = undefined)}
        onPointerLeave={() => setHover(undefined)}
      >
        <div className="mm-view" style={{ top: `${view.top * 100}%`, height: `${Math.max(view.height * 100, 1)}%` }} />
        {marks.map((m, i) => <div key={i} className="mm-tick" style={{ top: pct(m.page) }} />)}
        {playPage && <div className="mm-play" style={{ top: pct(playPage) }} />}
      </div>
      {hover && (
        <div className="mm-tip" style={{ top: hover.y }}>
          Page {hover.page} / {total}
          {stripTitle && <small>{stripTitle}</small>}
        </div>
      )}
    </div>
  );
}
