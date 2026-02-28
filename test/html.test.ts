import { describe, it, expect } from "vitest";
import { generateHtml } from "../src/html.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("html generation", () => {
  it("generates html with syntax highlighting and links", async () => {
    const source = readFileSync(join(__dirname, "example.ts"), "utf-8");
    const { html } = await generateHtml("test/example.ts", source, {
      title: "Example",
      includeHighlightScript: true,
    });
    
    await expect(html).toMatchFileSnapshot("__snapshots__/example.html");
  });

  it("handles files with errors", async () => {
    const source = readFileSync(join(__dirname, "error.ts"), "utf-8");
    const { html } = await generateHtml("test/error.ts", source, {
      title: "Error Example",
      includeHighlightScript: false,
    });
    
    await expect(html).toMatchFileSnapshot("__snapshots__/error.html");
  });

  it("links import strings", async () => {
    const source = readFileSync(join(__dirname, "imports.ts"), "utf-8");
    const { html } = await generateHtml("test/imports.ts", source, {
      title: "Imports",
      includeHighlightScript: false,
    });
    
    // import strings should be wrapped in <a> tags
    expect(html).toContain('<a href=');
    expect(html).toContain('class="ts-string"');
    expect(html).toContain('./example.js');
  });

  it("handles indented prose comments inside functions", async () => {
    const source = readFileSync(join(__dirname, "indented-prose.ts"), "utf-8");
    const { html } = await generateHtml("test/indented-prose.ts", source, {
      title: "Indented Prose",
      includeHighlightScript: false,
    });
    
    // should have multiple prose sections from inside the function
    expect(html).toContain('<div class="prose">');
    expect(html).toContain('This prose is inside the function body');
    expect(html).toContain('Even more nested prose');
    
    // code blocks should exist between prose
    expect(html).toContain('<pre class="code">');
    expect(html).toContain('>doubled<');  // variable name in a span
  });
});
