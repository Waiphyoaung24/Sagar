import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppearanceSettings } from "../../src/features/settings/AppearanceSettings";
import { LanguageProvider, translate } from "../../src/lib/i18n";
import { loadAppLanguage, saveAppLanguage } from "../../src/lib/prefs";

function setup() {
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
  return window;
}

test("language preferences default safely and retain supported choices", () => {
  const window = setup();
  expect(loadAppLanguage()).toBe("en");
  saveAppLanguage("my");
  expect(loadAppLanguage()).toBe("my");
  window.localStorage.setItem("sagar.language", "unsupported");
  expect(loadAppLanguage()).toBe("en");
  saveAppLanguage("zh");
  expect(loadAppLanguage()).toBe("zh");
  saveAppLanguage("ja");
  expect(loadAppLanguage()).toBe("ja");
  saveAppLanguage("ko");
  expect(loadAppLanguage()).toBe("ko");
  saveAppLanguage("th");
  expect(loadAppLanguage()).toBe("th");
  window.localStorage.setItem("sagar.language", "unsupported");
  expect(loadAppLanguage()).toBe("en");
  saveAppLanguage("en");
  expect(loadAppLanguage()).toBe("en");
});

test("missing translations preserve the original message", () => {
  expect(translate("en", "Settings")).toBe("Settings");
  expect(translate("my", "Settings")).toBe("ဆက်တင်များ");
  expect(translate("my", "Unknown message")).toBe("Unknown message");
  expect(translate("my", "constructor")).toBe("constructor");
  expect(translate("zh", "Appearance")).toBe("外观");
  expect(translate("zh", "Unknown message")).toBe("Unknown message");
  expect(translate("zh", "The next chapter begins here.")).toBe(
    "The next chapter begins here.",
  );
});

test("Appearance changes language immediately, preserves controls and restores it after remount", async () => {
  const window = setup();
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const render = () =>
    root.render(
      createElement(
        LanguageProvider,
        null,
        createElement(AppearanceSettings, {
          theme: "dark",
          textSize: 22,
          onThemeChange: () => {},
          onTextSizeChange: () => {},
        }),
      ),
    );
  try {
    await act(async () => render());
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-describedby="app-language-help"]',
    )!;
    expect(select.value).toBe("en");
    expect(select.options.length).toBe(9);
    select.focus();
    await act(async () => {
      select.value = "my";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("အသွင်အပြင်");
    expect(container.querySelector('.appearance-preview [lang="en"]')?.textContent).toBe(
      "The next chapter begins here.",
    );
    expect(document.documentElement.lang).toBe("my");
    expect(document.activeElement).toBe(select);
    expect(loadAppLanguage()).toBe("my");
    expect(container.querySelector('input[type="range"]')?.getAttribute("value")).toBe(
      "22",
    );
    expect(container.querySelectorAll("select")[1].value).toBe("dark");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => render());
    let restored = container.querySelector<HTMLSelectElement>(
      'select[aria-describedby="app-language-help"]',
    )!;
    expect(restored.value).toBe("my");
    expect(container.textContent).toContain("အသွင်အပြင်");
    await act(async () => {
      restored.value = "en";
      restored.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Appearance");
    expect(document.documentElement.lang).toBe("en");
    await act(async () => {
      restored.value = "zh";
      restored.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("外观");
    expect(loadAppLanguage()).toBe("zh");
    expect(document.documentElement.lang).toBe("zh-Hans");
    for (const language of ["shn", "rki", "mnw"] as const) {
      restored.focus();
      await act(async () => {
        restored.value = language;
        restored.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
      expect(document.documentElement.lang).toBe(language);
      expect(loadAppLanguage()).toBe(language);
      expect(container.textContent).toContain(translate(language, "Appearance"));
      expect(document.activeElement).toBe(restored);
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => render());
      expect(container.querySelector<HTMLSelectElement>('select[aria-describedby="app-language-help"]')?.value).toBe(language);
      // The remount creates a new select for the next language change.
      restored = container.querySelector<HTMLSelectElement>('select[aria-describedby="app-language-help"]')!;
    }

    expect(container.querySelector('.appearance-preview [lang="en"]')?.textContent).toBe(
      "The next chapter begins here.",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

 test("Shan, Arakanese and Mon preferences and core catalogs are distinct", () => {
  setup();
  for (const language of ["shn", "rki", "mnw"] as const) {
    saveAppLanguage(language);
    expect(loadAppLanguage()).toBe(language);
    expect(translate(language, "Language")).not.toBe("Language");
    expect(translate(language, "Unknown message")).toBe("Unknown message");
  }
});
