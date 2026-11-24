import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { Theme } from "./persist";
import { VoicePicker } from "./VoicePicker";
import { playerActions, uiActions, useAppDispatch, useAppSelector } from "./store";

const SKIPPABLE = ["heading", "quote", "footnote"];
const THEMES: Theme[] = ["auto", "light", "dark"];

export function SettingsPanel({ showTypes, setShowTypes }: { showTypes: boolean; setShowTypes: (v: boolean) => void }) {
  const dispatch = useAppDispatch();
  const player = useAppSelector((s) => s.player);
  const theme = useAppSelector((s) => s.ui.theme);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="settings" ref={root}>
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="gear" /> Settings
      </button>
      {open && (
        <div className="panel" role="dialog" aria-label="Settings">
          <div className="field">
            <span>Language and voice</span>
            <VoicePicker />
          </div>
          <label className="field">
            <span>Speed <b>{player.rate.toFixed(1)}×</b></span>
            <input type="range" min={0.5} max={2} step={0.1} value={player.rate} onChange={(e) => dispatch(playerActions.setRate(Number(e.target.value)))} />
          </label>
          <div className="field">
            <span>Skip when reading</span>
            <div className="chips">
              {SKIPPABLE.map((t) => (
                <button key={t} className={`chip${player.skipTypes.includes(t) ? " on" : ""}`} aria-pressed={player.skipTypes.includes(t)} onClick={() => dispatch(playerActions.toggleSkip(t))}>
                  {t}s
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Theme</span>
            <div className="seg">
              {THEMES.map((t) => (
                <button key={t} className={t === theme ? "on" : ""} onClick={() => dispatch(uiActions.setTheme(t))}>{t}</button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={showTypes} onChange={(e) => setShowTypes(e.target.checked)} /> Show block types on the page
          </label>
          <small className="muted">Voice and speed changes restart from the current paragraph. Skip changes apply on the next start.</small>
        </div>
      )}
    </div>
  );
}
