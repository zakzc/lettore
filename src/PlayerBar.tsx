import { useMemo } from "react";
import { Icon } from "./icons";
import { VoicePicker } from "./VoicePicker";
import { play, readableBlocks, seek, skip, stop, togglePause } from "./player";
import { playerActions, useAppDispatch, useAppSelector } from "./store";

const SPEEDS = [0.8, 1, 1.25, 1.5, 2];

export function PlayerBar() {
  const dispatch = useAppDispatch();
  const { name, pages, docId, resumeBlockId } = useAppSelector((s) => s.document);
  const p = useAppSelector((s) => s.player);

  const { index, total, page, section, resumePage } = useMemo(() => {
    const readable = readableBlocks(pages, p.skipTypes);
    let section = "";
    let page = 0;
    let resumePage = 0;
    for (const pg of pages) {
      for (const b of pg.blocks) {
        if (b.id === resumeBlockId) resumePage = pg.n;
        if (!page && b.type === "heading") section = b.text;
        if (!page && b.id === p.currentBlockId) page = pg.n;
      }
    }
    return { index: readable.findIndex((b) => b.id === p.currentBlockId), total: readable.length, page, section, resumePage };
  }, [pages, p.skipTypes, p.currentBlockId, resumeBlockId]);

  const active = p.status === "playing" || p.status === "paused";
  const pct = active && index >= 0 && total > 0 ? ((index + 1) / total) * 100 : 0;
  const nextSpeed = SPEEDS.find((s) => s > p.rate + 0.01) ?? SPEEDS[0];
  const subtitle = p.status === "loading" ? "Loading…" : active ? section : resumePage ? `Resume from page ${resumePage}` : docId ? "Ready" : "";

  return (
    <div className="player">
      <div className="player-main">
        <div className="player-title">
          <strong title={name}>{name || "No document"}</strong>
          <span title={subtitle}>{subtitle || " "}</span>
        </div>
        <div className="player-controls">
          <button className="ghost" aria-label="Previous paragraph" title="Previous paragraph" disabled={!active} onClick={() => skip(-1)}><Icon name="back" size={22} /></button>
          <button
            className="round"
            aria-label={p.status === "playing" ? "Pause" : "Play"}
            disabled={!docId || p.status === "loading" || !p.voices.length}
            onClick={() => (active ? togglePause() : play(resumeBlockId))}
          >
            <Icon name={p.status === "playing" ? "pause" : "play"} size={24} />
          </button>
          <button className="ghost" aria-label="Next paragraph" title="Next paragraph" disabled={!active} onClick={() => skip(1)}><Icon name="fwd" size={22} /></button>
        </div>
        <div className="player-side">
          <div className="player-time">
            <span>{active && page ? <><b>p. {page}</b> / {pages.length}</> : `${pages.length} pages`}</span>
            <button className="ghost" aria-label="Stop" title="Stop" disabled={p.status === "idle"} onClick={stop}><Icon name="stop" size={18} /></button>
          </div>
          <div className="player-chips">
            <VoicePicker />
            <button aria-label="Speed" title="Change speed" onClick={() => dispatch(playerActions.setRate(nextSpeed))}>{+p.rate.toFixed(2)}×</button>
          </div>
        </div>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="Position in document"
        aria-valuenow={Math.round(pct)}
        onClick={(e) => {
          if (!docId) return;
          const r = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - r.left) / r.width);
        }}
      >
        <div style={{ width: `${pct}%` }} />
      </div>
      {p.error && <div className="player-error" role="alert">{p.error}</div>}
    </div>
  );
}
