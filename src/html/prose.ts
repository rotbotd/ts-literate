// prose (markdown) rendering using marked with shiki syntax highlighting

import { Marked } from "marked";
import markedShiki from "marked-shiki";
import { createHighlighter, type HighlighterGeneric, type BundledLanguage, type BundledTheme } from "shiki";

let marked: Marked | null = null;

// initialize marked with shiki - call once before rendering
export async function initMarked(): Promise<void> {
  if (marked) return;
  
  const highlighter = await createHighlighter({
    themes: ["github-light"],
    langs: ["typescript", "javascript", "json", "bash", "css", "html"],
  });
  
  marked = new Marked();
  marked.use(markedShiki({
    highlight(code, lang) {
      // default to typescript if no lang specified
      const language = lang || "typescript";
      // check if language is loaded, fall back to plaintext
      const loadedLangs = highlighter.getLoadedLanguages();
      const actualLang = loadedLangs.includes(language as BundledLanguage) ? language : "plaintext";
      return highlighter.codeToHtml(code, { 
        lang: actualLang, 
        theme: "github-light" 
      });
    }
  }));
}

// render prose with full markdown support via marked
export async function renderProse(content: string): Promise<string> {
  if (!marked) {
    await initMarked();
  }
  
  const html = await marked!.parse(content);
  return `<div class="prose">${html}</div>`;
}
