import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { SelectionEvent, SelectionRun, SelectionState } from "../../src/types/aiSelection";

let receive: (event: { payload: SelectionEvent }) => void = () => {};
let state: SelectionState;
let commands: { command: string; args?: Record<string, unknown> }[] = [];
let preparedCount = 0;
let generationMode: "done" | "running" = "done";
let selectionLoads = 0;
let appendCalls = 0;
let appendFailures = 0;
let rejectOrderOnce = false;
let revision = 7;
let deferStart = false;
let releaseStart: (() => void) | null = null;
let deferAppend = false;
let releaseAppend: (() => void) | null = null;
let savedDraft = "<p>Manual writing.</p>";

mock.module("@tauri-apps/api/event", () => ({ listen: async (name: string, callback: typeof receive) => {
  if (name === "ai-selection-event") receive = callback;
  return () => {};
} }));
mock.module("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${path}`,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    commands.push({ command, args });
    if (command === "list_ai_providers") return { cli: [], custom: [] };
    if (command === "get_translation_selection") return { agent: "custom:test", model: "chosen-model", reasoningEffort: "low" };
    if (command === "get_project") return { id: "p", sourceLanguage: "en", targetLanguage: "my" };
    if (command === "get_book_settings") return { instructions: "Keep names consistent." };
    if (command === "delete_ai_selection_run") { state.runs = state.runs.filter((run) => run.id !== args?.runId); state.units.forEach((unit) => { unit.hasProposal = false; }); return; }
    if (command === "get_ai_selection_state") { selectionLoads++; return structuredClone(state); }
    if (command === "prepare_ai_selection_run") {
      const input = args?.input as { unitIds: string[] };
      const created = makeRun(input.unitIds);
      created.id = ++preparedCount === 1 ? "run" : `run${preparedCount}`;
      if (preparedCount > 1) created.items.forEach((item) => { item.id = `${created.id}:${item.id}`; });
      state.runs.unshift(created);
      return created.id;
    }
    if (command === "control_ai_selection_run") {
      if (args?.action === "cancel") return "";
      const run = state.runs.find((value) => value.id === args?.runId)!;
      run.state = generationMode;
      if (generationMode === "done") run.items.forEach((i) => {
        i.state = "ready"; i.partsDone = 1;
        for (const saved of state.runs) if (saved.id !== run.id) saved.items.forEach((older) => {
          if (older.unitId === i.unitId && older.state === "ready") { older.state="superseded";older.previewHtml=null;older.partsDone=0;older.partsTotal=0; }
        });
      });
      // Emit before invoke resolves: the panel must buffer early events.
      receive({ payload: event(generationMode === "done" ? "done" : "progress", {runId:run.id}) });
      if (deferStart) await new Promise<void>((resolve) => { releaseStart = resolve; });
      return "job";
    }
    if (command === "append_ai_selection_results") {
      appendCalls++;
      if (rejectOrderOnce) { rejectOrderOnce = false; throw {code: "append_out_of_order", message: "These results will be added after later source content. Confirm to append them at the end."}; }
      if (appendFailures-- > 0) throw { code: "save_failed", message: "Temporary save failure" };
      if (deferAppend) await new Promise<void>((resolve) => { releaseAppend = resolve; });
      const ids = new Set((args?.input as {proposalIds:string[]}).proposalIds);
      const units = new Set(state.runs.flatMap((run) => run.items.filter((item) => ids.has(item.id)).map((item) => item.unitId)));
      state.runs.forEach((run) => run.items.forEach((item) => { if (units.has(item.unitId) && item.state === 'ready') { item.state = 'added'; item.previewHtml = null; item.partsDone=0; item.partsTotal=0; } }));
      state.units.forEach((unit) => { if (units.has(unit.id)) {unit.added=true;unit.hasProposal=false;} });
      return { chapterId: "c", revision: ++revision, status: "draft", html: savedDraft + '<p>မြန်မာ</p><img src="images/photo.png" alt="River"/>' };
    }
    if (command === "save_chapter_document") { savedDraft = args?.html as string; return { revision: ++revision, status: "draft" }; }
    throw new Error(`Unexpected command: ${command}`);
  },
}));

const window = new Window();
Object.assign(globalThis, {
  window, document: window.document, navigator: window.navigator, DOMParser: window.DOMParser,
  Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window), IS_REACT_ACT_ENVIRONMENT: true,
});
const { AiGenerateDialog } = await import("../../src/features/translator/AiGenerateDialog");
const { useChapterEditor } = await import("../../src/features/translator/useChapterEditor");
const { bookImageUrl } = await import("../../src/features/translator/bookImages");
const content = { chapterId: "c", document: { html: "<p>Manual writing.</p>", status: "draft", revision: 7 } };
let editorApi: ReturnType<typeof useChapterEditor> | null = null;
let closed = false;
function Harness() {
  const editor = useChapterEditor(content as never);
  editorApi = editor;
  return createElement(AiGenerateDialog, { projectId: "p", chapterId: "c", editor, onClose: () => { closed = true; } });
}
function makeRun(ids = ["text", "image"]): SelectionRun {
  return { id: "run", chapterId: "c", state: "paused", message: null, budget: 4096,
    config: { agent: "custom:test", model: "chosen-model", reasoningEffort: "low", sourceLanguage: "en", targetLanguage: "my", bookInstructions: "Book guidance", currentInstructions: "Saved guidance", fingerprint: "snapshot", projectId: "p", resourceHref: "chapter.xhtml" },
    items: ids.map((id, index) => ({ id: `proposal-${id}`, unitId: id, order: state.units.find((unit) => unit.id === id)?.order ?? index, state: "pending", partsDone: 0, partsTotal: 1, failedOutput: null,
      sourcePreviewHtml: id === "image" ? '<img src="epubres://p/images/photo.png" alt="River"/>' : "<p>Original</p>",
      previewHtml: id === "image" ? '<img src="epubres://p/images/photo.png" alt="River"/>' : "<p>မြန်မာ</p>" })) };
}
function event(kind: SelectionEvent["kind"], overrides: Partial<SelectionEvent> = {}): SelectionEvent {
  return { runId: "run", chapterId: "c", jobId: "job", itemId: "proposal-text", partId: "part", kind, message: "Progress saved", partialText: null, ...overrides };
}
function reset() {
  commands = []; preparedCount = 0; appendCalls = 0; appendFailures = 0; rejectOrderOnce = false; selectionLoads = 0; closed = false; revision = 7; generationMode = "done";
  deferStart = false; releaseStart = null; deferAppend = false; releaseAppend = null; savedDraft = "<p>Manual writing.</p>";
  state = { units: [
    { id: "text", order: 0, kind: "paragraph", text: "Original", previewHtml: "<p>Original</p>", unavailable: null, added: false, hasProposal: false },
    { id: "image", order: 1, kind: "image", text: "", previewHtml: '<img src="epubres://p/images/photo.png" alt="River"/>', unavailable: null, added: false, hasProposal: false },
    { id: "unsafe", order: 2, kind: "image", text: "", previewHtml: "", unavailable: "Missing image resource", added: false, hasProposal: false },
  ], runs: [] };
}
function button(container: HTMLElement, label: string) {
  const value = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
  if (!value) throw new Error(`Button missing: ${label}`);
  return value;
}
async function click(container: HTMLElement, label: string) { await act(async () => button(container, label).click()); }
async function mount() {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  return { container, root };
}

test("Whole chapter stays default; selected text and images preview before an explicit saved append", async () => {
  reset(); const { container, root } = await mount();
  try {
    expect(button(container, "Whole chapter").getAttribute("aria-pressed")).toBe("true");
    expect(selectionLoads).toBe(0);
    await click(container, "Selected paragraphs");
    expect(container.textContent).toContain("0 selected");
    expect(container.querySelector('img[alt="River"]')?.getAttribute("src")).toBe("http://epubres.localhost/p/images/photo.png");
    await click(container, "Select all available");
    expect(container.textContent).toContain("2 selected");
    expect(button(container, "Translate 2 items").disabled).toBe(true);
    const consent = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((e) => e.parentElement?.textContent?.includes("I understand selected text"));
    await act(async () => consent?.click());
    await click(container, "Translate 2 items");
    expect(appendCalls).toBe(0);
    expect(editorApi?.draft?.html).toContain("Manual writing.");
    expect(editorApi?.draft?.html).not.toContain("မြန်မာ");
    expect(container.textContent).toContain("Review translations");
    await click(container, "Select all results");
    await click(container, "Add 2 results to draft");
    expect(appendCalls).toBe(1);
    expect(editorApi?.draft?.html).toContain("Manual writing.");
    expect(editorApi?.draft?.html).toContain("မြန်မာ");
    expect(editorApi?.draft?.html).toContain('src="images/photo.png"');
    expect(editorApi?.draft?.dirty).toBe(false);
    expect(editorApi?.draft?.status).toBe("draft");
    expect(closed).toBe(false);
    const prepared = commands.find((c) => c.command === "prepare_ai_selection_run")?.args?.input as { unitIds: string[] };
    expect(prepared.unitIds.sort()).toEqual(["image", "text"]);
    const appended = commands.find((c) => c.command === "append_ai_selection_results")?.args?.input as { expectedRevision: number };
    expect(appended.expectedRevision).toBe(7);
    await click(container, "Whole chapter");
    expect(button(container, "Whole chapter").getAttribute("aria-pressed")).toBe("true");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("active selections lock the mode and ignore stale events; close keeps the owned run alive", async () => {
  reset(); generationMode = "running"; const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs");
    await click(container, "Select all available");
    const consent = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((e) => e.parentElement?.textContent?.includes("I understand selected text"));
    await act(async () => consent?.click()); await click(container, "Translate 2 items");
    expect(button(container, "Whole chapter").disabled).toBe(true);
    await act(async () => receive({ payload: event("stream", { jobId: "old-job", partialText: "STALE" }) }));
    expect(container.textContent).not.toContain("STALE");
    await act(async () => receive({ payload: event("stream", { partialText: "<p>မြန်မာ</p>" }) }));
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Selected translation live output"]')?.value).toContain("မြန်မာ");
  } finally { await act(async () => root.unmount()); container.remove(); }
  // Closing the dialog moves the run to the background instead of cancelling it.
  expect(commands.some((c) => c.command === "control_ai_selection_run" && c.args?.action === "cancel")).toBe(false);
});

test("relative images use local native URLs without allowing external fetches", () => {
  expect(bookImageUrl("../images/river.png", "epubres://p/OEBPS/chapter.xhtml")).toBe("http://epubres.localhost/p/images/river.png");
  for (const value of ["https://example.com/a.png", "//example.com/a.png", "javascript:bad()", "\\remote\\a.png", "data:image/svg+xml,<svg/>"]) expect(bookImageUrl(value, "epubres://p/ch.xhtml")).toBeNull();
});

test("closing while a start command is pending keeps the run in the background", async () => {
  reset(); generationMode = "running"; deferStart = true;
  const { container, root } = await mount();
  await click(container, "Selected paragraphs"); await click(container, "Select all available");
  const consent = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((e) => e.parentElement?.textContent?.includes("I understand selected text"));
  await act(async () => consent?.click()); await click(container, "Translate 2 items");
  expect(releaseStart).not.toBeNull();
  await act(async () => root.unmount());
  await act(async () => { releaseStart?.(); });
  // The run started before the dialog closed keeps working; it is not cancelled.
  expect(commands.filter((c) => c.command === "control_ai_selection_run" && c.args?.action === "cancel").length).toBe(0);
  container.remove();
});

test("append flushes pending manual edits, reports saving, and holds navigation until commit", async () => {
  reset(); state.runs = [makeRun()]; state.runs[0].state = "done"; state.runs[0].items.forEach((i) => {i.state = "ready";});
  deferAppend = true;
  const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs"); await click(container, "Select all results");
    await act(async () => editorApi?.setHtml("<p>New manual writing.</p>"));
    await click(container, "Add 2 results to draft");
    expect(releaseAppend).not.toBeNull();
    expect(editorApi?.indicator).toBe("saving");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.disabled).toBe(true);
    let flushed = false;
    const navigation = editorApi?.flushAll().then(() => { flushed = true; });
    await act(async () => { await Promise.resolve(); });
    expect(flushed).toBe(false);
    await act(async () => { releaseAppend?.(); await navigation; });
    expect(flushed).toBe(true);
    expect(editorApi?.draft?.html).toContain("New manual writing.");
    expect(editorApi?.draft?.html).toContain("မြန်မာ");
    const appended = commands.find((c) => c.command === "append_ai_selection_results")?.args?.input as { expectedRevision: number };
    expect(appended.expectedRevision).toBe(8);
    expect(editorApi?.draft?.dirty).toBe(false);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("selection expansion stays separate from selection and review pairs actual languages", async () => {
  reset(); const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs");
    const source = container.querySelector('[aria-label="Source selections"]');
    const input = source?.querySelector<HTMLInputElement>('input');
    await act(async () => (source?.querySelector('summary') as HTMLElement)?.click());
    expect(input?.checked).toBe(false);
    await click(container, "Select all available");
    const consent = [...container.querySelectorAll<HTMLInputElement>('input')].find((e) => e.parentElement?.textContent?.includes("I understand selected text"));
    await act(async () => consent?.click()); await click(container, "Translate 2 items");
    const pair = container.querySelector('.ai-review-pair');
    expect(pair?.textContent).toContain("English"); expect(pair?.textContent).toContain("Myanmar");
    expect(pair?.textContent).toContain("Original"); expect(pair?.textContent).toContain("မြန်မာ");
    await click(container, "Select more");
    expect(container.textContent).toContain("2 selected");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("completed history with previously added proposals offers no accidental append", async () => {
  reset(); state.units.forEach((unit) => { unit.added = true; });
  const run = makeRun(); run.state = "done"; run.items.forEach((item) => { item.state = "ready"; }); state.runs = [run];
  const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs");
    expect(container.textContent).toContain("insertion history, not a check of your current");
    expect(button(container, "Add 0 results to draft").disabled).toBe(true);
    expect(button(container, "Select all results").disabled).toBe(false);
    expect(appendCalls).toBe(0);
    await click(container, "Select more");
    expect(button(container, "Translate 0 items").disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("image-only selection previews without provider consent", async () => {
  reset(); const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs");
    const inputs = container.querySelectorAll<HTMLInputElement>('[aria-label="Source selections"] input');
    await act(async () => inputs[1]?.click());
    expect(button(container, "Preview selected images").disabled).toBe(false);
    await click(container, "Preview selected images");
    expect(container.textContent).toContain("Review translations");
    const start = commands.find((value) => value.command === "control_ai_selection_run");
    expect(start?.args?.consent).toBe(false);
    expect(appendCalls).toBe(0);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("failed append retains checked proposals and retries the same receipt request", async () => {
  reset(); appendFailures = 1;
  const run = makeRun(); run.state = "done"; run.items.forEach((item) => { item.state = "ready"; }); state.runs = [run];
  const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs"); await click(container, "Select all results");
    await click(container, "Add 2 results to draft");
    expect(container.textContent).toContain("Temporary save failure");
    expect(button(container, "Add 2 results to draft").disabled).toBe(false);
    await click(container, "Add 2 results to draft");
    const attempts = commands.filter((value) => value.command === "append_ai_selection_results");
    expect((attempts[0].args?.input as {requestId:string}).requestId).toBe((attempts[1].args?.input as {requestId:string}).requestId);
    expect(container.textContent).toContain("2 results added to your draft and saved.");
    expect(button(container, "Add 0 results to draft").disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("saved failures keep consent-gated recovery actions and original configuration", async () => {
  for (const [label, action] of [["Retry failed batch", "retry"], ["Retry with smaller batches", "smaller"], ["Skip and continue", "skip"]]) {
    reset(); const run = makeRun(); run.state = "failed"; run.items[0].state = "failed"; run.items[0].partsDone = 1; run.items[0].partsTotal = 3; state.runs = [run];
    const { container, root } = await mount();
    try {
      await click(container, "Selected paragraphs");
      expect(container.textContent).toContain("1/3 parts saved");
      expect(button(container, label).disabled).toBe(true);
      const consent = [...container.querySelectorAll<HTMLInputElement>('input')].find((e) => e.parentElement?.textContent?.includes("I understand selected text"));
      await act(async () => consent?.click()); await click(container, label);
      expect(commands.some((value) => value.command === "control_ai_selection_run" && value.args?.action === action && value.args?.consent === true)).toBe(true);
      expect(commands.some((value) => value.command === "prepare_ai_selection_run")).toBe(false);
    } finally { await act(async () => root.unmount()); container.remove(); }
  }
});

test("source selection survives pagination and excludes unavailable items", async () => {
  reset(); const unit = state.units[0];
  state.units = Array.from({length:51}, (_,index) => ({...unit,id:`u${index}`,order:index,unavailable:index===50?"Unsupported content":null}));
  const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs");
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Source selections"] input')?.click());
    await click(container, "Next items");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Source selections"] input')?.disabled).toBe(true);
    expect(container.textContent).toContain("1 selected");
    await click(container, "Previous items");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Source selections"] input')?.checked).toBe(true);
    await click(container, "Select all available"); expect(container.textContent).toContain("50 selected");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("previously added results can be restored after HTML edits without resetting a book", async () => {
  reset(); state.units.forEach((unit) => { unit.added = true; });
  const run = makeRun(); run.state = "done"; run.items.forEach((item) => { item.state = "ready"; }); state.runs = [run];
  const { container, root } = await mount();
  try {
    await click(container, "Selected paragraphs");
    const result = () => container.querySelector<HTMLInputElement>('[aria-label="Paired translation results"] input');
    expect(result()?.disabled).toBe(false);
    await act(async () => editorApi?.setHtml("<p>Other manually edited content.</p>"));
    await act(async () => result()?.click());
    expect(button(container, "Add 1 results to draft").disabled).toBe(true);
    const confirmation = () => [...container.querySelectorAll<HTMLInputElement>('input')].find((input) => input.parentElement?.textContent?.includes("Add these results again."));
    await act(async () => confirmation()?.click());
    expect(button(container, "Add 1 results to draft").disabled).toBe(false);
    await click(container, "Clear selection");
    expect(result()?.checked).toBe(false);
    expect(container.querySelectorAll('.ai-review-row').length).toBe(2);
    await click(container, "Select all results");
    expect(confirmation()?.checked).toBe(false);
    await act(async () => confirmation()?.click());
    await click(container, "Add 2 results to draft");
    const appended = commands.find((call) => call.command === "append_ai_selection_results")?.args?.input as {allowAgain:boolean};
    expect(appended.allowAgain).toBe(true);
    expect(editorApi?.draft?.html).toContain("Other manually edited content.");
    expect(editorApi?.draft?.html).toContain("မြန်မာ");
    expect(commands.some((call) => call.command === "delete_ai_selection_run")).toBe(false);
    await click(container, "Select more");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Source selections"] input')?.disabled).toBe(false);
    await click(container, "Select all available");
    expect(container.textContent).toContain("2 selected");
  } finally { await act(async () => root.unmount()); container.remove(); }
});


test("delete saved proposals requires confirmation and leaves the authored draft intact", async () => {
  reset(); const run = makeRun(); run.state = "done"; run.items.forEach((item) => {item.state = "ready";}); state.runs = [run];
  const {container, root} = await mount();
  try {
    await click(container, "Selected paragraphs");
    await click(container, "Delete this saved run…");
    expect(commands.some((value) => value.command === "delete_ai_selection_run")).toBe(false);
    await click(container, "Cancel deletion");
    expect(state.runs.length).toBe(1);
    await click(container, "Delete this saved run…"); await click(container, "Delete saved proposals");
    expect(state.runs.length).toBe(0);
    expect(container.textContent).toContain("Saved proposals deleted. Your chapter draft is unchanged.");
    expect(container.textContent).toContain("Select source items");
    expect(editorApi?.draft?.html).toBe("<p>Manual writing.</p>");
    expect(appendCalls).toBe(0);
  } finally {await act(async () => root.unmount()); container.remove();}
});


test("translate first three then next three accumulates all six without losing checked proposals", async () => {
  reset();
  state.units = Array.from({length:6}, (_,index) => ({...state.units[0], id:`u${index+1}`,order:index,text:`Original ${index+1}`}));
  const {container,root} = await mount();
  try {
    await click(container, "Selected paragraphs");
    await act(async () => {const inputs = container.querySelectorAll<HTMLInputElement>('[aria-label="Source selections"] input'); for(let i=0;i<3;i++) inputs[i].click();});
    const consent = [...container.querySelectorAll<HTMLInputElement>('input')].find((input) => input.parentElement?.textContent?.includes("I understand selected text"));
    await act(async () => consent?.click()); await click(container,"Translate 3 items");
    expect(container.querySelectorAll('.ai-review-row').length).toBe(3);
    await click(container,"Select all results");
    await click(container,"Select more"); await click(container,"Clear selection");
    await act(async () => {const inputs = container.querySelectorAll<HTMLInputElement>('[aria-label="Source selections"] input'); for(let i=3;i<6;i++) inputs[i].click();});
    await click(container,"Translate 3 items");
    expect(container.querySelectorAll('.ai-review-row').length).toBe(6);
    expect(button(container,"Add 3 results to draft").disabled).toBe(false);
    const labels = [...container.querySelectorAll('.ai-review-row strong')].map((node)=>node.textContent);
    expect(labels[0]).toContain('Include result 1'); expect(labels[5]).toContain('Include result 6');
    await click(container,"Select all results"); await click(container,"Add 6 results to draft");
    const append = commands.find((call)=>call.command==='append_ai_selection_results')?.args?.input as {proposalIds:string[]};
    expect(append.proposalIds.length).toBe(6);
    expect(append.proposalIds).toContain('proposal-u1'); expect(append.proposalIds).toContain('run2:proposal-u6');
    expect(commands.filter((call)=>call.command==='prepare_ai_selection_run').length).toBe(2);
    expect(state.runs.length).toBe(2);
  } finally {await act(async()=>root.unmount());container.remove();}
});

test("reopened review includes earlier successful batches when newest batch failed", async () => {
  reset();
  const older=makeRun(['text']); older.id='older'; older.state='done'; older.items[0].state='ready';
  const newer=makeRun(['image']); newer.id='newer'; newer.state='failed'; newer.items[0].state='failed';
  state.runs=[newer,older];
  const {container,root}=await mount();
  try {
    await click(container,'Selected paragraphs'); await click(container,'3. Review & Add');
    expect(container.querySelectorAll('.ai-review-row').length).toBe(1);
    expect(container.querySelector('[aria-label="Translated item 1"]')?.textContent).toContain('မြန်မာ');
    expect(commands.some((call)=>call.command==='prepare_ai_selection_run')).toBe(false);
  } finally {await act(async()=>root.unmount());container.remove();}
});

test("chapter review shows only the latest successful proposal and its language", async () => {
  reset();
  const older=makeRun(['text']);older.id='older';older.state='done';older.items[0].state='superseded';older.items[0].previewHtml=null;
  const newer=makeRun(['text']);newer.id='newer';newer.state='done';newer.config.targetLanguage='fr';newer.items[0].id='new-proposal';newer.items[0].state='ready';newer.items[0].previewHtml='<p>Nouvelle traduction</p>';
  state.runs=[newer,older];
  const {container,root}=await mount();
  try{
    await click(container,'Selected paragraphs');
    expect(container.querySelectorAll('.ai-review-row').length).toBe(1);
    expect(container.querySelector('.ai-review-pair')?.textContent).toContain('French');
    expect(container.querySelector('[aria-label="Translation version for item 1"]')).toBeNull();
    await click(container,'Select all results');await click(container,'Add 1 results to draft');
    const appended=commands.find((call)=>call.command==='append_ai_selection_results')?.args?.input as {proposalIds:string[]};
    expect(appended.proposalIds).toEqual(['new-proposal']);
  }finally{await act(async()=>root.unmount());container.remove();}
});


test("append order confirmation stays in the visible footer and prevents rejected first attempt", async () => {
  reset(); state.units[1].added = true;
  const run=makeRun(['text']);run.state='done';run.items[0].state='ready';state.runs=[run];
  const {container,root}=await mount();
  try {
    await click(container,'Selected paragraphs'); await click(container,'Select all results');
    expect(button(container,'Add 1 results to draft').disabled).toBe(true);
    const placement=container.querySelector<HTMLInputElement>('footer input[type="checkbox"]')!;
    expect(placement.parentElement?.textContent).toContain('Add earlier source items');
    expect(appendCalls).toBe(0);
    await act(async()=>placement.click());
    await click(container,'Add 1 results to draft');
    const input=commands.find((value)=>value.command==='append_ai_selection_results')?.args?.input as {confirmOutOfOrder:boolean};
    expect(input.confirmOutOfOrder).toBe(true);
    expect(container.querySelector('footer')?.textContent).toContain('1 results added to your draft and saved.');
    expect(appendCalls).toBe(1);
  }finally{await act(async()=>root.unmount());container.remove();}
});

test("server order warning exposes footer confirmation and same-request append recovery", async () => {
  reset();rejectOrderOnce=true;
  const run=makeRun(['text']);run.state='done';run.items[0].state='ready';state.runs=[run];
  const {container,root}=await mount();
  try {
    await click(container,'Selected paragraphs');await click(container,'Select all results');await click(container,'Add 1 results to draft');
    expect(container.querySelector('footer')?.textContent).toContain('Confirm placement below');
    expect(button(container,'Add 1 results to draft').disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('.ai-review-row input')?.checked).toBe(true);
    await act(async()=>container.querySelector<HTMLInputElement>('footer input')?.click());
    await click(container,'Add 1 results to draft');
    const attempts=commands.filter((value)=>value.command==='append_ai_selection_results');
    expect(attempts.length).toBe(2);
    const first=attempts[0].args?.input as {requestId:string};
    const last=attempts[1].args?.input as {requestId:string;confirmOutOfOrder:boolean};
    expect(first.requestId).toBe(last.requestId);expect(last.confirmOutOfOrder).toBe(true);
    expect(container.querySelector('footer')?.textContent).toContain('added to your draft and saved');
  }finally{await act(async()=>root.unmount());container.remove();}
});

test("save error retry retries append rather than only refreshing saved state", async () => {
  reset();appendFailures=1;
  const run=makeRun(['text']);run.state='done';run.items[0].state='ready';state.runs=[run];
  const {container,root}=await mount();
  try{
    await click(container,'Selected paragraphs');await click(container,'Select all results');await click(container,'Add 1 results to draft');
    expect(container.querySelector('footer')?.textContent).toContain('Temporary save failure');
    await click(container,'Retry adding results');
    expect(appendCalls).toBe(2);
    expect(container.querySelector('footer')?.textContent).toContain('added to your draft and saved');
  }finally{await act(async()=>root.unmount());container.remove();}
});

test("cleared draft asks only for re-add permission and does not imply current content order", async()=>{
  reset();state.units.forEach((unit)=>{unit.added=true;});
  const run=makeRun();run.state='done';run.items.forEach((item)=>{item.state='ready';});state.runs=[run];
  const {container,root}=await mount();
  try{
    await act(async()=>editorApi?.setHtml(''));
    await click(container,'Selected paragraphs');await click(container,'Select all results');
    const footer=container.querySelector('footer')!;
    expect(footer.textContent).not.toContain('Add earlier source items');
    await act(async()=>footer.querySelector<HTMLInputElement>('input')?.click());
    await click(container,'Add 2 results to draft');
    const input=commands.find((call)=>call.command==='append_ai_selection_results')?.args?.input as {allowAgain:boolean;confirmOutOfOrder:boolean};
    expect(input.allowAgain).toBe(true);expect(input.confirmOutOfOrder).toBe(false);
    expect(footer.textContent).toContain('2 results added to your draft and saved.');
  }finally{await act(async()=>root.unmount());container.remove();}
});


test("adding results removes them from review while unadded batches stay available", async()=>{
  reset();const run=makeRun();run.state='done';run.items.forEach((item)=>{item.state='ready';});state.runs=[run];
  const {container,root}=await mount();
  try{
    await click(container,'Selected paragraphs');
    await act(async()=>container.querySelector<HTMLInputElement>('.ai-review-row input')?.click());
    await click(container,'Add 1 results to draft');
    expect(container.querySelectorAll('.ai-review-row').length).toBe(1);
    expect(container.querySelector('.ai-review-row strong')?.textContent).toContain('Include result 2');
    expect(state.runs[0].items[0].previewHtml).toBeNull();
    await click(container,'Select all results');await click(container,'Add 1 results to draft');
    expect(container.querySelectorAll('.ai-review-row').length).toBe(0);
    expect(container.textContent).toContain('No results waiting to be added');
    expect(editorApi?.draft?.html).toContain('မြန်မာ');
  }finally{await act(async()=>root.unmount());container.remove();}
});

test("translating the same paragraph again replaces its pending result without changing draft", async()=>{
  reset();const{container,root}=await mount();
  try{
    await click(container,'Selected paragraphs');
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Source selections"] input')?.click());
    const consent=[...container.querySelectorAll<HTMLInputElement>('input')].find((input)=>input.parentElement?.textContent?.includes('I understand selected text'));
    await act(async()=>consent?.click());await click(container,'Translate 1 items');await click(container,'Select all results');
    await click(container,'Select more');await click(container,'Translate 1 items');
    expect(container.querySelectorAll('.ai-review-row').length).toBe(1);
    expect(container.querySelector('[aria-label="Translation version for item 1"]')).toBeNull();
    expect(button(container,'Add 0 results to draft').disabled).toBe(true);
    expect(state.runs[1].items[0].state).toBe('superseded');
    expect(state.runs[1].items[0].previewHtml).toBeNull();
    expect(editorApi?.draft?.html).toBe('<p>Manual writing.</p>');
    await click(container,'Select all results');await click(container,'Add 1 results to draft');
    const appended=commands.find((value)=>value.command==='append_ai_selection_results')?.args?.input as{proposalIds:string[]};
    expect(appended.proposalIds).toEqual(['run2:proposal-text']);
  }finally{await act(async()=>root.unmount());container.remove();}
});
