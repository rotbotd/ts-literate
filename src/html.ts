/// # html generation (re-export)
///
/// this barrel file re-exports the html generation module. the actual
/// implementation lives in `./html/index.ts` — we re-export here so
/// that consumers can import from `ts-literate/html` without knowing
/// about the internal folder structure.

export { 
  generateHtml, 
  generateHtmlMulti,
  type HtmlOptions, 
  type HtmlResult, 
  type MultiFileResult 
} from "./html/index.js";
