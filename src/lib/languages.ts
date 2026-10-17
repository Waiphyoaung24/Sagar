import languageNames from "./languageNames.json";

/**
 * Readable names for BCP-47-ish language tags stored on a project.
 * Lookup is case-insensitive on the full tag, then on the primary subtag;
 * unknown tags fall back to the raw code so no language is ever hidden.
 */

const NAMES: Record<string, string> = languageNames;

/** Display name for a tag, or null when there is no tag to name. */
export function languageName(tag: string | null | undefined): string | null {
  if (!tag || tag.trim() === "") {
    return null;
  }
  const lowered = tag.trim().toLocaleLowerCase();
  return NAMES[lowered] ?? NAMES[lowered.split("-")[0]] ?? tag.trim();
}

/** One side of the direction label, e.g. `English (en)` or `Unknown`. */
function side(tag: string | null | undefined): string {
  if (!tag || tag.trim() === "") {
    return "Unknown";
  }
  const name = languageName(tag);
  return name && name !== tag.trim() ? `${name} (${tag.trim()})` : tag.trim();
}

/** Full translation direction, e.g. `English (en) → Myanmar (my)`. */
export function formatDirection(
  source: string | null | undefined,
  target: string,
): string {
  return `${side(source)} → ${side(target)}`;
}

// One explicit Myanmar-script locale per language in the picker.
const MYANMAR_SCRIPT_LANGUAGES = [
  "my",
  "rki",
  "mnw",
  "shn",
  "ksw",
  "kjp",
  "pwo",
  "blk",
  "kyu",
  "csh",
  "kht",
  "tle",
  "pll",
  "pce",
  "rbb",
  "aio",
  "phk",
  "tvn",
  "int",
];

/** Sorted suggestions for the language fields (`value` + readable label). */
export function languageSuggestions(): { value: string; label: string }[] {
  return Object.entries(NAMES)
    .map(([code, name]) => {
      const value = MYANMAR_SCRIPT_LANGUAGES.includes(code) ? `${code}-Mymr-MM` : code;
      return { value, label: `${name} (${value})` };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
