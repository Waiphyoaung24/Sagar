import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { DOMParser as ProseMirrorParser } from "@tiptap/pm/model";
import { BookAnchor } from "../../src/features/translator/bookAnchor";
import { BookAttributes } from "../../src/features/translator/bookAttributes";
import { comparableDocument, documentFragment, sanitizePreviewHtml } from "../../src/features/translator/richText";

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
});

test("Rich editing retains EPUB anchors, Myanmar text, links and trailing spaces", async () => {
  const html = await Bun.file(new URL("../fixtures/editor/anchors.xhtml", import.meta.url)).text();
  const editor = new Editor({
    extensions: [BookAttributes, BookAnchor, StarterKit.configure({
      code: false, codeBlock: false,
      link: { openOnClick: false, autolink: false },
    })],
    content: html,
    parseOptions: { preserveWhitespace: true },
  });
  try {
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
    editor.commands.insertContentAt(1, "မြန်မာ ");
    const saved = documentFragment(editor.getHTML());
    expect(saved).toContain('<a id="p3"></a>');
    expect(saved).toContain('<a id="p4" title="Page four"></a>');
    expect(saved).toContain("မင်္ဂလာပါ မြန်မာစာ  </p>");
    expect(saved).toContain('href="#p3"');
    editor.commands.setContent(saved, { parseOptions: { preserveWhitespace: true } });
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(saved));
    // The mounted editor must also accept an external HTML draft through
    // the same parsed-document path used by HTML → Rich.
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const parsed = ProseMirrorParser.fromSchema(editor.schema).parse(wrapper, {
      preserveWhitespace: true,
    });
    editor.commands.setContent(parsed.toJSON(), { emitUpdate: false });
    expect(comparableDocument(editor.getHTML())).toBe(comparableDocument(html));
  } finally {
    editor.destroy();
  }
});

test("AI proposal preview keeps unsupported markup but removes active content", () => {
  const html = [
    '<p><font color="red">မြန်မာ</font>',
    '<a href="javascript:alert(1)" onclick="bad()">link</a>',
    '<a href="#note">note</a>',
    '<img src="data:image/png;base64,AA" onerror="bad()"/>',
    '<span style="position:fixed">styled</span>',
    "<script>bad()</script>",
    '<iframe src="https://example.com"></iframe>',
    "</p>",
  ].join("");
  const safe = sanitizePreviewHtml(html);
  expect(safe).toContain("<font");
  expect(safe).toContain("မြန်မာ");
  expect(safe).toContain("link");
  expect(safe).toContain('href="#note"');
  expect(safe).toContain("data:image/png;base64,AA");
  expect(safe).not.toContain("javascript:");
  expect(safe).not.toContain("onclick");
  expect(safe).not.toContain("onerror");
  expect(safe).not.toContain("position:fixed");
  expect(safe).not.toContain("<script");
  expect(safe).not.toContain("<iframe");
});
