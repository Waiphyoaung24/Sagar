import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider, useTranslation } from "../../src/lib/i18n";
import type { AppLanguage } from "../../src/lib/prefs";

const calls: Record<string, unknown>[] = [];
mock.module("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "list_projects") return [];
    if (command === "import_epub") {
      calls.push(args);
      return { project: { id: "new-book" }, warnings: [] };
    }
    throw new Error(command);
  },
}));
mock.module("@tauri-apps/plugin-dialog", () => ({
  open: async () => "/synthetic.epub",
  save: async () => null,
}));
const { LibraryScreen } = await import("../../src/features/library/LibraryScreen");
let chooseLanguage: (language: AppLanguage) => void;
function Harness() {
  chooseLanguage = useTranslation().setLanguage;
  return createElement(LibraryScreen, {
    appearance: {
      theme: "light",
      textSize: 18,
      onThemeChange: () => {},
      onTextSizeChange: () => {},
    },
    onOpenProject: () => {},
  });
}

test("new imports receive the current app language after settings changes", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    Element: window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(LanguageProvider, null, createElement(Harness))),
    );
    for (const language of ["en", "my", "th", "zh", "ja", "ko", "shn", "rki", "mnw"] as const) {
      await act(async () => chooseLanguage(language));
      const button = container.querySelector<HTMLButtonElement>("[data-open-epub]");
      if (!button) throw new Error("Import action missing");
      await act(async () => button.click());
      expect(calls.at(-1)).toEqual({
        sourcePath: "/synthetic.epub",
        allowDuplicate: false,
        appLanguage: language,
      });
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
