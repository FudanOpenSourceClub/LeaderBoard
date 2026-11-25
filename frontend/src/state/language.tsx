import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { COMPETITION_PERIOD } from "@leadboard/contracts";

type Locale = "zh-CN" | "en";
export type Translate = (zh: string, en: string) => string;
const storageKey = "leadboard-language";
const translations: Record<Locale, Translate> = {
  "zh-CN": (zh) => zh,
  en: (_zh, en) => en,
};
const LanguageContext = createContext({
  locale: "zh-CN" as Locale,
  t: translations["zh-CN"],
  toggleLanguage: () => {},
});

function readLanguage(): Locale {
  try {
    return window.localStorage.getItem(storageKey) === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(readLanguage);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translations[locale]("LeaderBoard · 开源贡献", "LeaderBoard · Open source contributions");
    try {
      window.localStorage.setItem(storageKey, locale);
    } catch {
      // The language still works for this visit if storage is unavailable.
    }
  }, [locale]);

  function toggleLanguage() {
    setLocale(current => current === "zh-CN" ? "en" : "zh-CN");
  }

  return <LanguageContext.Provider value={{ locale, t: translations[locale], toggleLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageToggle() {
  const { locale, t, toggleLanguage } = useLanguage();
  const label = t("切换到英文", "Switch to Chinese");
  return <button type="button" className="language-toggle" aria-label={label} title={label} onClick={toggleLanguage}>
    {locale === "en" ? "EN" : "中"}
  </button>;
}

const competitionDate = new Intl.DateTimeFormat("en", {
  timeZone: COMPETITION_PERIOD.timezone,
  month: "short",
  day: "numeric",
  year: "numeric",
});
const competitionDatesEn = competitionDate.formatRange(
  new Date(COMPETITION_PERIOD.startsAt),
  new Date(Date.parse(COMPETITION_PERIOD.endsAtExclusive) - 1),
);

export function useCompetitionLabels() {
  const { t } = useLanguage();
  return {
    dates: t(COMPETITION_PERIOD.label, competitionDatesEn),
    option: t(COMPETITION_PERIOD.optionLabel, "Competition (" + competitionDatesEn + ")"),
  };
}
