import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { useTranslation } from "../../lib/i18n";
import {
  type FontPreferences,
  type FontRole,
  fontStack,
  type ThemePreference,
} from "../../lib/prefs";
import { listSystemFonts } from "../../lib/tauri/commands";

export type AppearancePreferences = {
  fonts?: FontPreferences;
  onFontChange?: (role: FontRole, family: string) => void;
  theme: ThemePreference;
  textSize: number;
  onThemeChange: (theme: ThemePreference) => void;
  onTextSizeChange: (size: number) => void;
};

export function AppearanceSettings({
  fonts = { ui: "", translation: "" },
  onFontChange,
  theme,
  textSize,
  onThemeChange,
  onTextSizeChange,
}: AppearancePreferences) {
  const { t, language, setLanguage } = useTranslation();
  const [families, setFamilies] = useState<string[]>([]);
  const [fontState, setFontState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry triggers a new local font scan.
  useEffect(() => {
    let active = true;
    setFontState("loading");
    listSystemFonts()
      .then((names) => {
        if (active) {
          setFamilies(names);
          setFontState("ready");
        }
      })
      .catch(() => {
        if (active) setFontState("error");
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <section className="appearance-settings" aria-labelledby="appearance-heading">
      <h3 className="visually-hidden" id="appearance-heading">
        {t("Appearance")}
      </h3>
      <div className="appearance-settings__controls">
        <label className="form-field settings-row">
          <span className="settings-label" id="app-language-label">
            <Icon name="languages" />
            {t("App language")}
          </span>
          <select
            className="settings-select"
            value={language}
            aria-labelledby="app-language-label"
            aria-describedby="app-language-help"
            onChange={(event) => {
              const next = event.target.value;
              if (
                next === "mnw" ||
                next === "shn" ||
                next === "rki" ||
                next === "en" ||
                next === "my" ||
                next === "zh" ||
                next === "ja" ||
                next === "ko" ||
                next === "th"
              )
                setLanguage(next);
            }}
          >
            <option value="en" lang="en">
              English
            </option>
            <option value="my" lang="my">
              မြန်မာ (Myanmar)
            </option>
            <option value="mnw" lang="mnw">
              Myanmar (Mon) · မန်
            </option>
            <option value="shn" lang="shn">
              Myanmar (Shan) · တႆး
            </option>
            <option value="rki" lang="rki">
              Myanmar (Arakanese) · ရခိုင်
            </option>
            <option value="zh" lang="zh-Hans">
              中文（简体）
            </option>
            <option value="ja" lang="ja">
              日本語
            </option>
            <option value="ko" lang="ko">
              한국어
            </option>
            <option value="th" lang="th">
              ไทย
            </option>
          </select>
        </label>
        <label className="form-field settings-row">
          <span className="settings-label">
            <Icon name="sun" />
            {t("Theme")}
          </span>
          <select
            className="settings-select"
            value={theme}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "system" || value === "light" || value === "dark")
                onThemeChange(value);
            }}
          >
            <option value="system">{t("Follow system")}</option>
            <option value="light">{t("Light")}</option>
            <option value="dark">{t("Dark")}</option>
          </select>
        </label>
      </div>
      <div className="appearance-settings__reading">
        {(["ui", "translation"] as const).map((role) => {
          const label = role === "ui" ? "UI font" : "Translation book font";
          const names =
            fonts[role] && !families.includes(fonts[role])
              ? [fonts[role], ...families]
              : families;
          return (
            <div key={role}>
              <label className="form-field settings-row">
                <span className="settings-label">
                  <Icon name="paragraph" />
                  {t(label)}
                </span>
                <select
                  className="settings-select"
                  value={fonts[role]}
                  disabled={!onFontChange || fontState === "loading"}
                  onChange={(event) => onFontChange?.(role, event.target.value)}
                >
                  <option value="">{t("Default font")}</option>
                  {names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <p
                className="appearance-preview appearance-font-preview"
                style={{
                  fontFamily: fontStack(
                    fonts[role],
                    role === "ui" ? "var(--font-ui-default)" : "var(--font-book)",
                  ),
                  fontSize: role === "ui" ? undefined : textSize,
                }}
              >
                <span lang="en">The next chapter begins here.</span>{" "}
                <span lang="my">မြန်မာစာကို ဖတ်ရှုရန်</span>
              </p>
            </div>
          );
        })}
        <p className="dialog__muted" role="status">
          {t(
            fontState === "loading"
              ? "Loading system fonts…"
              : fontState === "error"
                ? "Could not load system fonts. Try again."
                : families.length === 0
                  ? "No system fonts found."
                  : "Font choices apply to Sagar only. Exported books keep their styles.",
          )}
        </p>
        {fontState !== "loading" && (fontState === "error" || families.length === 0) ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <Icon name="refresh" />
            {t("Retry")}
          </button>
        ) : null}
      </div>
      <div className="appearance-settings__reading">
        <div className="appearance-settings__size-heading">
          <label className="settings-label" htmlFor="reading-text-size">
            <Icon name="paragraph" />
            {t("Reading text size")}
          </label>
          <span className="appearance-settings__size-value" aria-hidden="true">
            {textSize}px
          </span>
        </div>
        <input
          className="appearance-settings__range"
          id="reading-text-size"
          type="range"
          min={14}
          max={28}
          step={1}
          value={textSize}
          aria-valuetext={`${textSize} ${t("pixels")}`}
          onChange={(event) => onTextSizeChange(Number(event.target.value))}
        />
        <section
          className="appearance-preview"
          style={{ fontSize: textSize }}
          aria-label={t("Reading text preview")}
        >
          <p lang="en">The next chapter begins here.</p>
          <p lang="my">မြန်မာစာကို ဖတ်ရှုရန်</p>
        </section>
      </div>
      <details className="settings-help">
        <summary>
          <Icon name="keep" />
          {t("Appearance help")}
        </summary>
        <p className="dialog__muted" id="app-language-help">
          {t(
            "Changes the interface language only. Book text and translation languages stay the same.",
          )}
        </p>
        <p className="dialog__muted">
          {t("Changes apply immediately and are saved on this computer.")}
        </p>
        <p className="dialog__muted">
          {t(
            "Text size applies to the original and translation. Shortcut: Cmd/Ctrl + or −.",
          )}
        </p>
      </details>
    </section>
  );
}
