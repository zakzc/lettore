import type { RootState } from "./store";

export type Theme = "auto" | "light" | "dark";
export type Settings = { voice: string; rate: number; skipTypes: string[]; theme: Theme; outlineOpen: boolean };

const SETTINGS_KEY = "lettore.settings";
const POSITIONS_KEY = "lettore.positions";
const MAX_POSITIONS = 200;

const read = (key: string): any => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: settings just won't persist
  }
};

export function loadSettings(): Settings {
  const r = read(SETTINGS_KEY) ?? {};
  return {
    voice: typeof r.voice === "string" ? r.voice : "af_heart",
    rate: typeof r.rate === "number" && r.rate >= 0.5 && r.rate <= 2 ? r.rate : 1,
    skipTypes: Array.isArray(r.skipTypes) ? r.skipTypes.filter((t: unknown) => typeof t === "string") : ["footnote"],
    theme: r.theme === "light" || r.theme === "dark" ? r.theme : "auto",
    outlineOpen: r.outlineOpen === true,
  };
}

export function loadPosition(path: string): string | undefined {
  const v = read(POSITIONS_KEY)?.[path];
  return typeof v === "string" ? v : undefined;
}

function savePosition(path: string, blockId: string) {
  const all: Record<string, string> = read(POSITIONS_KEY) ?? {};
  delete all[path]; // re-insert so the most recent files stay at the end
  all[path] = blockId;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_POSITIONS))) delete all[k];
  write(POSITIONS_KEY, all);
}

/** Saves settings and the reading position whenever they change. */
export function startPersistence(store: { getState: () => RootState; subscribe: (l: () => void) => unknown }) {
  let lastSettings = "";
  let lastPos = "";
  store.subscribe(() => {
    const { player, ui, document: d } = store.getState();
    const settings = JSON.stringify({ voice: player.voice, rate: player.rate, skipTypes: player.skipTypes, theme: ui.theme, outlineOpen: ui.outlineOpen });
    if (settings !== lastSettings) {
      lastSettings = settings;
      write(SETTINGS_KEY, JSON.parse(settings));
    }
    const id = player.currentBlockId ?? d.resumeBlockId;
    const pos = `${d.path}|${id}`;
    if (d.path && id && pos !== lastPos) {
      lastPos = pos;
      savePosition(d.path, id);
    }
  });
}
