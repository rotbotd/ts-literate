// token classification and rendering

import type { TokenInfo } from "./types.js";

// classification types that represent named entities we can link.
// these are all the syntactic categories where definitions and
// references can occur.
const linkableTypes = new Set([
  "identifier",
  "interface name",
  "class name", 
  "enum name",
  "type parameter name",
  "parameter name",
  "module name",  // namespace Foo { }
  "string",       // import strings like "./foo.js"
]);

export function isLinkable(classificationType: string): boolean {
  return linkableTypes.has(classificationType);
}

export function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "-");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import type { HighlighterGeneric, BundledLanguage, BundledTheme } from "shiki";

let highlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | null = null;

// initialize shiki highlighter - call once before highlighting
export async function initHighlighter(): Promise<void> {
  if (highlighter) return;
  const { createHighlighter } = await import("shiki");
  highlighter = await createHighlighter({
    themes: ["github-light"],
    langs: ["typescript"],
  });
}

// highlight quickinfo text with shiki typescript grammar
export function highlightQuickInfo(text: string): string {
  if (!highlighter) {
    // fallback if not initialized
    return escapeHtml(text);
  }
  
  const { tokens } = highlighter.codeToTokens(text, { 
    lang: "typescript", 
    theme: "github-light" 
  });
  
  let html = "";
  for (const line of tokens) {
    for (const token of line) {
      // skip default color, just use inherited
      if (token.color && token.color.toLowerCase() !== "#24292e") {
        html += `<span style="color:${token.color}">${escapeHtml(token.content)}</span>`;
      } else {
        html += escapeHtml(token.content);
      }
    }
    html += "\n";
  }
  return html.trim();
}

// link computation function type
export type ComputeLink = (fromFile: string, toFile: string, anchor: string) => string;

export interface RenderTokenOptions {
  knownFiles?: Map<string, string>;
  computeLink?: ComputeLink;
  includeExternals?: boolean;
  // for quickinfo tooltips
  quickInfoMap?: Map<string, string>;
  tokenIdCounter?: { value: number };
}

// render a token with optional cross-file linking and quickinfo
export function renderToken(
  token: TokenInfo,
  currentFile: string,
  opts: RenderTokenOptions = {}
): string {
  const { knownFiles, computeLink, includeExternals = false, quickInfoMap, tokenIdCounter } = opts;
  const classAttr = token.classes.map(c => `ts-${c}`).join(" ");
  const text = escapeHtml(token.text);
  
  // generate token id and store quickinfo if available
  let tokenId: string | undefined;
  if (token.quickInfo && quickInfoMap && tokenIdCounter) {
    tokenId = `t${tokenIdCounter.value++}`;
    quickInfoMap.set(tokenId, token.quickInfo);
  }
  
  if (token.isDefinition) {
    // definition site: link to self so it participates in hover highlighting
    const defId = `def-${sanitizeId(token.definitionId!)}`;
    // use def id as the token id for quickinfo too
    if (token.quickInfo && quickInfoMap) {
      quickInfoMap.set(defId, token.quickInfo);
    }
    return `<a id="${defId}" href="#${defId}" class="${classAttr}">${text}</a>`;
  } else if (token.definitionId && token.definitionFile) {
    const anchor = `def-${sanitizeId(token.definitionId)}`;
    
    // check if external
    if (knownFiles && !knownFiles.has(token.definitionFile)) {
      if (!includeExternals) {
        const idAttr = tokenId ? ` id="${tokenId}"` : "";
        return `<span${idAttr} class="${classAttr}">${text}</span>`;
      }
    }
    
    let href: string;
    if (token.definitionFile === currentFile) {
      href = `#${anchor}`;
    } else if (computeLink) {
      href = computeLink(currentFile, token.definitionFile, anchor);
    } else {
      // fallback: simple .ts -> .html replacement
      const htmlFile = token.definitionFile.replace(/\.d\.ts$/, ".d.html").replace(/\.ts$/, ".html");
      href = `${htmlFile}#${anchor}`;
    }
    
    const idAttr = tokenId ? ` id="${tokenId}"` : "";
    return `<a${idAttr} href="${href}" class="${classAttr}">${text}</a>`;
  } else {
    const idAttr = tokenId ? ` id="${tokenId}"` : "";
    return `<span${idAttr} class="${classAttr}">${text}</span>`;
  }
}
