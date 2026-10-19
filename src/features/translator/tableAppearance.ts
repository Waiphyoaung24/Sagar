/** Editor-only hints; documentFragment excludes these from saved/exported XHTML. */
export function tableAppearanceAttributes(attributes: Record<string, unknown>) {
  const table = document.createElement("table");
  const style = attributes.bookStyle ?? attributes.style;
  if (typeof style === "string") table.setAttribute("style", style);
  const legacyBorderless = String(attributes.border ?? "").trim() === "0";
  const borderless = ["top", "right", "bottom", "left"].every((side) => {
    const style = table.style.getPropertyValue(`border-${side}-style`);
    const width = table.style.getPropertyValue(`border-${side}-width`);
    if (
      style === "none" ||
      style === "hidden" ||
      (width && Number.parseFloat(width) === 0)
    )
      return true;
    return !style && !width && legacyBorderless;
  });
  return borderless ? { "data-book-borderless": "true" } : {};
}
