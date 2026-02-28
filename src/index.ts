/// # ts-literate
///
/// literate programming for typescript. the idea is simple: `///` comments
/// in your `.ts` files become prose (rendered as markdown), and everything
/// else stays as syntax-highlighted, cross-linked code.
///
/// this is a port of the approach used by [agda's literate mode](https://agda.readthedocs.io/en/v2.6.3/tools/literate-programming.html):
/// split a source file into layers (code vs. prose), then "illiterate" it
/// by blanking the prose regions to spaces. this preserves line and column
/// numbers so that typescript error messages still point to the right place
/// in your original file.
///
/// the library has two main capabilities:
///
/// 1. **extraction** — parsing `///` comments out of typescript source and
///    producing a layer structure that separates code from prose.
/// 2. **html generation** — feeding those layers through the typescript
///    language service (for type info, go-to-definition, etc.) and a
///    markdown renderer to produce hyperlinked, syntax-highlighted HTML.

export { extractLayers, illiterate, type Layer, type LayerRole } from "./extract.js";
export { generateHtml, generateHtmlMulti, type HtmlOptions, type MultiFileResult } from "./html.js";
