// html generation - main entry point
//
// we use typescript's language service to get:
// - syntax classification (keyword, string, identifier, etc.)
// - definition sites for cross-referencing
//
// prose sections (from /// comments) are rendered as markdown-ish HTML.
// code sections get syntax highlighting and identifier links.

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

// generate HTML for a single typescript file

export async function generateHtml(filename: string, source: string, options: HtmlOptions = {}): Promise<HtmlResult> {
  await initHighlighter();
  await initMarked();

  const layers = extractLayers(source);
  const definitions = new Map<string, { file: string; line: number; column: number }>();
  const quickInfoMap = new Map<string, string>();
  const tokenIdCounter = { value: 0 };

  // use illiterated source for the language service (/// lines blanked)
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

// generate HTML for multiple files with cross-file links

export async function generateHtmlMulti(files: Map<string, string>, options: HtmlOptions = {}): Promise<MultiFileResult> {
  await initHighlighter();
  await initMarked();

  const allDefinitions = new Map<string, { file: string; line: number; column: number }>();
  const externalFiles = new Set<string>();
  const results = new Map<string, string>();
  const projectRoot = options.projectRoot ?? process.cwd();

  const service = createMultiFileLanguageService(files);

  // helper to convert .ts path to .html path
  const toHtmlPath = (tsPath: string) => {
    return tsPath.replace(/\.d\.ts$/, ".d.html").replace(/\.ts$/, ".html");
  };

  // strip ../ from relative paths
  const stripDotDot = (p: string) => {
    while (p.startsWith("../")) p = p.slice(3);
    return p;
  };

  // normalize path relative to project root, stripping ../
  const toOutputRelative = (file: string) => {
    return stripDotDot(relative(projectRoot, file));
  };

  // compute relative link from one file to another
  const computeLink = (fromFile: string, toFile: string, anchor: string) => {
    const fromRel = toHtmlPath(toOutputRelative(fromFile));
    const toRel = toHtmlPath(toOutputRelative(toFile));
    const rel = relative(dirname(fromRel), toRel);
    return `${rel}#${anchor}`;
  };

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

  // generate index page (unless skipped, e.g. for external files)
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

// wrap body content in full HTML document
function wrapHtml(body: string, options: HtmlOptions, filename: string, quickInfoMap: Map<string, string>): string {
  const title = options.title ?? filename;
  const css = options.cssFile ? `<link rel="stylesheet" href="${escapeHtml(options.cssFile)}">` : `<style>${defaultCss}</style>`;
  const script = options.includeHighlightScript !== false ? `<script>${highlightScript}</script>` : "";

  // build quickinfo templates - pre-rendered highlighted html
  const tooltipSetupScript = quickInfoMap.size > 0 ? `<script>${tooltipScript}</script>` : "";

  let quickInfoTemplates = "";
  if (quickInfoMap.size > 0) {
    quickInfoTemplates = '<div id="quickinfo-templates" style="display:none">\n';
    for (const [id, info] of quickInfoMap) {
      quickInfoTemplates += `<template id="qi-${id}">${highlightQuickInfo(info)}</template>\n`;
    }
    quickInfoTemplates += "</div>";
  }

  // use just the basename for the title by default
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

// generate index page with symbol trees for all files
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

  const sortedFiles = [...files.keys()].sort((a, b) => {
    const relA = a.replace(projectRoot, "");
    const relB = b.replace(projectRoot, "");
    return relA.localeCompare(relB);
  });

  for (const filename of sortedFiles) {
    const htmlPath = fileHtmlPaths.get(filename);
    if (!htmlPath) continue;

    const relPath = filename.replace(projectRoot + "/", "");
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

function renderSymbolTree(node: ts.NavigationTree, htmlPath: string, filename: string): string {
  // skip the root "module" node, just render children
  if (node.kind === "module" && node.childItems) {
    return renderSymbolChildren(node.childItems, htmlPath, filename);
  }
  return "";
}

const topLevel = new Set(["var", "let", "const"]);
const structural = new Set(["function", "method", "class", "interface", "property", "type alias", "enum", "constructor"]);
const hideChildren = new Set(["function", "method"]);

function renderSymbolChildren(items: readonly ts.NavigationTree[], htmlPath: string, filename: string, depth: number = 0): string {
  const filtered = depth === 0 ? items.filter(item => structural.has(item.kind) || topLevel.has(item.kind)) : items.filter(item => structural.has(item.kind));

  if (filtered.length === 0) return "";

  let html = "<ul>";
  for (const item of filtered) {
    const kindClass = `kind-${item.kind.replace(/ /g, "-")}`;
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
