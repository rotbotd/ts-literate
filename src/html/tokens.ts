/// # token classification and rendering
///
/// this module handles the lowest level of html output: rendering
/// individual tokens. a "token" here is a syntactic span from the
/// typescript language service — a keyword, an identifier, a string
/// literal, etc. — that we want to render as a colored, possibly
/// hyperlinked html element.
///
/// the key decisions for each token:
///
/// - **is it a definition site?** → render as `<a id="def-..." href="#def-...">`,
///   creating both an anchor and a self-link so it participates in hover highlighting.
/// - **does it reference a definition?** → render as `<a href="...#def-...">` pointing
///   to the definition, possibly in another file.
/// - **neither?** → render as a plain `<span>` with syntax coloring classes.

import type { TokenInfo } from "./types.js";

/// ## linkable types
///
/// not every syntactic category can be a definition or reference.
/// keywords, operators, and punctuation are never linkable. this set
/// enumerates the classification types where we should look for
/// go-to-definition info.

const linkableTypes = new Set([
  "identifier",
  "interface name",
  "class name", 
  "enum name",
  "type parameter name",
  "parameter name",
  "module name",
  /// import strings like `"./foo.js"` are linkable because they reference
  /// another module — we can link them to that module's generated html page.
  "string",
]);

export function isLinkable(classificationType: string): boolean {
  return linkableTypes.has(classificationType);
}

/// ## utility functions
///
/// a couple of small helpers that show up everywhere in the html generation
/// pipeline. they're boring but necessary — the kind of thing that bites
/// you if you forget to use them.

/// html ids can't contain colons, slashes, or most special characters.
/// since our definition ids look like `/path/to/file.ts:342`, we need to
/// sanitize them. everything that isn't a letter or digit becomes a dash.
export function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "-");
}

/// if you forget to escape `<` in html, you get invisible content and
/// broken rendering. ask me how i know.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/// when you hover over a token in the generated html, we show the same
/// type information VS Code would — things like `(property) foo: string`
/// or `function bar<T>(x: T): T`. that text is itself typescript, so it
/// deserves syntax highlighting too. we use a second shiki instance just
/// for tooltips.

import type { HighlighterGeneric, BundledLanguage, BundledTheme } from "shiki";

let highlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | null = null;

export async function initHighlighter(): Promise<void> {
  if (highlighter) return;
  const { createHighlighter } = await import("shiki");
  highlighter = await createHighlighter({
    themes: ["github-light"],
    langs: ["typescript"],
  });
}

/// `highlightQuickInfo` takes the raw display string from the language
/// service and returns syntax-highlighted html. we strip the default
/// text color (#24292e) so it inherits from the tooltip's own styling.
export function highlightQuickInfo(text: string): string {
  if (!highlighter) {
    return escapeHtml(text);
  }
  
  const { tokens } = highlighter.codeToTokens(text, { 
    lang: "typescript", 
    theme: "github-light" 
  });
  
  let html = "";
  for (const line of tokens) {
    for (const token of line) {
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

/// ## renderToken
///
/// every identifier in your code tells a story about a relationship.
/// `extractLayers` over there in extract.ts? that's a *reference* — it
/// points to where `extractLayers` was defined. the `function extractLayers`
/// line itself? that's the *definition site* — the place everything else
/// points to. and `const`? that's just a keyword — it doesn't point
/// anywhere.
///
/// `renderToken` figures out which of these three roles a token plays and
/// produces the appropriate html. definitions become anchors you can link
/// to. references become links that take you there. everything else gets
/// colored but stays inert.

export type ComputeLink = (fromFile: string, toFile: string, anchor: string) => string;

export interface RenderTokenOptions {
  knownFiles?: Map<string, string>;
  computeLink?: ComputeLink;
  includeExternals?: boolean;
  quickInfoMap?: Map<string, string>;
  tokenIdCounter?: { value: number };
}

export function renderToken(
  token: TokenInfo,
  currentFile: string,
  opts: RenderTokenOptions = {}
): string {
  const { knownFiles, computeLink, includeExternals = false, quickInfoMap, tokenIdCounter } = opts;
  const classAttr = token.classes.map(c => `ts-${c}`).join(" ");
  const text = escapeHtml(token.text);
  
  /// if this token has type info we want to show on hover, we need a way
  /// to connect the html element to its tooltip content. we give each such
  /// token a unique id, then later emit a `<template id="qi-{id}">` with
  /// the highlighted type signature. the client-side script looks up the
  /// template by id when you mouse over.
  let tokenId: string | undefined;
  if (token.quickInfo && quickInfoMap && tokenIdCounter) {
    tokenId = `t${tokenIdCounter.value++}`;
    quickInfoMap.set(tokenId, token.quickInfo);
  }
  
  if (token.isDefinition) {
    /// a definition site gets to be an anchor — the place everyone else
    /// links *to*. but there's a trick: we also make it link to itself.
    /// why? because the hover-highlight script works by matching hrefs.
    /// if the definition links to `#def-foo` and all references link to
    /// `#def-foo`, they all share the same href, so mousing over any of
    /// them lights up the whole family. elegant, if you don't think about
    /// it too hard.
    const defId = `def-${sanitizeId(token.definitionId!)}`;
    if (token.quickInfo && quickInfoMap) {
      quickInfoMap.set(defId, token.quickInfo);
    }
    return `<a id="${defId}" href="#${defId}" class="${classAttr}">${text}</a>`;
  } else if (token.definitionId && token.definitionFile) {
    /// the interesting question is: where does the link go? same-file links
    /// are trivial — just an `#anchor`. but cross-file links require computing
    /// a relative path between two html files that might be at different
    /// depths in the output tree. and then there's the really annoying case:
    /// the definition lives in `node_modules` or `lib.d.ts`. unless the user
    /// asked for `--externals`, there's no html page for us to link to. we
    /// could either break the link or degrade to a plain span — we chose the
    /// latter, because a broken link is worse than no link.
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
      const htmlFile = token.definitionFile.replace(/\.d\.ts$/, ".d.html").replace(/\.ts$/, ".html");
      href = `${htmlFile}#${anchor}`;
    }
    
    const idAttr = tokenId ? ` id="${tokenId}"` : "";
    return `<a${idAttr} href="${href}" class="${classAttr}">${text}</a>`;
  } else {
    /// everything else — keywords, operators, literals — just gets colored.
    const idAttr = tokenId ? ` id="${tokenId}"` : "";
    return `<span${idAttr} class="${classAttr}">${text}</span>`;
  }
}
