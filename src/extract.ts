/// # layer extraction
///
/// this is the core parsing logic. we scan a typescript file line by line,
/// looking for `///` comments. lines that start with `///` (after optional
/// whitespace) are classified as **prose** — everything else is **code**.
///
/// the key insight is that we track byte offsets and original lengths for
/// each layer. this lets us later "illiterate" the file (blank the prose
/// lines to spaces) while keeping every character position intact, so the
/// typescript compiler's error messages still point to the correct line
/// and column in the original source.

export type LayerRole = "code" | "prose";

export interface Layer {
  role: LayerRole;
  content: string;
  /// the typescript language service doesn't think in terms of "line 5" or
  /// "the third function." it thinks in byte offsets from the start of the
  /// file. so when we later ask it "what token is at position 347?", we need
  /// to know where each layer lives in the original source. `offset` is that
  /// anchor point — the byte position where this layer begins.
  offset: number;
  /// here's a subtlety: for prose layers, the content we store has the `///`
  /// markers stripped away. `"/// hello world"` becomes just `"hello world"`.
  /// but the language service still sees the original file with the markers
  /// intact (well, blanked to spaces — more on that later). so we need to
  /// remember how many bytes this layer *actually* occupied in the source,
  /// markers and all. that's `originalLength`.
  originalLength: number;
}

/// the parser walks through the file line by line,
/// accumulating consecutive lines of the same role into a single layer.
/// when the role switches (code → prose or prose → code), we flush the
/// current accumulator and start a new layer.
///
/// after the initial pass, we do a merging step: if two prose sections
/// are separated only by blank code lines (empty lines between `///`
/// blocks), we merge them into one prose layer with the blank lines
/// represented as newlines. this prevents a single paragraph that spans
/// a blank line from being split into two separate rendered sections.

export function extractLayers(source: string): Layer[] {
  const layers: Layer[] = [];
  const lines = source.split("\n");
  
  let offset = 0;
  let currentRole: LayerRole | null = null;
  let currentContent = "";
  let currentOffset = 0;
  let currentOriginalLength = 0;
  
  /// as we scan lines, we accumulate content into a buffer. when the role
  /// switches — say we've been reading code and hit a `///` line — we need
  /// to package up what we've collected so far and start fresh. that's what
  /// `flush` does. it's the seam between layers.
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
    /// `split("\n")` eats the newlines, so we have to account for them
    /// when tracking byte positions. every line except the last one had a
    /// `\n` that we need to count.
    const lineLength = line.length + (isLast ? 0 : 1);
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    
    if (trimmed.startsWith("///")) {
      /// we've hit a prose line. if we were in the middle of accumulating
      /// code, that code layer is done — flush it and start a new prose
      /// layer. this is the moment where the document switches voices,
      /// from "here is what the computer sees" to "here is what the
      /// human wants to say."
      if (currentRole !== "prose") {
        flush();
        currentRole = "prose";
        currentOffset = offset;
      }
      
      /// the `///` marker is scaffolding — it tells us "this is prose" but
      /// it's not part of the prose itself. we strip it, plus one optional
      /// space after it (so `/// hello` becomes `hello`, not ` hello`).
      /// the result is clean markdown ready to be fed to a renderer.
      let proseContent = trimmed.slice(3);
      if (proseContent.startsWith(" ")) {
        proseContent = proseContent.slice(1);
      }
      
      currentContent += proseContent;
      currentOriginalLength += lineLength;
      if (!isLast) currentContent += "\n";
    } else {
      /// and here's the mirror image — a regular code line. if we were
      /// reading prose, flush it and switch back to code.
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
  
  /// ### merging pass
  ///
  /// after the initial extraction, we clean up the layer list. the problem
  /// is that a blank line between two `///` blocks creates a tiny code layer
  /// (containing just whitespace) that splits what should be a single prose
  /// section. we detect this pattern and merge the prose layers, absorbing
  /// the blank lines.
  const merged: Layer[] = [];
  
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    
    if (layer.role === "code" && layer.content.trim() === "") {
      const prev = merged[merged.length - 1];
      const next = layers[i + 1];
      
      if (prev?.role === "prose" && next?.role === "prose") {
        /// blank code between two prose sections → merge them, inserting
        /// newlines to represent the visual gap.
        const blankLines = layer.content.split("\n").length - 1;
        prev.content += "\n".repeat(Math.max(1, blankLines));
        prev.originalLength += layer.originalLength;
      }
      continue;
    }
    
    /// adjacent prose layers (which shouldn't normally happen after the
    /// above, but just in case) also get merged.
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

/// ## illiterate
///
/// this is the function that makes literate typescript compatible with
/// the regular typescript compiler. it takes the original source and
/// replaces every `///` line with spaces of the same length. the result
/// is valid typescript (the prose is gone) but every character position
/// is preserved, so error messages, source maps, and language service
/// queries all still work.
///
/// the name comes from agda's terminology: to "illiterate" a literate
/// file is to strip the prose and leave only the code.

export function illiterate(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("///")) {
      result.push(" ".repeat(line.length));
    } else {
      result.push(line);
    }
  }
  
  return result.join("\n");
}
