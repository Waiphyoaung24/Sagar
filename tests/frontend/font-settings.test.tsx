import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { fontStack, loadFonts, saveFont, type FontRole } from "../../src/lib/prefs";
import { LanguageProvider } from "../../src/lib/i18n";

let fail = false;
mock.module("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: async () => { if (fail) throw new Error("unavailable"); return ["Arial", "Padauk"]; },
}));
const { AppearanceSettings } = await import("../../src/features/settings/AppearanceSettings");

function Harness() {
  const [fonts, setFonts] = useState(loadFonts);
  return createElement(AppearanceSettings, {
    theme: "light", textSize: 18, fonts,
    onThemeChange: () => {}, onTextSizeChange: () => {},
    onFontChange: (role: FontRole, family: string) => {
      saveFont(role, family);
      setFonts((current) => ({ ...current, [role]: family }));
    },
  });
}

test("system font selectors apply independently, restore, reset and retry", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, navigator: window.navigator, HTMLElement: window.HTMLElement, Node: window.Node, Element: window.Element, IS_REACT_ACT_ENVIRONMENT: true });
  expect(loadFonts()).toEqual({ ui: "", translation: "" });
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  const mount = async () => { await act(async () => { root.render(createElement(LanguageProvider, null, createElement(Harness))); }); };
  await mount();
  for (const [index, role] of (["ui", "translation"] as const).entries()) {
    const select = host.querySelectorAll("select")[index + 2];
    expect(select.disabled).toBe(false);
    expect(select.textContent).toContain("Padauk");
    await act(async () => { select.value = "Padauk"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    expect(loadFonts()[role]).toBe("Padauk");
  }
  expect(host.querySelectorAll(".appearance-font-preview")[1].getAttribute("style")).toContain("Padauk");
  await act(async () => root.unmount()); root = createRoot(host);
  fail = true; await mount();
  expect(host.textContent).toContain("Could not load system fonts");
  expect(host.textContent).not.toContain("Original book font");
  expect(host.querySelectorAll("select")[2].value).toBe("Padauk");
  fail = false;
  await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });
  expect(host.textContent).not.toContain("Could not load system fonts");
  await act(async () => { const select = host.querySelectorAll("select")[2]; select.value = ""; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
  expect(loadFonts()).toEqual({ ui: "", translation: "Padauk" });
  expect(fontStack('A"B\\C', "serif")).toBe('"A\\"B\\\\C", serif');
  await act(async () => root.unmount());
});
