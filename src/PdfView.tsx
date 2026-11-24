import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { call, errMsg, fetchBytes } from "./api";
import { play } from "./player";
import { Page, Span, useAppSelector } from "./store";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Rectangles (PDF points) of a sentence part, from the sidecar; [] when it cannot be located. Cached per span.
const rectCache = new Map<string, Promise<number[][]>>();
function spanRects(docId: string, s: Span): Promise<number[][]> {
  const key = `${docId}|${s.blockId}|${s.start}|${s.end}`;
  let hit = rectCache.get(key);
  if (!hit) {
    if (rectCache.size > 500) rectCache.clear();
    hit = call("/geometry", { method: "POST", body: JSON.stringify({ docId, blockId: s.blockId, start: s.start, end: s.end }) })
      .then((r) => (Array.isArray(r?.rects) ? r.rects.filter((q: unknown) => Array.isArray(q) && q.length === 4 && q.every(Number.isFinite)) : []))
      .catch(() => []);
    rectCache.set(key, hit);
  }
  return hit;
}

function PageView({ pdf, page, scale, showTypes, currentBlockId, underline }: {
  pdf: pdfjs.PDFDocumentProxy; page: Page; scale: number; showTypes: boolean; currentBlockId?: string; underline?: number[][];
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!visible || !c) return;
    let task: pdfjs.RenderTask | undefined;
    let cancelled = false;
    pdf.getPage(page.n).then((p) => {
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale });
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      task = p.render({ canvas: c, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task.promise.catch(() => {}); // cancelled renders reject
    }).catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
      c.width = c.height = 0; // free the bitmap while off-screen
    };
  }, [visible, pdf, page.n, scale]);

  // Double-click anywhere on the page: read from the block under the pointer, or the nearest one.
  const readFromPoint = (e: React.MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    let best: { id: string; d: number } | undefined;
    for (const b of page.blocks) {
      const [x0, y0, x1, y1] = b.bbox ?? [];
      if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
      const d = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
      if (!best || d < best.d) best = { id: b.id, d };
    }
    if (best) play(best.id);
  };

  const hasCurrent = page.blocks.some((b) => b.id === currentBlockId);
  return (
    <div ref={box} id={`page-${page.n}`} className="page" onDoubleClick={readFromPoint} style={{ width: page.width * scale, height: page.height * scale }}>
      <canvas ref={canvas} style={{ width: page.width * scale, height: page.height * scale }} />
      {(visible || hasCurrent) &&
        page.blocks.map((b) => {
          const [x0, y0, x1, y1] = b.bbox ?? [];
          if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
          return (
            <div
              key={b.id}
              id={`blk-${b.id}`}
              className={`blk${b.id === currentBlockId ? " current" : ""}${showTypes ? ` t-${b.type}` : ""}`}
              style={{ left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale }}
              title={showTypes ? b.type : "Double-click to read from here"}
            />
          );
        })}
      {underline?.map(([x0, , x1, y1], i) => (
        <div key={`u${i}`} className="ul" style={{ left: x0 * scale, top: y1 * scale - 1, width: (x1 - x0) * scale }} />
      ))}
    </div>
  );
}

export function PdfView({ showTypes }: { showTypes: boolean }) {
  const { docId, pages } = useAppSelector((s) => s.document);
  const currentBlockId = useAppSelector((s) => s.player.currentBlockId);
  const resumeBlockId = useAppSelector((s) => s.document.resumeBlockId);
  const spans = useAppSelector((s) => s.player.currentSpans);
  const queue = useAppSelector((s) => s.player.queue);
  const [underlines, setUnderlines] = useState<Record<number, number[][]>>({});
  const pageOf = useMemo(() => new Map(pages.flatMap((p) => p.blocks.map((b) => [b.id, p.n] as const))), [pages]);
  const wrap = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy>();
  const [error, setError] = useState<string>();
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    setPdf(undefined);
    setError(undefined);
    fetchBytes(`/doc/${docId}/file`)
      .then((buf) => {
        task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        return task.promise;
      })
      .then((p) => !cancelled && setPdf(p))
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [docId]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Underline the sentence being read; geometry for queued sentences is fetched ahead so it appears instantly.
  useEffect(() => {
    if (docId) queue.forEach((c) => c.spans.forEach((sp) => void spanRects(docId, sp)));
  }, [docId, queue]);
  useEffect(() => {
    let cancelled = false;
    if (!docId || !spans.length) {
      setUnderlines({});
      return;
    }
    Promise.all(spans.map(async (sp) => ({ page: pageOf.get(sp.blockId), rects: await spanRects(docId, sp) }))).then((list) => {
      if (cancelled) return;
      const by: Record<number, number[][]> = {};
      for (const { page, rects } of list) if (page) by[page] = (by[page] ?? []).concat(rects);
      setUnderlines(by);
    });
    return () => {
      cancelled = true;
    };
  }, [docId, spans, pageOf]);

  // On open, jump to where the reader left off.
  useEffect(() => {
    if (!pdf || !resumeBlockId) return;
    const n = pages.find((p) => p.blocks.some((b) => b.id === resumeBlockId))?.n;
    if (n) setTimeout(() => document.getElementById(`page-${n}`)?.scrollIntoView({ block: "start" }), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  // Keep the spoken block in view, but don't fight a reader who scrolled away on purpose.
  useEffect(() => {
    if (!currentBlockId) return;
    const el = document.getElementById(`blk-${currentBlockId}`);
    const r = el?.getBoundingClientRect();
    if (el && r && (r.top < 120 || r.bottom > window.innerHeight - 20)) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBlockId]);

  const first = pages[0];
  const scale = first?.width ? Math.min(1.6, Math.max(0.3, (width - 192) / first.width)) : 1;
  return (
    <div ref={wrap} className="pdf">
      {error && <p className="error">Could not load the PDF view: {error}</p>}
      {pdf &&
        pages.map((p) => (
          <PageView key={p.n} pdf={pdf} page={p} scale={scale} showTypes={showTypes} currentBlockId={currentBlockId} underline={underlines[p.n]} />
        ))}
    </div>
  );
}
