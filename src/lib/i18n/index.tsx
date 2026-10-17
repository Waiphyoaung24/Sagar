import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type AppLanguage, loadAppLanguage, saveAppLanguage } from "../prefs";
import { ja } from "./ja";
import { ko } from "./ko";
import { mnw } from "./mnw";
import { my } from "./my";
import { rki } from "./rki";
import { shn } from "./shn";
import { th } from "./th";
import { zh } from "./zh";

export function translate(language: AppLanguage, message: string): string {
  const catalog =
    language === "mnw"
      ? mnw
      : language === "shn"
        ? shn
        : language === "rki"
          ? rki
          : language === "my"
            ? my
            : language === "zh"
              ? zh
              : language === "ja"
                ? ja
                : language === "ko"
                  ? ko
                  : language === "th"
                    ? th
                    : null;
  return catalog && typeof catalog[message] === "string" ? catalog[message] : message;
}

const LanguageContext = createContext<{
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
}>({ language: "en", setLanguage: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<AppLanguage>(loadAppLanguage);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-Hans" : language;
  }, [language]);
  function setLanguage(next: AppLanguage) {
    if (
      next !== "mnw" &&
      next !== "shn" &&
      next !== "rki" &&
      next !== "en" &&
      next !== "my" &&
      next !== "zh" &&
      next !== "ja" &&
      next !== "ko" &&
      next !== "th"
    )
      return;
    saveAppLanguage(next);
    updateLanguage(next);
  }
  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const { language, setLanguage } = useContext(LanguageContext);
  return { language, setLanguage, t: (message: string) => translate(language, message) };
}
