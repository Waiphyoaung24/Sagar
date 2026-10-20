import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiTranslationEvent } from "../../src/types/ai";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener[]>();
const commands: { command: string; args?: Record<string, unknown> }[] = [];

mock.module("@tauri-apps/api/event", () => ({
  listen: async (name: string, callback: Listener) => {
    const existing = listeners.get(name) ?? [];
    existing.push(callback);
    listeners.set(name, existing);
    return () => {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((entry) => entry !== callback),
      );
    };
  },
}));



mock.module("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    commands.push({ command, args });
    if (command === "list_ai_providers") {
      return {
        cli: [{ id: "codex", label: "Codex", binaries: ["codex"], available: true }],
        custom: [],
      };
    }
    if (command === "get_translation_selection") {
      return { agent: "codex", model: "chosen-model", reasoningEffort: null };
    }
    if (command === "get_project") {
      return { id: "p", sourceLanguage: "en", targetLanguage: "my" };
    }
    if (command === "get_book_settings") return { instructions: "" };
    if (command === "start_ai_translation") return { jobId: "job-1" };
    if (command === "cancel_ai_translation") return;
    if (command === "get_ai_selection_state") {
      return {
        units: [
          {
            id: "text",
            order: 0,
            kind: "paragraph",
            text: "Original",
            previewHtml: "<p>Original</p>",
            unavailable: null,
            added: false,
            hasProposal: false,
          },
        ],
        runs: [],
      };
    }
    if (command === "prepare_ai_selection_run") return "run-1";
    if (command === "control_ai_selection_run") {
      // A fast local run can report before the command returns its job id.
      for (const listener of listeners.get("ai-selection-event") ?? []) {
        listener({
          payload: {
            runId: "run-1",
            jobId: "job-2",
            chapterId: "c",
            itemId: "proposal-text",
            partId: "part",
            kind: selectionRunState,
            message: selectionRunState === "done" ? "Run finished" : "Progress saved",
            partialText: null,
          },
        });
      }
      return "job-2";
    }
    if (command === "validate_chapter_html") return (args?.html as string) ?? "";
    if (command === "save_chapter_document") {
      return { revision: 2, status: "draft" };
    }
    throw new Error(`Unexpected command: ${command}`);
  },
}));

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  DOMParser: window.DOMParser,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { AiGenerateDialog } = await import("../../src/features/translator/AiGenerateDialog");
const { AiBackgroundBar } = await import("../../src/features/translator/AiBackgroundBar");
const { AiJobsProvider } = await import("../../src/features/translator/aiJobs");
const { useChapterEditor } = await import("../../src/features/translator/useChapterEditor");

const content = {
  chapterId: "c",
  title: "Chapter One",
  document: { html: "", status: "not_started", revision: 1 },
};

let openedChapter: string | null = null;
let reopen: (() => void) | null = null;
let selectionRunState: "progress" | "done" = "progress";

function Harness() {
  const [open, setOpen] = useState(true);
  reopen = () => setOpen(true);
  const editor = useChapterEditor(content as never);
  return createElement(
    AiJobsProvider,
    null,
    open
      ? createElement(AiGenerateDialog, {
          projectId: "p",
          chapterId: "c",
          chapterTitle: "Chapter One",
          editor,
          onClose: () => setOpen(false),
        })
      : null,
    createElement(AiBackgroundBar, {
      onOpenChapter: (chapterId: string) => {
        openedChapter = chapterId;
      },
    }),
  );
}

async function emit(name: string, payload: unknown) {
  await act(async () => {
    for (const listener of listeners.get(name) ?? []) listener({ payload });
  });
}

function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}

async function click(container: HTMLElement, label: string) {
  await act(async () => button(container, label).click());
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  return { container, root };
}

function reset() {
  commands.length = 0;
  listeners.clear();
  openedChapter = null;
  reopen = null;
  selectionRunState = "progress";
}

test("a whole-chapter run continues in the background and can be cancelled from the status bar", async () => {
  reset();
  const { container, root } = await mount();
  try {
    const consent = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => consent?.click());
    await click(container, "Generate");
    expect(commands.some((entry) => entry.command === "start_ai_translation")).toBe(true);
    expect(container.textContent).toContain("Translating…");

    // Moving to the background keeps the run alive: nothing is cancelled.
    await click(container, "Continue in background");
    expect(commands.some((entry) => entry.command === "cancel_ai_translation")).toBe(false);
    expect(container.querySelector(".ai-background")).not.toBeNull();
    expect(container.textContent).toContain("Chapter One");
    expect(container.textContent).toContain("Whole chapter");
    // The elapsed time is shown as a readable duration, not a bare number.
    expect(container.querySelector(".ai-background")?.textContent).toContain("· 0s");

    // The status bar offers a way to stop the run.
    const cancel = container.querySelector<HTMLButtonElement>(
      '.ai-background button[aria-label="Cancel translation"]',
    );
    expect(cancel).not.toBeNull();
    await act(async () => cancel?.click());
    expect(
      commands.some(
        (entry) =>
          entry.command === "cancel_ai_translation" &&
          entry.args?.jobId === "job-1",
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("a background result is kept for review and the chapter can be reopened from the status bar", async () => {
  reset();
  const { container, root } = await mount();
  try {
    const consent = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => consent?.click());
    await click(container, "Generate");
    await click(container, "Continue in background");

    const done: AiTranslationEvent = {
      jobId: "job-1",
      chapterId: "c",
      kind: "done",
      proposalHtml: "<p>မြန်မာ</p>",
      partialText: null,
      message: "Proposal ready.",
    };
    await emit("ai-translation-event", done);
    expect(container.textContent).toContain("Ready to review");

    const open = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (entry) => entry.textContent?.trim() === "Open",
    );
    expect(open).not.toBeNull();
    await act(async () => open?.click());
    expect(openedChapter).toBe("c");

    // Reopening the dialog shows the finished proposal instead of a new run.
    await act(async () => reopen?.());
    expect(container.querySelector(".ai-proposal")?.textContent).toContain("မြန်မာ");
    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button")].some(
        (entry) => entry.textContent?.trim() === "Insert into draft",
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("a selected-paragraph run also keeps working after the dialog closes", async () => {
  reset();
  const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs");
    await click(container, "Select all available");
    const consent = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (entry) => entry.parentElement?.textContent?.includes("I understand selected text"),
    );
    await act(async () => consent?.click());
    await click(container, "Translate 1 items");
    expect(
      commands.some((entry) => entry.command === "control_ai_selection_run"),
    ).toBe(true);

    await click(container, "Continue in background");
    expect(
      commands.some(
        (entry) =>
          entry.command === "control_ai_selection_run" && entry.args?.action === "cancel",
      ),
    ).toBe(false);
    expect(container.querySelector(".ai-background")?.textContent).toContain(
      "selected items",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("a selection run that finished before its job id was known is still reported", async () => {
  reset();
  selectionRunState = "done";
  const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs");
    await click(container, "Select all available");
    const consent = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (entry) => entry.parentElement?.textContent?.includes("I understand selected text"),
    );
    await act(async () => consent?.click());
    await click(container, "Translate 1 items");
    // Closing the dialog hands the finished run to the status bar.
    const close = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    );
    await act(async () => close?.click());
    expect(container.querySelector(".ai-background")?.textContent).toContain(
      "Ready to review",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
