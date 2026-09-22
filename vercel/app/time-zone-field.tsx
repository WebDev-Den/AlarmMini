"use client";
import { useMemo, useState } from "react";
import { useLanguage } from "./language-provider";
import { options, detect } from "../../firmware/work_data/timezone-utils";

export function TimeZoneField({ id, value, onChange, disabled = false }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const { t, locale } = useLanguage();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const choices = useMemo(() => {
    const filtered = options(locale, query);
    const current = options(locale).find(zone => zone.id === value);
    return current && !filtered.some(zone => zone.id === value) ? [current, ...filtered] : filtered;
  }, [locale, query, value]);
  return <div className="time-zone-field">
    <label htmlFor={`${id}-search`}>{t("Знайти країну або місто")}</label>
    <input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" placeholder={t("Країна, місто або Europe/Kyiv")} disabled={disabled} />
    <label htmlFor={id}>{t("Часовий пояс")}</label>
    <select id={id} value={value} onChange={event => { onChange(event.target.value); setError(""); }} disabled={disabled} aria-describedby={`${id}-hint`}>
      {choices.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
    </select>
    <button type="button" className="btn" disabled={disabled} onClick={() => {
      const zone = detect();
      if (zone) { onChange(zone); setQuery(""); setError(""); }
      else setError("Не вдалося визначити часовий пояс. Обери його зі списку.");
    }}>{t("Визначити з браузера")}</button>
    <p className="hint" id={`${id}-hint`}>{t("Обери місце, де стоятиме мапа. Нічний режим працює за місцевим часом; літній час змінюється автоматично.")}</p>
    {error ? <p role="alert">{t(error)}</p> : null}
  </div>;
}
