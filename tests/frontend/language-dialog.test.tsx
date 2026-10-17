import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ProjectSummary } from "../../src/types/project";

const project: ProjectSummary = {
  id: "language-test",
  title: "Sample",
  author: null,
  sourceLanguage: "shn",
  targetLanguage: "x-local",
  reviewedBlocks: 0,
  totalBlocks: 0,
  unsupportedBlocks: 0,
  createdAt: "",
  updatedAt: "",
};
const saves: Record<string, unknown>[] = [];
let fail = true;
mock.module("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "get_project") return project;
    if (command === "update_project_metadata") {
      saves.push(args);
      if (fail) {
        fail = false;
        throw { code: "save_failed", message: "Try again." };
      }
      return;
    }
    throw new Error(command);
  },
}));
const { LanguageDialog } = await import("../../src/features/workspace/LanguageDialog");

test("named choices preserve custom tags and unknown sources through save retry", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    Element: window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let closes = 0;
  try {
    await act(async () =>
      root.render(
        createElement(LanguageDialog, {
          project,
          onClose: () => {
            closes++;
          },
          onSaved: () => {},
        }),
      ),
    );
    const source = container.querySelector<HTMLInputElement>("#language-source");
    const target = container.querySelector<HTMLInputElement>("#language-target");
    if (!source || !target) throw new Error("Language choices missing");
    expect(source.value).toContain("ရှမ်း");
    await act(async () => source.focus());
    expect(container.querySelector('[id="language-source-option-shn"]')).not.toBeNull();
    expect(container.querySelector('[id="language-source-option-shn-Mymr-MM"]')).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[id="language-source-option-unknown"]')?.click();
    });
    await act(async () => target.focus());
    for (const code of ["my", "rki", "mnw", "shn", "ksw", "kjp", "pwo", "blk", "kyu", "csh", "kht", "tle", "pll", "pce", "rbb", "aio", "phk", "tvn", "int"]) {
      expect(container.querySelector(`[id="language-target-option-${code}"]`)).toBeNull();
      expect(container.querySelector(`[id="language-target-option-${code}-Mymr-MM"]`)).not.toBeNull();
    }
    // Simulate input through React's handler, as happy-dom is loaded after React DOM.
    const propsKey = Object.keys(target).find((key) => key.startsWith("__reactProps"));
    if (!propsKey) throw new Error("Input handler missing");
    const inputProps = (target as unknown as Record<string, { onChange: (event: { target: { value: string } }) => void }>)[propsKey];
    for (const query of ["Rakhine", "ရခိုင်", "rki-Mymr-MM"]) {
      await act(async () => inputProps.onChange({ target: { value: query } }));
      expect(container.querySelectorAll('[role="option"]').length).toBe(1);
      expect(container.querySelector('[role="option"]')?.textContent).toContain("ရခိုင်");
    }
    await act(async () => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(closes).toBe(0);
    expect(target.getAttribute("aria-expanded")).toBe("false");
    await act(async () => target.click());
    await act(async () => inputProps.onChange({ target: { value: "rki" } }));
    await act(async () => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(container.querySelector('input[aria-label$="Language tag"]')).toBeNull();
    const submit = () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await act(async () => submit());
    expect(saves[0]).toMatchObject({ sourceLanguage: "", targetLanguage: "rki-Mymr-MM" });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Try again.",
    );
    expect(target.value).toContain("rki-Mymr-MM");
    expect(closes).toBe(0);
    await act(async () => submit());
    expect(saves[1]).toEqual(saves[0]);
    expect(closes).toBe(1);
  } finally {
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(trigger);
    container.remove();
    trigger.remove();
  }
});
