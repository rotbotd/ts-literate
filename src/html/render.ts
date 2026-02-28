/// # code block rendering
///
/// this is where the magic happens. for each code layer, we ask the
/// typescript language service for two things:
///
/// 1. **syntactic classifications** — the basic token types (keyword,
///    string, identifier, comment, etc.). these map directly to CSS
///    classes for syntax coloring.
/// 2. **semantic classifications** — richer type information that tells
///    us whether an identifier is a function, a class, a type parameter,
///    etc. this lets us color functions differently from variables, for
///    example, matching what VS Code does.
///
/// we then walk through the tokens, look up their definitions (for
/// cross-linking), fetch quickinfo (for hover tooltips), and render
/// each one as an html element.

import ts from "typescript";
import type { Layer } from "../extract.js";
import type { TokenInfo } from "./types.js";
import { isLinkable, escapeHtml, renderToken, type ComputeLink } from "./tokens.js";

/// ## semantic token decoding
///
/// there are two levels of "what is this token?" that typescript can tell
/// us. the syntactic level is cheap and obvious: keywords look like
/// keywords, strings look like strings. but the *semantic* level requires
/// actually type-checking the program. is `foo` a function or a variable?
/// you can't know from syntax alone.
///
/// typescript's semantic classification API encodes this information in a
/// peculiar way: a flat array of triples `[start, length, encoding]` where
/// the encoding packs the token type into bits 8 and up. we shift and
/// index to get a human-readable type name.

const semanticTokenTypes = [
  "class", "enum", "interface", "namespace", "type-parameter", 
  "type", "parameter", "variable", "enum-member", "property", 
  "function", "method"
];

function decodeSemanticClassification(encoded: number): string | undefined {
  const typeIdx = (encoded >> 8) - 1;
  if (typeIdx >= 0 && typeIdx < semanticTokenTypes.length) {
    return semanticTokenTypes[typeIdx];
  }
  return undefined;
}

/// ## RenderContext
///
/// rendering a code block requires a lot of ambient state — the language
/// service, the current filename, a growing map of definitions we've
/// discovered, maybe a set of external files we've noticed. rather than
/// threading all of this as separate arguments, we bundle it into a
/// context object that gets passed around.

export interface RenderContext {
  service: ts.LanguageService;
  filename: string;
  /// this map is *shared* across all files in a multi-file build. as we
  /// render each file, we discover definition sites and register them here.
  /// later files can then link back to definitions found in earlier files.
  definitions: Map<string, { file: string; line: number; column: number }>;
  externalFiles?: Set<string>;
  knownFiles?: Map<string, string>;
  computeLink?: ComputeLink;
  includeExternals?: boolean;
  /// we collect quickinfo (type signatures, jsdoc) during rendering and
  /// stash it here keyed by token id. once the page is fully rendered,
  /// `wrapHtml` turns this map into hidden `<template>` elements that the
  /// client-side tooltip script can clone on hover.
  quickInfoMap?: Map<string, string>;
  tokenIdCounter?: { value: number };
}

/// ## renderCodeBlock
///
/// this is the heart of ts-literate. given a code layer, we want to
/// produce html that looks like a code editor — colored tokens, clickable
/// identifiers, hover tooltips — but as a static page. the trick is that
/// we're reconstructing what VS Code does at runtime, but baking the
/// results into html at build time.

export function renderCodeBlock(ctx: RenderContext, layer: Layer): string {
  const { service, filename, definitions } = ctx;
  
  const program = service.getProgram();
  if (!program) return `<pre class="code">${escapeHtml(layer.content)}</pre>`;
  
  const sourceFile = program.getSourceFile(filename);
  if (!sourceFile) return `<pre class="code">${escapeHtml(layer.content)}</pre>`;
  
  /// first, we ask for the cheap stuff: syntactic classification. this is
  /// basically a tokenizer — it tells us where keywords, strings, comments,
  /// and identifiers are without doing any type analysis. fast, but it
  /// can't distinguish a function call from a variable reference.
  const syntacticSpans = service.getSyntacticClassifications(filename, {
    start: layer.offset,
    length: layer.originalLength
  });
  
  /// then we ask for the expensive stuff. semantic classification requires
  /// the full type checker to run. in return, we get the good stuff: this
  /// identifier isn't just an "identifier" — it's a *function*. that one's
  /// an *interface*. this lets us color them differently, just like VS Code
  /// would.
  const semanticResult = service.getEncodedSemanticClassifications(
    filename, 
    { start: layer.offset, length: layer.originalLength },
    ts.SemanticClassificationFormat.TwentyTwenty
  );
  
  const semanticTypes = new Map<number, string>();
  for (let i = 0; i < semanticResult.spans.length; i += 3) {
    const start = semanticResult.spans[i];
    const encoded = semanticResult.spans[i + 2];
    const semType = decodeSemanticClassification(encoded);
    if (semType) {
      semanticTypes.set(start, semType);
    }
  }
  
  /// now we marry the two: for each syntactic span, we look up whether
  /// there's a semantic type at that position. a token might be syntactically
  /// an "identifier" but semantically a "function" — it gets both classes,
  /// and the CSS can make functions purple while leaving plain variables black.
  const tokens: TokenInfo[] = [];
  
  for (const span of syntacticSpans) {
    const start = span.textSpan.start;
    const length = span.textSpan.length;
    const text = sourceFile.text.slice(start, start + length);
    /// the syntactic classification gives us one class (e.g., "identifier").
    /// if there's a semantic classification at the same position, we add that
    /// too (e.g., "function"). the token ends up with classes like
    /// `ts-identifier ts-function`, and the CSS can target either or both.
    const classes = [span.classificationType.toLowerCase().replace(/ /g, "-")];
    
    const semType = semanticTypes.get(start);
    if (semType) {
      classes.push(semType);
    }
    
    const token: TokenInfo = { start, length, text, classes };
    
    if (isLinkable(span.classificationType)) {
      /// this is where identifiers become hyperlinks. we ask the language
      /// service "where is this thing defined?" — the same operation as
      /// ctrl+click in VS Code. if the definition is right here at this
      /// position, we've found a definition site. if it's somewhere else,
      /// we've found a reference that should link to the definition.
      const defs = service.getDefinitionAtPosition(filename, start);
      if (defs && defs.length > 0) {
        const def = defs[0];
        const defId = `${def.fileName}:${def.textSpan.start}`;
        token.definitionId = defId;
        token.definitionFile = def.fileName;
        
        /// if this definition lives outside our project (not in `knownFiles`),
        /// it's an external — something in `node_modules` or typescript's
        /// own lib files. we track these so the CLI can optionally generate
        /// html pages for them too, making the cross-file links resolve.
        /// without `--externals`, these references will just degrade to
        /// plain spans in `renderToken`.
        if (ctx.externalFiles && ctx.knownFiles && !ctx.knownFiles.has(def.fileName)) {
          if (ctx.includeExternals) {
            ctx.externalFiles.add(def.fileName);
          }
        }
        
        /// if the definition points back to exactly where we are — same file,
        /// same position — then this token IS the definition. we register it
        /// in the shared definitions map so other files can link here.
        if (def.fileName === filename && def.textSpan.start === start) {
          token.isDefinition = true;
          const pos = sourceFile.getLineAndCharacterOfPosition(start);
          definitions.set(defId, {
            file: def.fileName,
            line: pos.line + 1,
            column: pos.character + 1
          });
        }
      }
      
      /// and while we're asking the language service about this token, we
      /// might as well grab the hover info too — the same tooltip you'd see
      /// in VS Code. we'll bake it into the page as a hidden template.
      if (ctx.quickInfoMap && ctx.tokenIdCounter) {
        const info = service.getQuickInfoAtPosition(filename, start);
        if (info && info.displayParts) {
          token.quickInfo = ts.displayPartsToString(info.displayParts);
        }
      }
    }
    
    tokens.push(token);
  }
  
  /// finally, we assemble the html. tokens don't cover the entire source
  /// text — there are gaps between them (whitespace, some operators, things
  /// the classifier didn't bother tagging). we walk through in order,
  /// emitting classified tokens as styled elements and filling the gaps
  /// with plain escaped text.
  tokens.sort((a, b) => a.start - b.start);
  
  let result = '<pre class="code">';
  let pos = layer.offset;
  const layerEnd = layer.offset + layer.originalLength;
  
  for (const token of tokens) {
    /// tokens from the classifier might extend beyond the current layer's
    /// boundaries (the classifier doesn't know about our layer system).
    /// we skip any that fall outside.
    if (token.start < layer.offset || token.start >= layerEnd) continue;
    
    /// between consecutive tokens, there's often plain text that the
    /// classifier didn't bother tagging — whitespace, some punctuation,
    /// etc. we emit it as plain escaped html to fill the gaps.
    if (token.start > pos) {
      const gap = sourceFile.text.slice(pos, token.start);
      result += escapeHtml(gap);
    }
    
    result += renderToken(token, filename, {
      knownFiles: ctx.knownFiles,
      computeLink: ctx.computeLink,
      includeExternals: ctx.includeExternals ?? false,
      quickInfoMap: ctx.quickInfoMap,
      tokenIdCounter: ctx.tokenIdCounter,
    });
    pos = token.start + token.length;
  }
  
  /// after the last token, there might still be trailing text — a closing
  /// brace, a newline, whitespace the classifier didn't cover. we flush
  /// whatever's left between the last token's end and the layer boundary.
  if (pos < layerEnd) {
    const gap = sourceFile.text.slice(pos, layerEnd);
    result += escapeHtml(gap);
  }
  
  /// trim trailing blank lines so code blocks don't have awkward whitespace
  /// at the bottom.
  result = result.replace(/\n+$/, "");
  
  result += "</pre>";
  return result;
}
