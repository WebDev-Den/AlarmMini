"use client";

import history from "./release-history.json";
import { useLanguage } from "./language-provider";

export function ReleaseHistory({ version, body }: { version: string; body: string }) {
  const { locale } = useLanguage();
  const english = locale === "en";
  const number = version.replace(/^v/, "");
  const current = history.find(entry => entry.version === number);
  const previous = history.filter(entry => entry.version.localeCompare(number, "en", { numeric: true }) < 0);
  const date = (value: string) => new Intl.DateTimeFormat(english ? "en-GB" : "uk-UA", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Kyiv",
  }).format(new Date(value + "T12:00:00Z"));

  return <section className="release-notes" aria-label={english ? "Release notes" : "Опис оновлень"}>
    <h3>{english ? "What's new in" : "Що нового у"} {version}</h3>
    {current ? <ul>{current[locale].map(change => <li key={change}>{change}</li>)}</ul>
      : <p className="release-body">{body || (english ? "No release notes were provided." : "Опис змін ще не додано.")}</p>}
    {previous.length ? <details className="release-history">
      <summary>{english ? "Release history" : "Історія оновлень"}</summary>
      <p className="hint">{english ? "Previous releases are listed for reference. Only the current version can be installed." : "Попередні версії наведено для довідки. Для встановлення доступна актуальна версія."}</p>
      {previous.map(entry => <details className="release-entry" key={entry.version}>
        <summary><strong>v{entry.version}</strong><time dateTime={entry.date}>{date(entry.date)}</time></summary>
        <ul>{entry[locale].map(change => <li key={change}>{change}</li>)}</ul>
      </details>)}
    </details> : null}
  </section>;
}
