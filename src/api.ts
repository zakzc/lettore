export type SidecarInfo = { port: number; token: string };

let sidecar: SidecarInfo | undefined;
export const setSidecar = (s: SidecarInfo) => (sidecar = s);
export const getSidecar = () => sidecar;

const need = (): SidecarInfo => {
  if (!sidecar) throw new Error("sidecar not ready");
  return sidecar;
};

const get = async (path: string, init?: RequestInit) => {
  const s = need();
  const res = await fetch(`http://127.0.0.1:${s.port}${path}`, {
    ...init,
    headers: { "X-Token": s.token, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return res;
};

export const call = async (path: string, init?: RequestInit) => (await get(path, init)).json();
export const fetchBytes = async (path: string) => (await get(path)).arrayBuffer();
export const speakUrl = () => `ws://127.0.0.1:${need().port}/speak?token=${need().token}`;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
