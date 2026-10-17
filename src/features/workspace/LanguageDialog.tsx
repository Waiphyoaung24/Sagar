import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import { useTranslation } from "../../lib/i18n";
import { languageName, languageSuggestions } from "../../lib/languages";
import { getProject, updateProjectMetadata } from "../../lib/tauri/commands";
import { CommandError } from "../../lib/tauri/errors";
import type { ProjectSummary } from "../../types/project";

type LanguageDialogProps = {
  project: ProjectSummary;
  onClose: () => void;
  onSaved: (project: ProjectSummary) => void;
};

function LanguageField({
  id,
  label,
  value,
  optional,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  optional?: boolean;
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [suggestions] = useState(() => {
    const choices = languageSuggestions();
    const name = languageName(value);
    if (
      value &&
      name &&
      name !== value &&
      !choices.some((item) => item.value === value)
    ) {
      // Preserve an existing short code without showing its full-locale twin.
      const localeIndex = choices.findIndex(
        (item) => item.value.toLowerCase() === `${value}-Mymr-MM`.toLowerCase(),
      );
      const savedChoice = { value, label: `${name} (${value})` };
      if (localeIndex >= 0) choices[localeIndex] = savedChoice;
      else choices.push(savedChoice);
      choices.sort((a, b) => a.label.localeCompare(b.label));
    }
    return choices;
  });
  const [custom, setCustom] = useState(
    () => value !== "" && !suggestions.some((item) => item.value === value),
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const choices = [
    ...(optional ? [{ value: "", label: t("Unknown") }] : []),
    ...suggestions,
    { value: "custom", label: t("Other language…") },
  ];
  const filtered = choices.filter((item) =>
    item.label
      .normalize("NFC")
      .toLowerCase()
      .includes(query.normalize("NFC").trim().toLowerCase()),
  );
  const active = filtered[Math.min(highlight, Math.max(0, filtered.length - 1))];
  const selectedLabel =
    choices.find((item) => item.value === (custom ? "custom" : value))?.label ?? "";
  useEffect(() => {
    if (open && active)
      document
        .getElementById(`${id}-option-${active.value || "unknown"}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);
  function choose(next: string) {
    setCustom(next === "custom");
    if (next !== "custom") onChange(next);
    setOpen(false);
    setQuery("");
  }
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className="language-picker">
        <input
          id={id}
          role="combobox"
          autoComplete="off"
          value={open ? query : selectedLabel}
          placeholder={t("Search languages…")}
          disabled={disabled}
          aria-expanded={open && !disabled}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active ? `${id}-option-${active.value || "unknown"}` : undefined
          }
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setHighlight(0);
          }}
          onClick={() => {
            if (!open) {
              setOpen(true);
              setQuery("");
              setHighlight(0);
            }
          }}
          onBlur={() => {
            setOpen(false);
            setQuery("");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setQuery("");
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) {
                setOpen(true);
                setQuery("");
                setHighlight(0);
              } else
                setHighlight((current) =>
                  Math.max(
                    0,
                    Math.min(
                      filtered.length - 1,
                      current + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              if (active) choose(active.value);
            }
          }}
        />
        {open && !disabled ? (
          <div
            className="language-picker__options"
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
          >
            {filtered.map((item) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                id={`${id}-option-${item.value || "unknown"}`}
                key={item.value}
                aria-selected={item.value === (custom ? "custom" : value)}
                className={`chapter-picker__option${item === active ? " chapter-picker__option--active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item.value)}
              >
                <Icon name="languages" size={16} />
                <span>{item.label}</span>
                {item.value === (custom ? "custom" : value) ? (
                  <Icon name="check" size={16} />
                ) : null}
              </button>
            ))}
            {!filtered.length ? <p role="status">{t("No matching languages")}</p> : null}
          </div>
        ) : null}
      </div>
      {custom ? (
        <input
          aria-label={`${label} · ${t("Language tag")}`}
          value={value}
          maxLength={32}
          disabled={disabled}
          placeholder="e.g. en-GB"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
      {error ? (
        <span id={`${id}-error`} className="form-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const TAG_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * Translation language dialog: shows the book's translation direction and
 * lets the user correct the source/target tags. Source comes from EPUB
 * metadata at import (often missing or wrong) and previously had no edit
 * path; target was only editable at export time.
 */
export function LanguageDialog({ project, onClose, onSaved }: LanguageDialogProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState(project.sourceLanguage ?? "");
  const [target, setTarget] = useState(project.targetLanguage);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (
          event.target instanceof Element &&
          event.target.matches('[role="combobox"][aria-expanded="true"]')
        )
          return;
        event.stopPropagation();
        if (!saving) onClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
          ) ?? [],
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, saving]);

  async function handleSave() {
    const errors: Record<string, string> = {};
    if (target.trim() === "" || !TAG_PATTERN.test(target.trim())) {
      errors.target = "Enter a language tag such as “my” or “en-US”.";
    }
    if (source.trim() !== "" && !TAG_PATTERN.test(source.trim())) {
      errors.source = "Enter a language tag such as “en”, or leave blank for unknown.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateProjectMetadata(project.id, null, target.trim(), source.trim());
      onSaved(await getProject(project.id));
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof CommandError
          ? error.message
          : "The languages could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--narrow language-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-dialog-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="panel__header">
          <h2 className="panel__heading" id="language-dialog-title">
            {t("Translation languages")}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t("Close")}
            title={t("Close")}
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        <form
          className="language-dialog__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) void handleSave();
          }}
        >
          <div className="language-dialog__fields">
            {(
              [
                ["source", "Original language", source],
                ["target", "Translation language", target],
              ] as const
            ).map(([key, label, value]) => (
              <LanguageField
                key={key}
                id={`language-${key}`}
                label={t(label)}
                value={value}
                optional={key === "source"}
                disabled={saving}
                error={fieldErrors[key]}
                onChange={(next) => {
                  (key === "source" ? setSource : setTarget)(next);
                  setFieldErrors((current) => {
                    const nextErrors = { ...current };
                    delete nextErrors[key];
                    return nextErrors;
                  });
                }}
              />
            ))}
          </div>
          <details className="settings-help">
            <summary>
              <Icon name="languages" />
              {t("Language details")}
            </summary>
            <p className="dialog__muted">
              {t(
                "Leave the source blank when the original language is unknown. Changing languages only relabels the project and future exports — book text is never rewritten.",
              )}
            </p>
          </details>
          <div className="settings-footer">
            {saveError ? <StatusNotice kind="error">{saveError}</StatusNotice> : null}
            <div className="settings-footer__actions">
              <span className="dialog__muted">
                {t("Used for translation and export.")}
              </span>
              <div className="button-row">
                <button type="button" className="btn" disabled={saving} onClick={onClose}>
                  <Icon name="close" />
                  {t("Cancel")}
                </button>
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  <Icon name="save" />
                  {saving ? t("Saving…") : t("Save")}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
