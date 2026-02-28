// code block rendering with syntax highlighting and links

import ts from "typescript";
import type { Layer } from "../extract.js";
import type { TokenInfo } from "./types.js";
import { isLinkable, escapeHtml, renderToken, type ComputeLink } from "./tokens.js";

// semantic token types from typescript's classifier2020.ts
const semanticTokenTypes = [
  "class", "enum", "interface", "namespace", "type-parameter", 
  "type", "parameter", "variable", "enum-member", "property", 
  "function", "method"
];

// decode semantic classification from 2020 format
function decodeSemanticClassification(encoded: number): string | undefined {
  const typeIdx = (encoded >> 8) - 1;
  if (typeIdx >= 0 && typeIdx < semanticTokenTypes.length) {
    return semanticTokenTypes[typeIdx];
  }
  return undefined;
}

export interface RenderContext {
  service: ts.LanguageService;
  filename: string;
  definitions: Map<string, { file: string; line: number; column: number }>;
  // optional: for multi-file mode with external tracking
  externalFiles?: Set<string>;
  knownFiles?: Map<string, string>;
  computeLink?: ComputeLink;
  includeExternals?: boolean;
  // quickinfo collection - maps token id to quickinfo text
  quickInfoMap?: Map<string, string>;
  // counter for generating unique token ids
  tokenIdCounter?: { value: number };
}

// render a code block with syntax highlighting and links
export function renderCodeBlock(ctx: RenderContext, layer: Layer): string {
  const { service, filename, definitions } = ctx;
  
  const program = service.getProgram();
  if (!program) return `<pre class="code">${escapeHtml(layer.content)}</pre>`;
  
  const sourceFile = program.getSourceFile(filename);
  if (!sourceFile) return `<pre class="code">${escapeHtml(layer.content)}</pre>`;
  
  const syntacticSpans = service.getSyntacticClassifications(filename, {
    start: layer.offset,
    length: layer.originalLength
  });
  
  // get semantic classifications for better token types (method, function, etc)
  const semanticResult = service.getEncodedSemanticClassifications(
    filename, 
    { start: layer.offset, length: layer.originalLength },
    ts.SemanticClassificationFormat.TwentyTwenty
  );
  
  // build a map of start position -> semantic type
  const semanticTypes = new Map<number, string>();
  for (let i = 0; i < semanticResult.spans.length; i += 3) {
    const start = semanticResult.spans[i];
    const encoded = semanticResult.spans[i + 2];
    const semType = decodeSemanticClassification(encoded);
    if (semType) {
      semanticTypes.set(start, semType);
    }
  }
  
  const tokens: TokenInfo[] = [];
  
  for (const span of syntacticSpans) {
    const start = span.textSpan.start;
    const length = span.textSpan.length;
    const text = sourceFile.text.slice(start, start + length);
    const classes = [span.classificationType.toLowerCase().replace(/ /g, "-")];
    
    // add semantic type if available (more precise than syntactic)
    const semType = semanticTypes.get(start);
    if (semType) {
      classes.push(semType);
    }
    
    const token: TokenInfo = { start, length, text, classes };
    
    if (isLinkable(span.classificationType)) {
      const defs = service.getDefinitionAtPosition(filename, start);
      if (defs && defs.length > 0) {
        const def = defs[0];
        const defId = `${def.fileName}:${def.textSpan.start}`;
        token.definitionId = defId;
        token.definitionFile = def.fileName;
        
        // track external files if in multi-file mode
        if (ctx.externalFiles && ctx.knownFiles && !ctx.knownFiles.has(def.fileName)) {
          if (ctx.includeExternals) {
            ctx.externalFiles.add(def.fileName);
          }
        }
        
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
      
      // get quickinfo for tooltip
      if (ctx.quickInfoMap && ctx.tokenIdCounter) {
        const info = service.getQuickInfoAtPosition(filename, start);
        if (info && info.displayParts) {
          token.quickInfo = ts.displayPartsToString(info.displayParts);
        }
      }
    }
    
    tokens.push(token);
  }
  
  tokens.sort((a, b) => a.start - b.start);
  
  let result = '<pre class="code">';
  let pos = layer.offset;
  const layerEnd = layer.offset + layer.originalLength;
  
  for (const token of tokens) {
    if (token.start < layer.offset || token.start >= layerEnd) continue;
    
    // fill gap before this token
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
  
  // fill gap after last token
  if (pos < layerEnd) {
    const gap = sourceFile.text.slice(pos, layerEnd);
    result += escapeHtml(gap);
  }
  
  // trim trailing blank lines from code blocks
  result = result.replace(/\n+$/, "");
  
  result += "</pre>";
  return result;
}
