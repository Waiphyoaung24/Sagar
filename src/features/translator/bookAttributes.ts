import { Extension } from "@tiptap/react";
import { bookStructureNames } from "./bookStructure";
import { tableAppearanceAttributes } from "./tableAppearance";

/** Retain source XHTML attributes when switching/editing in rich text. */
export const BookAttributes = Extension.create({
  name: "bookAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["code", "book_empty_code"],
        attributes: {
          "data-highlighted": {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-highlighted"),
          },
        },
      },
      {
        types: ["book_div", "book_text_div"],
        attributes: {
          align: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("align"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.align === "string" ? { align: attributes.align } : {},
          },
        },
      },
      {
        types: ["table"],
        attributes: {
          bookTableAppearance: {
            default: null,
            parseHTML: () => null,
            renderHTML: tableAppearanceAttributes,
          },
        },
      },
      {
        types: [
          ...bookStructureNames,
          "paragraph",
          "hardBreak",
          "bookAnchor",
          "table",
          "tableRow",
          "tableCell",
          "tableHeader",
          "heading",
          "bulletList",
          "orderedList",
          "listItem",
          "blockquote",
          "horizontalRule",
          "image",
          "link",
          "bold",
          "italic",
          "underline",
          "strike",
          "code",
          "codeBlock",
        ],
        attributes: {
          bookAria: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              Object.fromEntries(
                Array.from(element.attributes)
                  .filter((attr) => attr.name.startsWith("aria-"))
                  .map((attr) => [attr.name, attr.value]),
              ),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.bookAria;
              return value && typeof value === "object"
                ? Object.fromEntries(
                    Object.entries(value).filter(
                      ([name, text]) =>
                        name.startsWith("aria-") && typeof text === "string",
                    ),
                  )
                : {};
            },
          },
          ...Object.fromEntries(
            [
              "class",
              "id",
              "title",
              "lang",
              "dir",
              "role",
              "data-parent",
              "epub:type",
              "xmlns:epub",
              "xml:lang",
            ].map((name) => [
              name,
              {
                default: null,
                parseHTML: (element: HTMLElement) => element.getAttribute(name),
                renderHTML: (attributes: Record<string, unknown>) =>
                  typeof attributes[name] === "string"
                    ? { [name]: attributes[name] }
                    : {},
              },
            ]),
          ),
          // Keep imported inline CSS for export, but never apply it to the
          // editing surface: arbitrary book styles can hide text, change
          // layout or load resources. The serializer restores `style`.
          bookStyle: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("style") ?? element.getAttribute("data-book-style"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.bookStyle === "string"
                ? { "data-book-style": attributes.bookStyle }
                : {},
          },
        },
      },
      {
        types: ["image", "book_inline_image"],
        attributes: Object.fromEntries(
          ["srcset", "sizes", "width", "height", "loading", "decoding"].map((name) => [
            name,
            {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute(name),
              renderHTML: (attributes: Record<string, unknown>) =>
                typeof attributes[name] === "string" ? { [name]: attributes[name] } : {},
            },
          ]),
        ),
      },
      {
        types: ["table", "tableCell", "tableHeader"],
        attributes: Object.fromEntries(
          [
            "width",
            "height",
            "align",
            "valign",
            "scope",
            "abbr",
            "headers",
            "border",
            "cellpadding",
            "cellspacing",
          ].map((name) => [
            name,
            {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute(name),
              renderHTML: (attributes: Record<string, unknown>) =>
                typeof attributes[name] === "string" ? { [name]: attributes[name] } : {},
            },
          ]),
        ),
      },
    ];
  },
});
