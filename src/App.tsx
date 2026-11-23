import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type SidecarInfo = { port: number; token: string };
type Health = { status?: string; modelLoaded?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth({ port, token }: SidecarInfo): Promise<Health> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { "X-Token": token },
      });
      if (res.ok) return (await res.json()) ?? {};
    } catch {
      // sidecar not listening yet
    }
    await sleep(300);
  }
  throw new Error("sidecar did not become healthy within 15s");
}

function App() {
  const [text, setText] = useState("Starting sidecar…");

  useEffect(() => {
    invoke<SidecarInfo>("sidecar_info")
      .then(waitForHealth)
      .then((h) => setText(`/health: ${h.status ?? "unknown"} (model loaded: ${h.modelLoaded ?? false})`))
      .catch((e) => setText(`Error: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  return (
    <main>
      <h1>Lettore</h1>
      <p>{text}</p>
    </main>
  );
}

export default App;
