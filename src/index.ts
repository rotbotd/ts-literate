// ts-literate: literate programming for typescript
//
// this extracts typescript code from markdown files, preserving source positions
// so error messages point to the right place in your .lts.md file. it can also
// generate HTML with hyperlinked, syntax-highlighted code.
//
// the approach is borrowed from agda's literate mode: we split the file into
// layers (Code, Markup, Comment), then "illiterate" it by blanking non-code
// regions to spaces. this keeps line/column numbers intact.

export { extractLayers, illiterate, type Layer, type LayerRole } from "./extract.js";
export { generateHtml, generateHtmlMulti, type HtmlOptions, type MultiFileResult } from "./html.js";
