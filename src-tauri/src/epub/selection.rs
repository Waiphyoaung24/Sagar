//! Loss-aware source selections. Markup and images never belong to the model;
//! only bounded text-node ranges are translated and spliced back locally.
use crate::{
    epub::{preview::escape_html_text as escape, rich_text},
    error::AppError,
};
use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

pub const OPEN: &str = "<w xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ancestor {
    pub locator: String,
    pub opening: String,
    pub closing: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceUnit {
    pub id: String,
    pub order: usize,
    pub locator: String,
    pub kind: String,
    pub text: String,
    pub html: String,
    pub ancestors: Vec<Ancestor>,
    pub unavailable: Option<String>,
}

fn opening(node: roxmltree::Node<'_, '_>, list_start: Option<i64>) -> String {
    let mut value = format!("<{}", node.tag_name().name());
    for a in node.attributes() {
        if list_start.is_some() && a.name() == "start" {
            continue;
        }
        let prefix = match a.namespace() {
            Some("http://www.idpf.org/2007/ops") => "epub:",
            Some("http://www.w3.org/XML/1998/namespace") => "xml:",
            Some("http://www.w3.org/1999/xlink") => "xlink:",
            _ => "",
        };
        value.push_str(&format!(" {prefix}{}=\"{}\"", a.name(), escape(a.value())));
    }
    if let Some(start) = list_start {
        value.push_str(&format!(" start=\"{start}\""));
    }
    value.push('>');
    value
}

/// Block children keep a container split into separate units. Inline-only
/// containers (common in converted EPUBs) are paragraph-like and can be
/// translated as one unit without losing their spans or loose text.
fn is_selection_block(tag: &str) -> bool {
    matches!(
        tag,
        "p" | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "ul"
            | "ol"
            | "li"
            | "blockquote"
            | "hr"
            | "table"
            | "thead"
            | "tbody"
            | "tfoot"
            | "tr"
            | "td"
            | "th"
            | "caption"
            | "div"
            | "section"
            | "hgroup"
            | "article"
            | "main"
            | "header"
            | "footer"
            | "aside"
            | "figure"
            | "figcaption"
            | "pre"
            | "dl"
            | "dt"
            | "dd"
            | "svg"
    )
}

/// The caller assigns persisted identities after matching structural locators.
pub fn collect(source: &str) -> Result<Vec<SourceUnit>, AppError> {
    let doc = super::xml::parse(source)
        .map_err(|_| AppError::new("invalid_epub", "The source chapter is not valid XHTML."))?;
    let body = doc
        .descendants()
        .find(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "body")))
        .ok_or_else(|| AppError::new("invalid_epub", "The source chapter has no XHTML body."))?;
    fn walk(
        node: roxmltree::Node<'_, '_>,
        locator: String,
        ancestors: Vec<Ancestor>,
        source: &str,
        units: &mut Vec<SourceUnit>,
    ) {
        let tag = node.tag_name().name();
        let is_container = matches!(
            tag,
            "div"
                | "section"
                | "article"
                | "main"
                | "header"
                | "footer"
                | "aside"
                | "blockquote"
                | "ul"
                | "ol"
        );
        let loose = node
            .children()
            .any(|n| n.is_text() && !n.text().unwrap_or("").trim().is_empty());
        let has_block_child = node
            .children()
            .filter(|n| n.is_element())
            .any(|n| is_selection_block(n.tag_name().name()));
        let has_text = node
            .descendants()
            .any(|n| n.is_text() && !n.text().unwrap_or("").trim().is_empty());
        let list_numbering_safe = tag != "ol"
            || node
                .attribute("start")
                .is_none_or(|start| start.parse::<i32>().is_ok());
        // Text-bearing inline containers stay one unit; image-only wrappers
        // still descend so their images keep the "image" kind.
        if is_container
            && list_numbering_safe
            && ancestors.len() < 30
            && !loose
            && (has_block_child || !has_text)
        {
            for (index, child) in node.children().filter(|n| n.is_element()).enumerate() {
                let start = if tag == "ol" {
                    let base = node
                        .attribute("start")
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(1);
                    Some(base + index as i64)
                } else {
                    None
                };
                let mut path = ancestors.clone();
                path.push(Ancestor {
                    locator: locator.clone(),
                    opening: opening(node, start),
                    closing: format!("</{tag}>"),
                });
                walk(child, format!("{locator}/{index}"), path, source, units);
            }
            return;
        }
        let text: String = node
            .descendants()
            .filter(|n| n.is_text())
            .filter_map(|n| n.text())
            .collect();
        let has_image = node
            .descendants()
            .any(|n| n.has_tag_name("img") || n.has_tag_name("svg") || n.has_tag_name("picture"));
        if text.trim().is_empty() && !has_image && tag != "table" {
            return;
        }
        let kind = match tag {
            "table" => "table",
            "figure" => "figure",
            "img" | "picture" | "svg" => "image",
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => "heading",
            "li" => "list item",
            "figcaption" => "caption",
            _ => "paragraph",
        };
        let mixed_inline_container = matches!(
            tag,
            "div" | "section" | "article" | "main" | "header" | "footer" | "aside" | "blockquote"
        ) && !has_block_child;
        let supported = mixed_inline_container
            || matches!(
                tag,
                "p" | "hgroup"
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "li"
                    | "figcaption"
                    | "table"
                    | "figure"
                    | "img"
            );
        let raw = &source[node.range()];
        let mut contextual = raw.to_string();
        for ancestor in ancestors.iter().rev() {
            contextual = format!("{}{}{}", ancestor.opening, contextual, ancestor.closing);
        }
        let canonical = rich_text::validate_document(&contextual).and_then(|(validated, plain)| {
            let wrapped = format!("{OPEN}{validated}</w>");
            let parsed = super::xml::parse(&wrapped).map_err(|_| {
                AppError::new(
                    "invalid_selection",
                    "The selected structure could not be normalized.",
                )
            })?;
            let mut selected = parsed.root_element();
            for _ in 0..=ancestors.len() {
                selected = selected.first_element_child().ok_or_else(|| {
                    AppError::new(
                        "invalid_selection",
                        "The selected element was not preserved.",
                    )
                })?;
            }
            Ok((wrapped[selected.range()].to_string(), plain))
        });
        let (mut html, mut unavailable) = match canonical {
            Ok((html, _)) if supported => (html, None),
            Ok((html, _)) => (
                html,
                Some(format!(
                    "This <{tag}> structure cannot be selected safely yet."
                )),
            ),
            Err(e) => (String::new(), Some(e.message)),
        };
        // Selected, nonadjacent list items retain their original number even
        // when intervening items are not appended.
        if tag == "li"
            && unavailable.is_none()
            && let Some(parent) = node.parent_element()
            && parent.has_tag_name("ol")
            && node.attribute("value").is_none()
        {
            let mut number = parent
                .attribute("start")
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(1);
            for sibling in parent.children().filter(|n| n.has_tag_name("li")) {
                if let Some(value) = sibling
                    .attribute("value")
                    .and_then(|s| s.parse::<i64>().ok())
                {
                    number = value;
                }
                if sibling == node {
                    break;
                }
                if let Some(next) = number.checked_add(1) {
                    number = next;
                } else {
                    unavailable =
                        Some("This list numbering is too large to preserve safely.".into());
                    break;
                }
            }
            let mut reader = quick_xml::Reader::from_str(&html);
            if matches!(reader.read_event(), Ok(quick_xml::events::Event::Start(_))) {
                let end = reader.buffer_position() as usize;
                html.insert_str(end - 1, &format!(" value=\"{number}\""));
            }
        }
        units.push(SourceUnit {
            id: String::new(),
            order: units.len(),
            locator,
            kind: kind.into(),
            text: text.trim().to_string(),
            html,
            ancestors,
            unavailable,
        });
    }
    let mut units = Vec::new();
    for (i, node) in body.children().filter(|n| n.is_element()).enumerate() {
        walk(node, i.to_string(), vec![], source, &mut units);
    }
    if body
        .children()
        .any(|n| n.is_text() && !n.text().unwrap_or("").trim().is_empty())
    {
        units.push(SourceUnit {id:String::new(),order:units.len(),locator:"loose-body-text".into(),kind:"paragraph".into(),text:"Loose text outside a paragraph".into(),html:String::new(),ancestors:vec![],unavailable:Some("Loose body text cannot be selected safely; use Whole chapter or translate it manually.".into())});
    }
    Ok(units)
}

#[derive(Debug, Clone)]
pub struct TextPart {
    pub node: usize,
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// Never split a grapheme, entity or tag. Whitespace is retained outside the
/// translatable range so a model cannot eat spaces around inline elements.
pub fn parts(html: &str, budget: usize) -> Result<Vec<TextPart>, AppError> {
    let wrapped = format!("{OPEN}{html}</w>");
    let doc = super::xml::parse(&wrapped).map_err(|_| {
        AppError::new(
            "invalid_translation",
            "The selected fragment is not valid XHTML.",
        )
    })?;
    let mut result = Vec::new();
    for (node_index, node) in doc.descendants().filter(|n| n.is_text()).enumerate() {
        let text = node.text().unwrap_or("");
        let begin = text.len() - text.trim_start().len();
        let end = text.trim_end().len();
        if begin >= end {
            continue;
        }
        let mut position = begin;
        while position < end {
            let rest = &text[position..end];
            let take = split_length(rest, budget)?;
            let chunk = &rest[..take];
            let lead = chunk.len() - chunk.trim_start().len();
            let tail = chunk.trim_end().len();
            if lead < tail {
                result.push(TextPart {
                    node: node_index,
                    start: position + lead,
                    end: position + tail,
                    text: chunk[lead..tail].into(),
                });
            }
            position += take;
        }
    }
    Ok(result)
}

fn split_length(text: &str, budget: usize) -> Result<usize, AppError> {
    let mut end = 0;
    let mut encoded = 7;
    for grapheme in text.graphemes(true) {
        let size = escape(grapheme).len();
        if encoded + size > budget {
            break;
        }
        end += grapheme.len();
        encoded += size;
    }
    if end == text.len() {
        return Ok(end);
    }
    if end == 0 {
        return Err(AppError::new(
            "selection_unsplittable",
            "A single Unicode sequence exceeds the request budget. This item cannot be split safely.",
        ));
    }
    // Inspect only a bounded prefix. Re-scanning the entire remaining chapter
    // for every part would become quadratic on a large unpunctuated paragraph.
    let window = &text[..end];
    let sentence = window
        .split_sentence_bound_indices()
        .map(|(i, s)| i + s.len())
        .filter(|i| *i < end)
        .last();
    let word = window
        .split_word_bound_indices()
        .map(|(i, s)| i + s.len())
        .rfind(|i| *i < end);
    Ok(sentence.or(word).unwrap_or(end))
}

/// Replace decoded text ranges, serializing escaped text into the original
/// canonical markup. Image elements and all other markup remain local.
pub fn reconstruct(
    html: &str,
    replacements: &[(usize, usize, usize, String)],
) -> Result<String, AppError> {
    let wrapped = format!("{OPEN}{html}</w>");
    let doc = super::xml::parse(&wrapped).map_err(|_| {
        AppError::new(
            "invalid_translation",
            "The selected fragment could not be rebuilt.",
        )
    })?;
    let mut output = html.to_string();
    let nodes: Vec<_> = doc.descendants().filter(|n| n.is_text()).collect();
    for (index, node) in nodes.iter().enumerate().rev() {
        let mut text = node.text().unwrap_or("").to_string();
        let mut ranges: Vec<_> = replacements.iter().filter(|p| p.0 == index).collect();
        ranges.sort_by_key(|p| std::cmp::Reverse(p.1));
        for (_, start, end, value) in ranges {
            if start > end || !text.is_char_boundary(*start) || !text.is_char_boundary(*end) {
                return Err(AppError::new(
                    "invalid_selection",
                    "A saved translation range is invalid.",
                ));
            }
            text.replace_range(*start..*end, value);
        }
        let range = node.range();
        output.replace_range(
            range.start - OPEN.len()..range.end - OPEN.len(),
            &escape(&text),
        );
    }
    // The enclosing list/quotation context is validated by the caller. A list
    // item is not a valid standalone chapter, but must retain its own element.
    let checked = format!("{OPEN}{output}</w>");
    super::xml::parse(&checked).map_err(|_| {
        AppError::new(
            "invalid_translation",
            "The translated selection is not valid XHTML.",
        )
    })?;
    Ok(output)
}

/// Coalesce shared ancestors, retaining list/quotation/section structure and
/// one copy of each ancestor's identity within an append operation.
pub fn assemble(units: &[(SourceUnit, String)]) -> String {
    let mut output = String::new();
    let mut active: Vec<Ancestor> = vec![];
    for (unit, html) in units {
        let common = active
            .iter()
            .zip(&unit.ancestors)
            .take_while(|(a, b)| a.locator == b.locator)
            .count();
        for a in active[common..].iter().rev() {
            output.push_str(&a.closing);
        }
        for a in &unit.ancestors[common..] {
            output.push_str(&a.opening);
        }
        active = unit.ancestors.clone();
        output.push_str(html);
    }
    for a in active.iter().rev() {
        output.push_str(&a.closing);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str = include_str!("../../../tests/fixtures/ai/selected-content.xhtml");

    #[test]
    fn heading_groups_and_time_are_selectable_and_preserved() {
        let source = include_str!("../../../tests/fixtures/editor/selection-time.xhtml");
        let units = collect(source).expect("source");
        assert_eq!(units.len(), 2);
        assert!(units.iter().all(|u| u.unavailable.is_none()), "{units:?}");
        assert_eq!(units[0].locator, "0");
        assert!(units[0].html.contains("<hgroup id=\"title\">"));
        assert!(
            units[1]
                .html
                .contains("<time datetime=\"1878\">1878</time>")
        );
        let translated: Vec<_> = units
            .into_iter()
            .map(|unit| {
                let replacements = parts(&unit.html, 4096)
                    .expect("parts")
                    .into_iter()
                    .map(|part| (part.node, part.start, part.end, "မြန်မာ".into()))
                    .collect::<Vec<_>>();
                let html = reconstruct(&unit.html, &replacements).expect("rebuild");
                (unit, html)
            })
            .collect();
        let html = assemble(&translated);
        let validated = rich_text::validate_document(&html)
            .expect("valid translation")
            .0;
        assert!(validated.contains("<time datetime=\"1878\">မြန်မာ</time>"));
        assert!(validated.contains("<hgroup id=\"title\">"));
        assert!(
            rich_text::validate_document("<p><time onclick=\"bad()\">1878</time></p>").is_err()
        );
        assert!(rich_text::validate_document("<p><time><p>bad</p></time></p>").is_err());
    }

    #[test]
    fn selections_keep_figures_tables_images_and_structural_identity() {
        let units = collect(SOURCE).expect("source");
        assert_eq!(units.len(), 10);
        assert_eq!(units.iter().filter(|u| u.kind == "table").count(), 1);
        assert_eq!(units.iter().filter(|u| u.kind == "figure").count(), 1);
        assert_eq!(units.iter().filter(|u| u.kind == "image").count(), 1);
        assert!(
            units.iter().all(|u| u.unavailable.is_none()),
            "{:?}",
            units
                .iter()
                .map(|u| (&u.kind, &u.unavailable))
                .collect::<Vec<_>>()
        );
        let table = units.iter().find(|u| u.kind == "table").expect("table");
        assert!(table.html.contains("rowspan=\"2\""));
        assert!(table.html.contains("images/river.png"));
        assert!(!units.iter().any(|u| u.kind == "caption"));
        assert_eq!(
            collect(SOURCE)
                .expect("again")
                .iter()
                .map(|u| &u.locator)
                .collect::<Vec<_>>(),
            units.iter().map(|u| &u.locator).collect::<Vec<_>>()
        );
    }

    #[test]
    fn long_unicode_ranges_reassemble_without_losing_whitespace_or_inline_images() {
        let text = "မြန်မာစာ ကောင်းတယ်။ A sentence & another sentence. ".repeat(500);
        let html = format!(
            "<p id=\"long\">  {}<em> bold &amp; spaced </em><img src=\"images/a.png\" alt=\"Same\"/> end </p>",
            escape(&text)
        );
        let saved = rich_text::validate_document(&html).expect("valid").0;
        let ranges = parts(&saved, 512).expect("parts");
        assert!(ranges.len() > 20);
        assert!(ranges.iter().all(|p| escape(&p.text).len() + 7 <= 512));
        let replacement: Vec<_> = ranges
            .iter()
            .map(|p| (p.node, p.start, p.end, p.text.clone()))
            .collect();
        assert_eq!(
            reconstruct(&saved, &replacement).expect("reconstructed"),
            saved
        );
        let new: Vec<_> = ranges
            .iter()
            .map(|p| (p.node, p.start, p.end, "မြန်မာ".into()))
            .collect();
        let rebuilt = reconstruct(&saved, &new).expect("translated");
        assert_eq!(rebuilt.matches("<p ").count(), 1);
        assert!(rebuilt.contains("<em> မြန်မာ </em>"));
        assert!(rebuilt.contains("<img src=\"images/a.png\" alt=\"Same\"/>"));
    }

    #[test]
    fn markup_entities_and_graphemes_are_never_split() {
        let giant = "a\u{0301}".repeat(1000);
        let html = format!("<p>{}</p>", escape(&giant));
        for p in parts(&html, 512).expect("graphemes") {
            assert!(p.text.starts_with('a'));
            assert!(p.text.ends_with('\u{0301}'));
        }
        let indivisible = format!("<p>a{}</p>", "\u{0301}".repeat(600));
        assert_eq!(
            parts(&indivisible, 512)
                .expect_err("oversized grapheme")
                .code,
            "selection_unsplittable"
        );
    }

    #[test]
    fn table_text_is_rebuilt_with_unchanged_markup_and_images() {
        let table = collect(SOURCE)
            .expect("source")
            .into_iter()
            .find(|u| u.kind == "table")
            .expect("table");
        let replacements: Vec<_> = parts(&table.html, 4096)
            .expect("parts")
            .into_iter()
            .map(|p| (p.node, p.start, p.end, "မြန်မာ".into()))
            .collect();
        let html = reconstruct(&table.html, &replacements).expect("rebuild");
        for marker in [
            "<caption>",
            "<thead>",
            "<tfoot>",
            "rowspan=\"2\"",
            "colspan=\"2\"",
            "alt=\"Marker\"",
            "<td></td>",
        ] {
            assert!(html.contains(marker), "{marker}: {html}");
        }
    }

    #[test]
    fn unsafe_or_unknown_structures_are_visible_and_unavailable() {
        let source = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p onclick=\"bad()\">Text</p><pre>Code</pre><div>Loose <p>block</p></div></body></html>";
        let units = collect(source).expect("units");
        assert_eq!(units.len(), 3);
        assert!(units.iter().all(|u| u.unavailable.is_some()));
    }

    #[test]
    fn mixed_inline_div_wrapper_is_selectable_as_one_paragraph() {
        // Converted EPUBs often use a div with spans and loose text instead
        // of a paragraph. It must stay one unit; splitting the spans would
        // break the sentence.
        let source = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><div class=\"class24\"><span class=\"class25\">T</span><span class=\"class26\">HE BOY’S NAME WAS SANTIAGO. DUSK</span> was falling as the boy arrived with his herd at an abandoned church.</div></body></html>";
        let units = collect(source).expect("units");
        assert_eq!(units.len(), 1);
        let unit = &units[0];
        assert_eq!(unit.kind, "paragraph");
        assert!(unit.unavailable.is_none(), "{:?}", unit.unavailable);
        assert!(unit.html.starts_with("<div class=\"class24\">"));
        assert!(unit.html.contains("<span class=\"class25\">T</span>"));
        assert!(unit.html.contains("was falling as the boy arrived"));
        let replacements: Vec<_> = parts(&unit.html, 4096)
            .expect("parts")
            .into_iter()
            .map(|p| (p.node, p.start, p.end, "မြန်မာ".into()))
            .collect();
        let rebuilt = reconstruct(&unit.html, &replacements).expect("rebuild");
        assert!(rebuilt.contains("မြန်မာ"));
        assert!(!rebuilt.contains("was falling"));
    }

    #[test]
    fn inline_only_div_without_loose_text_stays_one_unit() {
        let source = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><div><span>Hello </span><span>world</span></div></body></html>";
        let units = collect(source).expect("units");
        assert_eq!(units.len(), 1);
        assert!(units[0].unavailable.is_none(), "{:?}", units[0].unavailable);
        assert!(
            units[0]
                .html
                .contains("<span>Hello </span><span>world</span>")
        );
    }

    #[test]
    fn single_span_div_wrapper_is_selectable() {
        // Some converters wrap a whole paragraph in a single span instead of
        // putting loose text directly in the div.
        let source = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><div class=\"class15\"><span class=\"class16\">He swept the floor with his jacket and lay down, using the book he had just finished reading as a pillow.</span></div></body></html>";
        let units = collect(source).expect("units");
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].kind, "paragraph");
        assert!(units[0].unavailable.is_none(), "{:?}", units[0].unavailable);
        assert!(units[0].html.starts_with("<div class=\"class15\">"));
        assert!(units[0].html.contains("<span class=\"class16\">"));
    }

    #[test]
    fn image_only_container_still_yields_an_image_unit() {
        let source = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><div><img src=\"images/a.png\" alt=\"A\"/></div></body></html>";
        let units = collect(source).expect("units");
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].kind, "image");
        assert!(units[0].unavailable.is_none(), "{:?}", units[0].unavailable);
        assert!(
            units[0]
                .html
                .contains("<img src=\"images/a.png\" alt=\"A\"/>")
        );
    }

    #[test]
    fn ebook_line_breaking_wrapper_keeps_units_selectable() {
        // The wrapper is preserved as an ancestor for every block. If its
        // safe typography style is rejected, the whole chapter becomes
        // unavailable even though each selected block is ordinary text.
        let source = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>T</title></head><body><div class=\"body s1\" style=\"white-space:pre-wrap; line-break:strict;\"><h1 style=\"margin:0\">Title</h1><p>Text</p><ol style=\"padding:0 0 0 1px; margin:0;\"><li>One</li></ol></div></body></html>";
        let units = collect(source).expect("units");
        assert_eq!(units.len(), 3);
        assert!(
            units.iter().all(|u| u.unavailable.is_none()),
            "{:?}",
            units
                .iter()
                .map(|u| (&u.kind, &u.unavailable))
                .collect::<Vec<_>>()
        );
        assert!(
            units[0].ancestors[0]
                .opening
                .contains("white-space:pre-wrap")
        );
    }

    #[test]
    fn headings_with_flow_placement_styles_stay_selectable() {
        // Real books clear headings past floated cover art
        // (e.g. `<h2 style="clear: both">`); the style round-trips
        // verbatim through validation, so selection must stay available.
        let source = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h2 style=\"clear: both\">I. A Beginning</h2><p><img style=\"float: left\" src=\"images/cover.png\" alt=\"Cover\"/>Every author has some peculiarity.</p></body></html>";
        let units = collect(source).expect("units");
        assert_eq!(units.len(), 2);
        assert!(
            units.iter().all(|u| u.unavailable.is_none()),
            "{:?}",
            units
                .iter()
                .map(|u| (&u.kind, &u.unavailable))
                .collect::<Vec<_>>()
        );
        assert_eq!(units[0].kind, "heading");
        assert!(
            units[0].html.contains("style=\"clear: both\""),
            "{}",
            units[0].html
        );
        assert!(
            units[1].html.contains("style=\"float: left\""),
            "{}",
            units[1].html
        );
    }

    #[test]
    fn nonadjacent_list_selections_keep_numbering_and_shared_ancestors() {
        let units = collect(SOURCE).expect("source");
        let selected: Vec<_> = units
            .into_iter()
            .filter(|u| u.text == "Fourth" || u.text == "Sixth")
            .map(|u| {
                let html = u.html.clone();
                (u, html)
            })
            .collect();
        let html = assemble(&selected);
        assert_eq!(html.matches("<ol ").count(), 1);
        assert!(html.contains("value=\"4\""));
        assert!(html.contains("value=\"6\""));
        assert!(!html.contains("Fifth"));
        rich_text::validate_document(&html).expect("valid list");
    }
}
