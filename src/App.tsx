import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { call, errMsg, SidecarInfo, setSidecar } from "./api";
import { Icon } from "./icons";
import { Minimap } from "./Minimap";
import { Outline } from "./Outline";
import { loadPosition } from "./persist";
import { PdfView } from "./PdfView";
import { PlayerBar } from "./PlayerBar";
import { stop } from "./player";
import { parseVoices } from "./voices";
import { SettingsPanel } from "./SettingsPanel";
import { doc, playerActions, uiActions, useAppDispatch, useAppSelector } from "./store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      await call("/health");
      return;
    } catch {
      // sidecar not listening yet
    }
    await sleep(300);
  }
  throw new Error("sidecar did not become healthy within 15s");
}

function App() {
  const dispatch = useAppDispatch();
  const document_ = useAppSelector((s) => s.document);
  const { theme, outlineOpen } = useAppSelector((s) => s.ui);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Starting…");
  const [showTypes, setShowTypes] = useState(false);

  useEffect(() => {
    if (theme === "auto") delete window.document.documentElement.dataset.theme;
    else window.document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        setSidecar(await invoke<SidecarInfo>("sidecar_info"));
        await waitForHealth();
        setReady(true);
        for (let n = 0; n < 60; n++) {
          try {
            const v = await call("/voices");
            dispatch(playerActions.setVoices(parseVoices(v?.voices)));
            setStatus("");
            return;
          } catch (e) {
            if (n === 59) setStatus(`Speech unavailable: ${errMsg(e)}`);
          }
          await sleep(500);
        }
      } catch (e) {
        setStatus(`Error: ${errMsg(e)}`);
      }
    })();
  }, [dispatch]);

  const load = async () => {
    try {
      const picked = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (typeof picked !== "string") return;
      stop();
      dispatch(doc.parseStarted());
      const d = await call("/parse", { method: "POST", body: JSON.stringify({ path: picked }) });
      const pages = Array.isArray(d?.pages) ? d.pages : [];
      const saved = loadPosition(picked);
      const exists = saved && pages.some((p: { blocks?: { id: string }[] }) => p?.blocks?.some((b) => b.id === saved));
      dispatch(
        doc.parsed({
          docId: String(d?.docId ?? ""),
          path: picked,
          name: picked.split("/").pop() ?? picked,
          resumeBlockId: exists ? saved : undefined,
          pages,
          toc: Array.isArray(d?.toc) ? d.toc : [],
        }),
      );
    } catch (e) {
      dispatch(doc.parseFailed(errMsg(e)));
    }
  };

  const parsing = document_.parseStatus === "parsing";
  const hasDoc = !!document_.docId;
  const message = parsing ? "Reading the PDF…" : document_.error ?? status;

  return (
    <div className="app">
      <header>
        <div className="head-left">
          <button className="btn primary" onClick={load} disabled={!ready || parsing}>
            <Icon name="folder" /> Load PDF
          </button>
          {hasDoc && (
            <button className="btn" aria-pressed={outlineOpen} onClick={() => dispatch(uiActions.toggleOutline())}>
              <Icon name="list" /> Outline
            </button>
          )}
        </div>
        <h1>Lettore</h1>
        <div className="head-right">
          <SettingsPanel showTypes={showTypes} setShowTypes={setShowTypes} />
        </div>
      </header>

      <div className="layout">
        {hasDoc && outlineOpen && <Outline />}
        <main>
          {hasDoc && <PlayerBar />}
          {message && <p className={document_.error ? "error" : "status"}>{message}</p>}
          {!hasDoc && !parsing && ready && (
            <section className="empty">
              <h2>Listen to any PDF</h2>
              <p>Load a document and Lettore reads it aloud, offline, with a natural voice. Double-click anywhere on a page to start from there.</p>
              <button className="btn primary big" onClick={load}><Icon name="folder" /> Load PDF</button>
            </section>
          )}
          {hasDoc && <PdfView showTypes={showTypes} />}
        </main>
      </div>
      {hasDoc && <Minimap />}
    </div>
  );
}

export default App;
