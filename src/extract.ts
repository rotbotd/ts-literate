// layer extraction from typescript files
//
// we scan for /// comments and treat them as prose (markdown).
// everything else is code. for type checking, we blank the ///
// lines to preserve positions.

export type LayerRole = "code" | "prose";

export interface Layer {
  role: LayerRole;
  content: string;
  // start offset in original file
  offset: number;
  // original length in source (for prose, includes the /// markers)
  originalLength: number;
}

// extract layers from a typescript file.
// /// comments become prose, everything else is code.

export function extractLayers(source: string): Layer[] {
  const layers: Layer[] = [];
  const lines = source.split("\n");
  
  let offset = 0;
  let currentRole: LayerRole | null = null;
  let currentContent = "";
  let currentOffset = 0;
  let currentOriginalLength = 0;
  
  function flush() {
    if (currentContent.length > 0 && currentRole !== null) {
      layers.push({
        role: currentRole,
        content: currentContent,
        offset: currentOffset,
        originalLength: currentOriginalLength
      });
    }
    currentContent = "";
    currentOriginalLength = 0;
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    const lineLength = line.length + (isLast ? 0 : 1); // +1 for \n
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    
    if (trimmed.startsWith("///")) {
      // prose line
      if (currentRole !== "prose") {
        flush();
        currentRole = "prose";
        currentOffset = offset;
      }
      
      // extract content after ///
      let proseContent = trimmed.slice(3);
      if (proseContent.startsWith(" ")) {
        proseContent = proseContent.slice(1);
      }
      
      currentContent += proseContent;
      currentOriginalLength += lineLength;
      if (!isLast) currentContent += "\n";
    } else {
      // code line
      if (currentRole !== "code") {
        flush();
        currentRole = "code";
        currentOffset = offset;
      }
      
      currentContent += line;
      currentOriginalLength += lineLength;
      if (!isLast) currentContent += "\n";
    }
    
    offset += lineLength;
  }
  
  flush();
  
  // filter out empty code blocks (just whitespace) between prose sections
  // and merge adjacent prose sections that were separated by blank lines
  const merged: Layer[] = [];
  
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    
    // skip empty code blocks (only whitespace)
    if (layer.role === "code" && layer.content.trim() === "") {
      // if we have a previous prose and next prose, merge them
      const prev = merged[merged.length - 1];
      const next = layers[i + 1];
      
      if (prev?.role === "prose" && next?.role === "prose") {
        // add blank lines to previous prose to represent the gap
        const blankLines = layer.content.split("\n").length - 1;
        prev.content += "\n".repeat(Math.max(1, blankLines));
        prev.originalLength += layer.originalLength;
      }
      continue;
    }
    
    // merge adjacent prose sections
    const prev = merged[merged.length - 1];
    if (layer.role === "prose" && prev?.role === "prose") {
      prev.content += layer.content;
      prev.originalLength += layer.originalLength;
      continue;
    }
    
    merged.push(layer);
  }
  
  return merged;
}

// blank prose lines to spaces for type checking.
// this preserves line/column positions.

export function illiterate(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("///")) {
      // blank the whole line
      result.push(" ".repeat(line.length));
    } else {
      result.push(line);
    }
  }
  
  return result.join("\n");
}
