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

/// shiki loads textmate grammars as wasm modules, which is expensive —
/// you don't want to do it once per prose block. so we initialize the
/// whole marked + shiki pipeline once and reuse it. the first call to
/// `renderProse` pays the startup cost; every subsequent call is cheap.

export async function initMarked(): Promise<void> {
  if (marked) return;
  
  /// we pre-load grammars for the languages most likely to appear in code
  /// fences inside documentation. typescript and javascript are obvious;
  /// bash for shell examples, json for config files, css and html for
  /// web-related docs.
  const highlighter = await createHighlighter({
    themes: ["github-light"],
    langs: ["typescript", "javascript", "json", "bash", "css", "html"],
  });
  
  /// `marked-shiki` hooks into marked's code fence rendering. when marked
  /// encounters a fenced code block, it calls our `highlight` function
  /// instead of emitting plain `<code>`. we check if the requested language
  /// is one we loaded a grammar for — if not, we fall back to plaintext
  /// rather than crashing. (someone might write a ```rust block in their
  /// docs even though we didn't load the rust grammar.)
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

/// with the pipeline set up, rendering a prose block is just a matter of
/// feeding the markdown string (already stripped of `///` markers) through
/// marked and wrapping the result in a `<div class="prose">`. the wrapper
/// is important — it scopes the prose styles (proportional font, wider
/// line height, paragraph spacing) so they don't leak into the code blocks.

export async function renderProse(content: string): Promise<string> {
  if (!marked) {
    await initMarked();
  }
  
  const html = await marked!.parse(content);
  return `<div class="prose">${html}</div>`;
}
