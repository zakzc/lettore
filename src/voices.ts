export type Voice = { id: string; name: string; lang: string; language: string; gender: string };

/** Keep only well-formed entries; the sidecar response is untrusted. */
export function parseVoices(raw: unknown): Voice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v) =>
    typeof v?.id === "string" && typeof v?.name === "string" && typeof v?.lang === "string"
      ? [{ id: v.id, name: v.name, lang: v.lang, language: typeof v.language === "string" ? v.language : v.lang, gender: typeof v.gender === "string" ? v.gender : "" }]
      : [],
  );
}

export const languagesOf = (voices: Voice[]) => [...new Map(voices.map((v) => [v.lang, v.language])).entries()].map(([lang, label]) => ({ lang, label }));
export const voicesOf = (voices: Voice[], lang?: string) => voices.filter((v) => v.lang === lang);
