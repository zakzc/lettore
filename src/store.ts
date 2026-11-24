import { configureStore, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { loadSettings, Theme } from "./persist";
import type { Voice } from "./voices";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";

export type Block = { id: string; type: string; text: string; bbox: number[]; level?: number };
export type Page = { n: number; width: number; height: number; blocks: Block[] };
export type PlayerStatus = "idle" | "loading" | "playing" | "paused";
export type Span = { blockId: string; start: number; end: number };
type QueuedChunk = { chunkId: number; blockId: string; spans: Span[] };

const documentSlice = createSlice({
  name: "document",
  initialState: {
    docId: undefined as string | undefined,
    path: undefined as string | undefined,
    name: "",
    resumeBlockId: undefined as string | undefined,
    pages: [] as Page[],
    toc: [] as { level: number; title: string; page: number }[],
    parseStatus: "idle" as "idle" | "parsing" | "ready" | "error",
    error: undefined as string | undefined,
  },
  reducers: {
    parseStarted: (s) => ({ ...s, parseStatus: "parsing", error: undefined, docId: undefined, pages: [], toc: [] }),
    parsed: (s, a: PayloadAction<{ docId: string; path: string; name: string; resumeBlockId?: string; pages: Page[]; toc: { level: number; title: string; page: number }[] }>) => ({
      ...s,
      ...a.payload,
      parseStatus: "ready",
    }),
    setResume: (s, a: PayloadAction<string | undefined>) => void (s.resumeBlockId = a.payload),
    parseFailed: (s, a: PayloadAction<string>) => ({ ...s, parseStatus: "error", error: a.payload }),
  },
});

const saved = loadSettings();

const uiSlice = createSlice({
  name: "ui",
  initialState: { theme: saved.theme, outlineOpen: saved.outlineOpen },
  reducers: {
    setTheme: (s, a: PayloadAction<Theme>) => void (s.theme = a.payload),
    toggleOutline: (s) => void (s.outlineOpen = !s.outlineOpen),
  },
});

const playerSlice = createSlice({
  name: "player",
  initialState: {
    status: "idle" as PlayerStatus,
    queue: [] as QueuedChunk[], // chunks received from the sidecar and not yet finished playing
    currentChunkId: undefined as number | undefined,
    currentBlockId: undefined as string | undefined,
    currentSpans: [] as Span[], // where the sentence being read sits, for the underline
    voice: saved.voice,
    rate: saved.rate,
    skipTypes: saved.skipTypes,
    voices: [] as Voice[],
    error: undefined as string | undefined,
  },
  reducers: {
    setVoices: (s, a: PayloadAction<Voice[]>) => {
      s.voices = a.payload;
      if (!a.payload.some((v) => v.id === s.voice) && a.payload[0]) s.voice = a.payload[0].id;
    },
    setLanguage: (s, a: PayloadAction<string>) => {
      const first = s.voices.find((v) => v.lang === a.payload);
      if (first) s.voice = first.id;
    },
    setVoice: (s, a: PayloadAction<string>) => void (s.voice = a.payload),
    setRate: (s, a: PayloadAction<number>) => void (s.rate = a.payload),
    toggleSkip: (s, a: PayloadAction<string>) => {
      s.skipTypes = s.skipTypes.includes(a.payload) ? s.skipTypes.filter((t) => t !== a.payload) : [...s.skipTypes, a.payload];
    },
    setStatus: (s, a: PayloadAction<PlayerStatus>) => void (s.status = a.payload),
    setError: (s, a: PayloadAction<string | undefined>) => void (s.error = a.payload),
    chunkQueued: (s, a: PayloadAction<QueuedChunk>) => {
      s.queue.push(a.payload);
      if (s.currentChunkId === undefined) {
        s.currentChunkId = a.payload.chunkId;
        s.currentBlockId = a.payload.blockId;
        s.currentSpans = a.payload.spans;
      }
      s.status = s.status === "paused" ? "paused" : "playing";
    },
    chunkFinished: (s, a: PayloadAction<number>) => {
      s.queue = s.queue.filter((c) => c.chunkId !== a.payload);
      if (s.queue[0]) {
        s.currentChunkId = s.queue[0].chunkId;
        s.currentBlockId = s.queue[0].blockId;
        s.currentSpans = s.queue[0].spans;
      }
    },
    reset: (s) => {
      s.status = "idle";
      s.queue = [];
      s.currentChunkId = undefined;
      s.currentBlockId = undefined;
      s.currentSpans = [];
    },
  },
});

export const doc = documentSlice.actions;
export const playerActions = playerSlice.actions;
export const uiActions = uiSlice.actions;
export const store = configureStore({ reducer: { document: documentSlice.reducer, player: playerSlice.reducer, ui: uiSlice.reducer } });
export type RootState = ReturnType<typeof store.getState>;
export const useAppDispatch: () => typeof store.dispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
