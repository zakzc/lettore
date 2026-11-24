import { languagesOf, voicesOf } from "./voices";
import { playerActions, useAppDispatch, useAppSelector } from "./store";

/** Language select + voice select (voices of that language only, shown by name: "Alex", not "pm_alex"). */
export function VoicePicker() {
  const dispatch = useAppDispatch();
  const { voices, voice } = useAppSelector((s) => s.player);
  const lang = voices.find((v) => v.id === voice)?.lang;
  return (
    <>
      <select aria-label="Language" value={lang ?? ""} onChange={(e) => dispatch(playerActions.setLanguage(e.target.value))}>
        {languagesOf(voices).map((l) => <option key={l.lang} value={l.lang}>{l.label}</option>)}
      </select>
      <select aria-label="Voice" value={voice} onChange={(e) => dispatch(playerActions.setVoice(e.target.value))}>
        {voicesOf(voices, lang).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    </>
  );
}
