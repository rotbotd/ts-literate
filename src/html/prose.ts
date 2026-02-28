/// # prose rendering
///
/// prose layers (the content extracted from `///` comments) are rendered
/// as markdown using [marked](https://github.com/markedjs/marked). code
/// fences inside the prose get syntax-highlighted by
/// [shiki](https://shiki.matsu.io/) via the `marked-shiki` plugin.
///
/// this means you can write full markdown in your `///` comments —
/// headings, lists, code blocks, links, tables, everything. the code
/// fences get the same github-light theme as the surrounding code.

import { Marked } from "marked";
import markedShiki from "marked-shiki";
import { createHighlighter, type HighlighterGeneric, type BundledLanguage, type BundledTheme } from "shiki";

let marked: Marked | null = null;

/// ## initMarked
///
/// lazy initialization of the marked + shiki pipeline. we only create
/// the highlighter once (it loads wasm grammars, so it's expensive)
/// and reuse it for all prose blocks.

export async function initMarked(): Promise<void> {
  if (marked) return;
  
  const highlighter = await createHighlighter({
    themes: ["github-light"],
    langs: ["typescript", "javascript", "json", "bash", "css", "html"],
  });
  
  marked = new Marked();
  marked.use(markedShiki({
    highlight(code, lang) {
      const language = lang || "typescript";
      const loadedLangs = highlighter.getLoadedLanguages();
      const actualLang = loadedLangs.includes(language as BundledLanguage) ? language : "plaintext";
      return highlighter.codeToHtml(code, { 
        lang: actualLang, 
        theme: "github-light" 
      });
    }
  }));
}

/// ## renderProse
///
/// takes a markdown string (already stripped of `///` markers) and
/// returns an html string wrapped in `<div class="prose">`. the prose
/// class gets styled differently from code blocks — proportional font,
/// wider line height, etc.

export async function renderProse(content: string): Promise<string> {
  if (!marked) {
    await initMarked();
  }
  
  const html = await marked!.parse(content);
  return `<div class="prose">${html}</div>`;
}
