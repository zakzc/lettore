import { errMsg, getSidecar, speakUrl } from "./api";
import { Block, doc, playerActions as pa, Span, store } from "./store";

type Chunk = { chunkId: number; blockId: string; sampleRate: number; audio: string; spans?: unknown };
type Session = { ws: WebSocket; ctx: AudioContext; sources: Set<AudioBufferSourceNode> };

const isChunk = (m: any): m is Chunk =>
  typeof m?.chunkId === "number" && typeof m?.blockId === "string" && typeof m?.sampleRate === "number" && typeof m?.audio === "string";

const toSpans = (v: unknown): Span[] =>
  Array.isArray(v)
    ? v.filter((x) => typeof x?.blockId === "string" && Number.isInteger(x?.start) && Number.isInteger(x?.end) && x.end > x.start)
    : [];

function toBuffer(ctx: AudioContext, c: Chunk): AudioBuffer {
  const bytes = Uint8Array.from(atob(c.audio), (ch) => ch.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const buf = ctx.createBuffer(1, pcm.length, c.sampleRate);
  const out = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return buf;
}

let session: Session | undefined;
const dispatch = store.dispatch;

// Closes the current session. `notifySidecar` is false when a new /speak follows: the sidecar cancels the old
// stream itself, and a late POST /stop could land on the new stream and kill it.
function teardown(notifySidecar: boolean) {
  const at = store.getState().player.currentBlockId;
  if (at) dispatch(doc.setResume(at)); // Play continues from here
  const s = session;
  session = undefined;
  if (s) {
    s.ws.onmessage = s.ws.onclose = s.ws.onerror = null;
    s.ws.close();
    s.sources.forEach((src) => {
      src.onended = null;
      try { src.stop(); } catch { /* not started */ }
    });
    s.ctx.close().catch(() => {});
    const sc = getSidecar();
    if (sc && notifySidecar) fetch(`http://127.0.0.1:${sc.port}/stop`, { method: "POST", headers: { "X-Token": sc.token } }).catch(() => {});
  }
  dispatch(pa.reset());
}

export const stop = () => teardown(true);

export function play(fromBlockId?: string) {
  const { document: d, player: p } = store.getState();
  if (!d.docId) return;
  teardown(false);
  dispatch(pa.setError(undefined));
  dispatch(pa.setStatus("loading"));
  let ws: WebSocket;
  try {
    ws = new WebSocket(speakUrl());
  } catch (e) {
    dispatch(pa.setError(errMsg(e)));
    dispatch(pa.reset());
    return;
  }
  const ctx = new AudioContext();
  const sources = new Set<AudioBufferSourceNode>();
  const mine: Session = { ws, ctx, sources };
  session = mine;
  let nextTime = 0;
  let done = false;
  const fail = (msg: string) => {
    stop();
    dispatch(pa.setError(msg));
  };

  ws.onopen = () =>
    ws.send(JSON.stringify({ docId: d.docId, fromBlockId, voice: p.voice, rate: p.rate, skipTypes: p.skipTypes }));
  ws.onerror = () => fail("connection to sidecar failed");
  ws.onclose = () => {
    if (session === mine && !done) fail("sidecar closed the connection");
  };
  ws.onmessage = (ev) => {
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return fail("bad message from sidecar"); }
    if (typeof m?.error === "string") return fail(m.error);
    if (m?.done) {
      done = true;
      if (sources.size === 0) stop();
      return;
    }
    if (!isChunk(m)) return;
    let buf: AudioBuffer;
    try { buf = toBuffer(ctx, m); } catch { return fail("could not decode audio"); }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    nextTime = Math.max(nextTime, ctx.currentTime);
    src.start(nextTime);
    nextTime += buf.duration;
    sources.add(src);
    dispatch(pa.chunkQueued({ chunkId: m.chunkId, blockId: m.blockId, spans: toSpans(m.spans) }));
    src.onended = () => {
      sources.delete(src);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ack: m.chunkId }));
      dispatch(pa.chunkFinished(m.chunkId));
      if (done && sources.size === 0) stop();
    };
  };
}

export function togglePause() {
  const ctx = session?.ctx;
  if (!ctx) return;
  if (ctx.state === "running") ctx.suspend().then(() => dispatch(pa.setStatus("paused")));
  else ctx.resume().then(() => dispatch(pa.setStatus("playing")));
}

export const readableBlocks = (pages: { blocks: Block[] }[], skipTypes: string[]) =>
  pages.flatMap((pg) => pg.blocks).filter((b) => !skipTypes.includes(b.type));

/** Restart reading from the previous/next readable block. */
export function skip(delta: 1 | -1) {
  const { document: d, player: p } = store.getState();
  const list = readableBlocks(d.pages, p.skipTypes);
  const i = list.findIndex((b) => b.id === p.currentBlockId);
  const target = list[Math.min(Math.max(i + delta, 0), list.length - 1)];
  if (i >= 0 && target) play(target.id);
}

/** Seek to a fraction (0–1) of the readable blocks. */
export function seek(fraction: number) {
  const { document: d, player: p } = store.getState();
  const list = readableBlocks(d.pages, p.skipTypes);
  const target = list[Math.min(Math.floor(fraction * list.length), list.length - 1)];
  if (target) play(target.id);
}

// Voice or speed changed while reading: restart from the current block once the user settles.
let prev = { voice: store.getState().player.voice, rate: store.getState().player.rate };
let timer: ReturnType<typeof setTimeout> | undefined;
store.subscribe(() => {
  const { voice, rate } = store.getState().player;
  if (voice === prev.voice && rate === prev.rate) return;
  prev = { voice, rate };
  clearTimeout(timer);
  timer = setTimeout(() => {
    const p = store.getState().player;
    if (session && p.currentBlockId && (p.status === "playing" || p.status === "paused")) play(p.currentBlockId);
  }, 400);
});
