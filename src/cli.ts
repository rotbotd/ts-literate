#!/usr/bin/env node

// ts-literate CLI
//
// usage:
//   ts-literate html file.ts           generate HTML output
//   ts-literate html dir/ [outdir]     generate HTML for all .ts files
//   ts-literate html dir/ --externals  include node_modules/lib files
//   ts-literate serve dir/ [port]      preview server with live reload

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, watch } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { createServer } from "http";
import { generateHtml, generateHtmlMulti } from "./html.js";

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`ts-literate - literate programming for typescript

/// comments become prose, everything else is code.

usage:
  ts-literate html <file.ts>                  generate HTML for a single file
  ts-literate html <dir/> [outdir]            generate HTML for all .ts files
  ts-literate html <dir/> [outdir] --externals  include external deps

examples:
  ts-literate html src/index.ts > index.html
  ts-literate html src/ docs/
  ts-literate html src/ docs/ --externals
`);
  process.exit(1);
}

const [command, target, ...rest] = args;
const includeExternals = rest.includes("--externals");
const outDir = rest.find(a => !a.startsWith("--"));

switch (command) {
  case "html": {
    const stat = statSync(target);

    if (stat.isFile()) {
      // single file
      const source = readFileSync(target, "utf-8");
      const { html } = await generateHtml(target, source, {
        title: basename(target, ".ts"),
        includeHighlightScript: true
      });
      console.log(html);
    } else if (stat.isDirectory()) {
      // directory - find all .ts files
      const projectRoot = resolve(target);
      const files = findTsFiles(target);
      const fileMap = new Map<string, string>();

      for (const file of files) {
        fileMap.set(resolve(file), readFileSync(file, "utf-8"));
      }

      const result = await generateHtmlMulti(fileMap, {
        includeHighlightScript: true,
        projectRoot,
        includeExternals
      });

      // write output files
      const outputDir = outDir ?? join(target, "html");
      mkdirSync(outputDir, { recursive: true });

      for (const [filename, html] of result.files) {
        const outPath = toOutputPath(filename, projectRoot, outputDir);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, html);
        console.log(`wrote ${outPath}`);
      }

      // if including externals, process them too
      if (includeExternals && result.externalFiles.size > 0) {
        console.log(`\nprocessing ${result.externalFiles.size} external files...`);
        await processExternals(result.externalFiles, projectRoot, outputDir);
      }
    }
    break;
  }

  case "serve": {
    const port = parseInt(rest.find(a => /^\d+$/.test(a)) || "") || 3000;
    const serveOutDir = rest.find(a => !a.startsWith("--") && !/^\d+$/.test(a)) || join(target, ".ts-literate");
    await startServer(target, serveOutDir, port);
    break;
  }

  default:
    console.error(`unknown command: ${command}`);
    process.exit(1);
}

function toHtmlPath(p: string): string {
  return p.replace(/\.d\.ts$/, ".d.html").replace(/\.ts$/, ".html");
}

// convert a file path to an output path, stripping ../ prefixes
function toOutputPath(file: string, projectRoot: string, outputDir: string): string {
  let rel = relative(projectRoot, file);

  // strip ../ prefixes
  while (rel.startsWith("../")) {
    rel = rel.slice(3);
  }

  return join(outputDir, toHtmlPath(rel));
}

function findTsFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      // skip node_modules and hidden dirs
      if (!entry.startsWith(".") && entry !== "node_modules") {
        results.push(...findTsFiles(path));
      }
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      results.push(path);
    }
  }

  return results;
}

async function processExternals(externalFiles: Set<string>, projectRoot: string, outputDir: string): Promise<void> {
  // collect all external files and their transitive dependencies
  const toProcess = new Set(externalFiles);
  const processed = new Set<string>();
  const allExternals = new Map<string, string>();

  while (toProcess.size > 0) {
    const batch = [...toProcess];
    toProcess.clear();

    for (const file of batch) {
      if (processed.has(file)) continue;
      processed.add(file);

      if (!existsSync(file)) {
        console.log(`  skip ${file} (not found)`);
        continue;
      }

      const source = readFileSync(file, "utf-8");
      allExternals.set(file, source);
    }
  }

  if (allExternals.size === 0) return;

  // generate HTML for all externals (skip index since main files already made one)
  const result = await generateHtmlMulti(allExternals, {
    includeHighlightScript: true,
    projectRoot,
    includeExternals: true,
    skipIndex: true
  });

  for (const [filename, html] of result.files) {
    const outPath = toOutputPath(filename, projectRoot, outputDir);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);
    console.log(`wrote ${outPath}`);
  }
}

async function startServer(srcDir: string, outDir: string, port: number): Promise<void> {
  const projectRoot = resolve(srcDir);
  const outputDir = resolve(outDir);

  // cache of file contents for change detection
  const fileCache = new Map<string, string>();
  
  // debounce timer for batching rapid changes
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingChanges = new Set<string>();

  // generate initial docs to disk (full build)
  console.log("generating docs...");
  const files = findTsFiles(srcDir);
  const fileMap = new Map<string, string>();

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const absPath = resolve(file);
    fileMap.set(absPath, content);
    fileCache.set(absPath, content);
  }

  const result = await generateHtmlMulti(fileMap, {
    includeHighlightScript: true,
    projectRoot,
    includeExternals
  });

  mkdirSync(outputDir, { recursive: true });

  for (const [filename, html] of result.files) {
    const outPath = toOutputPath(filename, projectRoot, outputDir);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);
  }

  // process externals if requested
  if (includeExternals && result.externalFiles.size > 0) {
    console.log(`processing ${result.externalFiles.size} external files...`);
    await processExternals(result.externalFiles, projectRoot, outputDir);
  }

  console.log(`  ${result.files.size} files written to ${outputDir}`);

  const sseClients: Set<import("http").ServerResponse> = new Set();

  // watch for changes
  console.log("watching for changes...");
  watch(srcDir, { recursive: true }, async (event, filename) => {
    if (!filename || !filename.endsWith(".ts") || filename.endsWith(".d.ts")) {
      return;
    }

    const absPath = resolve(srcDir, filename);
    
    // check if file actually changed (content differs)
    if (!existsSync(absPath)) {
      // file deleted - could handle this but for now just skip
      return;
    }

    const newContent = readFileSync(absPath, "utf-8");
    const oldContent = fileCache.get(absPath);

    if (newContent === oldContent) {
      // no actual change
      return;
    }

    // add to pending changes
    pendingChanges.add(absPath);
    fileCache.set(absPath, newContent);

    // debounce - wait 100ms for more changes before regenerating
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      const changedFiles = [...pendingChanges];
      pendingChanges.clear();

      console.log(`\n${changedFiles.length} file(s) changed:`);
      for (const f of changedFiles) {
        console.log(`  ${relative(projectRoot, f)}`);
      }

      // regenerate only changed files
      await regenerateFiles(changedFiles, projectRoot, outputDir, fileCache);

      // notify SSE clients
      for (const client of sseClients) {
        client.write(`data: reload\n\n`);
      }
    }, 100);
  });

  const server = createServer((req, res) => {
    const url = req.url || "/";

    // SSE endpoint for live reload
    if (url === "/__reload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // serve from output directory
    let path = url === "/" ? "/index.html" : url;
    if (!path.endsWith(".html")) path += ".html";

    const filePath = join(outputDir, path);

    if (existsSync(filePath)) {
      const html = readFileSync(filePath, "utf-8");
      // inject live reload script
      const injected = html.replace(
        "</body>",
        `<script>
new EventSource("/__reload").onmessage = () => location.reload();
</script></body>`
      );
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(injected);
    } else {
      // try directory index
      const indexPath = join(outputDir, url.replace(/\/$/, ""), "index.html");
      if (existsSync(indexPath)) {
        const html = readFileSync(indexPath, "utf-8");
        const injected = html.replace(
          "</body>",
          `<script>
new EventSource("/__reload").onmessage = () => location.reload();
</script></body>`
        );
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(injected);
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    }
  });

  server.listen(port, () => {
    console.log(`\nserving at http://localhost:${port}/`);
  });

  // keep running
  await new Promise(() => {});
}

// regenerate only the changed files
async function regenerateFiles(
  changedFiles: string[],
  projectRoot: string,
  outputDir: string,
  fileCache: Map<string, string>
): Promise<void> {
  const startTime = Date.now();

  // build file map from cache (all files needed for cross-references)
  const fileMap = new Map<string, string>();
  for (const [path, content] of fileCache) {
    fileMap.set(path, content);
  }

  // generate HTML - the service needs all files for cross-references
  // but we only write the changed ones
  const result = await generateHtmlMulti(fileMap, {
    includeHighlightScript: true,
    projectRoot,
    includeExternals
  });

  // only write the changed files + index
  let writtenCount = 0;
  const changedSet = new Set(changedFiles);

  for (const [filename, html] of result.files) {
    // always regenerate index, or if file was in changed set
    const isIndex = filename.endsWith("/index.html");
    if (isIndex || changedSet.has(filename)) {
      const outPath = toOutputPath(filename, projectRoot, outputDir);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, html);
      writtenCount++;
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`  regenerated ${writtenCount} file(s) in ${elapsed}ms`);
}
