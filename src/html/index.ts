/// # html generation — main entry point
///
/// this is the orchestrator. it ties together:
///
/// - **layer extraction** (`extract.ts`) to split source into code and prose
/// - **the typescript language service** (`service.ts`) for type info
/// - **code rendering** (`render.ts`) for syntax-highlighted, cross-linked code
/// - **prose rendering** (`prose.ts`) for markdown
/// - **styles and scripts** (`styles.ts`) for CSS and client-side interactivity
///
/// there are two main entry points:
///
/// - `generateHtml` — single file. quick and simple.
/// - `generateHtmlMulti` — multiple files with cross-file linking and an
///   index page. this is what the CLI uses for directory mode.

import ts from "typescript";
import { relative, dirname } from "path";
import { extractLayers, illiterate } from "../extract.js";
import type { HtmlOptions, HtmlResult, MultiFileResult } from "./types.js";
import { defaultCss, highlightScript, tooltipScript } from "./styles.js";
import { renderProse, initMarked } from "./prose.js";
import { escapeHtml, highlightQuickInfo, sanitizeId, initHighlighter } from "./tokens.js";
import { createLanguageService, createMultiFileLanguageService } from "./service.js";
import { renderCodeBlock } from "./render.js";

export type { HtmlOptions, HtmlResult, MultiFileResult } from "./types.js";

/// ## generateHtml (single file)
///
/// the simplest case: one file in, one html page out. this is what you
/// get when you run `ts-literate html foo.ts > foo.html`. we spin up a
/// fresh language service just for this file (it'll still find `lib.d.ts`
/// for standard library types), extract the layers, and render them one
/// by one — prose through marked, code through the language service.

export async function generateHtml(filename: string, source: string, options: HtmlOptions = {}): Promise<HtmlResult> {
  await initHighlighter();
  await initMarked();

  const layers = extractLayers(source);
  const definitions = new Map<string, { file: string; line: number; column: number }>();
  const quickInfoMap = new Map<string, string>();
  const tokenIdCounter = { value: 0 };

  /// before we hand the source to the language service, we need to
  /// "illiterate" it — blank all the `///` lines to spaces. the language
  /// service would choke on prose-as-code, but we need to keep every
  /// byte position intact so the token spans we get back still line up
  /// with the original source.
  const code = illiterate(source);
  const service = createLanguageService(filename, code);

  let body = "";

  for (const layer of layers) {
    if (layer.role === "code") {
      body += renderCodeBlock(
        {
          service,
          filename,
          definitions,
          quickInfoMap,
          tokenIdCounter
        },
        layer
      );
    } else {
      body += await renderProse(layer.content);
    }
  }

  const html = wrapHtml(body, options, filename, quickInfoMap);
  return { html, definitions };
}

/// ## generateHtmlMulti (multi-file)
///
/// the full-featured path. takes a map of filename → source for every
/// file in the project, creates a shared language service so cross-file
/// references resolve, and generates html for each file plus an index page.
///
/// cross-file links are computed using relative paths between the output
/// html files. so if `src/foo.ts` references a type from `src/bar.ts`,
/// the link in `foo.html` will point to `bar.html#def-...`.

export async function generateHtmlMulti(files: Map<string, string>, options: HtmlOptions = {}): Promise<MultiFileResult> {
  await initHighlighter();
  await initMarked();

  const allDefinitions = new Map<string, { file: string; line: number; column: number }>();
  const externalFiles = new Set<string>();
  const results = new Map<string, string>();
  const projectRoot = options.projectRoot ?? process.cwd();

  /// the shared language service is the crucial difference from single-file
  /// mode. every file gets loaded into one service instance, so when file A
  /// imports from file B, the language service can resolve that reference
  /// and tell us exactly where in file B the symbol is defined.
  const service = createMultiFileLanguageService(files);

  const toHtmlPath = (tsPath: string) => {
    return tsPath.replace(/\.d\.ts$/, ".d.html").replace(/\.ts$/, ".html");
  };

  /// a file in `node_modules` might resolve to `../../node_modules/foo/index.ts`
  /// relative to the project root. if we naively used that as an output path,
  /// we'd write files *above* the output directory. so we strip leading `../`
  /// to flatten everything into the output tree.
  const stripDotDot = (p: string) => {
    while (p.startsWith("../")) p = p.slice(3);
    return p;
  };

  const toOutputRelative = (file: string) => {
    return stripDotDot(relative(projectRoot, file));
  };

  /// the link computation function. given a source file, a target file,
  /// and an anchor name, compute the relative href from the source's
  /// output html to the target's output html.
  const computeLink = (fromFile: string, toFile: string, anchor: string) => {
    const fromRel = toHtmlPath(toOutputRelative(fromFile));
    const toRel = toHtmlPath(toOutputRelative(toFile));
    const rel = relative(dirname(fromRel), toRel);
    return `${rel}#${anchor}`;
  };

  /// now we iterate through every file and render it. the order doesn't
  /// matter for correctness — definitions found in earlier files get
  /// registered in `allDefinitions`, but references to not-yet-seen
  /// definitions still work because the language service already knows
  /// about all files.
  for (const [filename, source] of files) {
    const layers = extractLayers(source);
    const quickInfoMap = new Map<string, string>();
    const tokenIdCounter = { value: 0 };

    let body = "";

    for (const layer of layers) {
      if (layer.role === "code") {
        body += renderCodeBlock(
          {
            service,
            filename,
            definitions: allDefinitions,
            externalFiles,
            knownFiles: files,
            computeLink,
            includeExternals: options.includeExternals ?? false,
            quickInfoMap,
            tokenIdCounter
          },
          layer
        );
      } else {
        body += await renderProse(layer.content);
      }
    }

    const html = wrapHtml(body, options, filename, quickInfoMap);
    results.set(filename, html);
  }

  /// after all files are rendered, we generate the index page — a table
  /// of contents that lists every symbol in the project with links to
  /// their definition sites. this is skipped for external-file builds
  /// (they piggyback on the index from the main build).
  if (!options.skipIndex) {
    const fileHtmlPaths = new Map<string, string>();
    for (const filename of files.keys()) {
      fileHtmlPaths.set(filename, toHtmlPath(toOutputRelative(filename)));
    }
    const indexHtml = generateIndex(files, fileHtmlPaths, service, projectRoot);
    results.set(projectRoot + "/index.html", indexHtml);
  }

  return { files: results, definitions: allDefinitions, externalFiles };
}

/// once we've rendered all the layers into a body string, we need to wrap
/// it in a real html document — `<head>`, styles, scripts, the works.
///
/// one interesting design choice here: tooltip content. we could store type
/// signatures in `data-` attributes on each token, but for a file with
/// hundreds of identifiers, that would bloat the html significantly (type
/// signatures can be long). instead, we emit hidden `<template>` elements
/// at the bottom of the page. the client-side script clones the right
/// template on hover. same result, much smaller html.

function wrapHtml(body: string, options: HtmlOptions, filename: string, quickInfoMap: Map<string, string>): string {
  const title = options.title ?? filename;
  /// styles can either be inlined (the default, so each page is self-contained)
  /// or loaded from an external file (useful if you want to customize the look
  /// without rebuilding).
  const css = options.cssFile ? `<link rel="stylesheet" href="${escapeHtml(options.cssFile)}">` : `<style>${defaultCss}</style>`;
  const script = options.includeHighlightScript !== false ? `<script>${highlightScript}</script>` : "";

  /// the tooltip script only gets included if there are actually tooltips to
  /// show. no point adding javascript to a page that won't use it.
  const tooltipSetupScript = quickInfoMap.size > 0 ? `<script>${tooltipScript}</script>` : "";

  /// each tooltip's content lives in a `<template>` element. templates are
  /// inert — the browser doesn't render them or execute their scripts. the
  /// tooltip script clones the right template's content on hover.
  let quickInfoTemplates = "";
  if (quickInfoMap.size > 0) {
    quickInfoTemplates = '<div id="quickinfo-templates" style="display:none">\n';
    for (const [id, info] of quickInfoMap) {
      quickInfoTemplates += `<template id="qi-${id}">${highlightQuickInfo(info)}</template>\n`;
    }
    quickInfoTemplates += "</div>";
  }

  /// for the page title, we strip the directory path — `/home/user/project/src/foo.ts`
  /// becomes just `foo.ts`. nobody wants a browser tab that says the full absolute path.
  const displayTitle = title.includes("/") ? title.split("/").pop()! : title;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(displayTitle)}</title>
  ${css}
</head>
<body>
${tooltipSetupScript}
<header class="watermark">
  <a href="/" class="watermark-left">index</a>
  <span class="watermark-right">ts-literate</span>
</header>
<div class="literate">
${body}
</div>
${script}
${quickInfoTemplates}
</body>
</html>`;
}

/// ## generateIndex
///
/// generates a symbol index page. for each source file, we ask the
/// language service for its navigation tree (the same data VS Code uses
/// for the outline view) and render it as a nested list of links.
///
/// this gives you an at-a-glance view of every exported function, class,
/// interface, type, and variable across the whole project, with links
/// to their definition sites.

export function generateIndex(files: Map<string, string>, fileHtmlPaths: Map<string, string>, service: ts.LanguageService, projectRoot: string): string {
  let body = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Index</title>
  <style>
body {
  font-family: system-ui, sans-serif;
  max-width: 100ch;
  margin: 2rem auto;
  padding: 0 1rem;
  line-height: 1.6;
}
h1 { border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
.file { margin: 1.5rem 0; }
.file-name { font-weight: 600; margin-bottom: 0.5rem; }
.file-name a { color: #0366d6; text-decoration: none; }
.file-name a:hover { text-decoration: underline; }
.tree { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; }
.tree ul { list-style: none; padding-left: 1.5rem; margin: 0; }
.tree > ul { padding-left: 0; }
.symbol { color: #24292e; }
.symbol a { color: inherit; text-decoration: none; }
.symbol a:hover { text-decoration: underline; }
.kind { color: #6a737d; font-size: 11px; margin-right: 0.5rem; }
.kind-function, .kind-method { color: #6f42c1; }
.kind-class, .kind-interface, .kind-type { color: #6f42c1; }
.kind-const, .kind-let, .kind-var { color: #005cc5; }
.kind-property { color: #005cc5; }
  </style>
</head>
<body>
<h1>Symbol Index</h1>
`;

  /// files are sorted alphabetically by their path relative to the project
  /// root. this gives the index a predictable order regardless of what order
  /// the filesystem returned them in.
  const sortedFiles = [...files.keys()].sort((a, b) => {
    const relA = a.replace(projectRoot, "");
    const relB = b.replace(projectRoot, "");
    return relA.localeCompare(relB);
  });

  for (const filename of sortedFiles) {
    const htmlPath = fileHtmlPaths.get(filename);
    if (!htmlPath) continue;

    const relPath = filename.replace(projectRoot + "/", "");
    /// `getNavigationTree` is the same API VS Code uses for the outline panel
    /// in the sidebar. it returns a tree of symbols — modules contain classes,
    /// classes contain methods, etc. we render it as nested html lists.
    const tree = service.getNavigationTree(filename);

    body += `<div class="file">`;
    body += `<div class="file-name"><a href="${htmlPath}">${escapeHtml(relPath)}</a></div>`;
    body += `<div class="tree">`;
    body += renderSymbolTree(tree, htmlPath, filename);
    body += `</div></div>\n`;
  }

  body += `</body></html>`;
  return body;
}

/// ### symbol tree rendering
///
/// the navigation tree from typescript is recursive — a module contains
/// classes, classes contain methods, methods contain locals. we filter
/// to only show "interesting" symbols (functions, classes, interfaces,
/// types, exported variables) and render them as a nested `<ul>`.

function renderSymbolTree(node: ts.NavigationTree, htmlPath: string, filename: string): string {
  if (node.kind === "module" && node.childItems) {
    return renderSymbolChildren(node.childItems, htmlPath, filename);
  }
  return "";
}

const topLevel = new Set(["var", "let", "const"]);
const structural = new Set(["function", "method", "class", "interface", "property", "type alias", "enum", "constructor"]);
/// we hide children of functions and methods to keep the index concise —
/// you don't usually want to see every local variable inside a function.
const hideChildren = new Set(["function", "method"]);

function renderSymbolChildren(items: readonly ts.NavigationTree[], htmlPath: string, filename: string, depth: number = 0): string {
  /// at the top level, we show both structural symbols (functions, classes,
  /// interfaces) and variable declarations (const, let, var). deeper in
  /// the tree, we drop the variable declarations — you don't want to see
  /// every `const` inside a function body.
  const filtered = depth === 0 ? items.filter(item => structural.has(item.kind) || topLevel.has(item.kind)) : items.filter(item => structural.has(item.kind));

  if (filtered.length === 0) return "";

  let html = "<ul>";
  for (const item of filtered) {
    const kindClass = `kind-${item.kind.replace(/ /g, "-")}`;
    /// the anchor id needs to match exactly what `renderToken` generates
    /// for the corresponding definition site. we use the filename and byte
    /// offset, sanitized for html id rules.
    const anchor = `def-${sanitizeId(filename)}-${item.nameSpan?.start ?? item.spans[0]?.start ?? 0}`;

    html += `<li class="symbol">`;
    html += `<span class="kind ${kindClass}">${item.kind}</span>`;
    html += `<a href="${htmlPath}#${anchor}">${escapeHtml(item.text)}</a>`;

    if (item.childItems && item.childItems.length > 0 && !hideChildren.has(item.kind)) {
      html += renderSymbolChildren(item.childItems, htmlPath, filename, depth + 1);
    }

    html += `</li>`;
  }
  html += "</ul>";
  return html;
}
