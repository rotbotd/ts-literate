#!/usr/bin/env node

/// # CLI
///
/// the command-line interface for ts-literate. two main commands:
///
/// - **`ts-literate html`** — generate static html from typescript files.
///   works on single files (output to stdout) or directories (output to a folder).
/// - **`ts-literate serve`** — a dev server with live reload. watches your
///   source files and regenerates html on change, pushing updates to the
///   browser via server-sent events.
///
/// ## usage
///
/// ```bash
/// ts-literate html file.ts           # single file → stdout
/// ts-literate html src/ docs/        # directory → docs/
/// ts-literate html src/ --externals  # include node_modules in output
/// ts-literate serve src/             # dev server on :3000
/// ts-literate serve src/ 8080        # dev server on :8080
/// ```

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

/// ## command dispatch
///
/// the CLI is deliberately simple — just two commands, no config files,
/// no plugins. the unix philosophy: do one thing, pipe the rest.

switch (command) {
  case "html": {
    const stat = statSync(target);

    if (stat.isFile()) {
      /// when you point it at a single file, the html goes to stdout.
      /// this lets you pipe it wherever you want: into a file, into
      /// another tool, into `/dev/null` if you're feeling nihilistic.
      const source = readFileSync(target, "utf-8");
      const { html } = await generateHtml(target, source, {
        title: basename(target, ".ts"),
        includeHighlightScript: true
      });
      console.log(html);
    } else if (stat.isDirectory()) {
      /// directory mode is the interesting one. we find every `.ts` file in
      /// the tree (skipping `node_modules` and `.d.ts` files), load them all
      /// into a shared language service so cross-file references resolve, and
      /// generate a whole interconnected set of html pages plus a symbol index.
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

      const outputDir = outDir ?? join(target, "html");
      mkdirSync(outputDir, { recursive: true });

      for (const [filename, html] of result.files) {
        const outPath = toOutputPath(filename, projectRoot, outputDir);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, html);
        console.log(`wrote ${outPath}`);
      }

      /// if `--externals` was passed and some external files were referenced,
      /// we process them in a second pass. this generates html for things
      /// like `node_modules/typescript/lib/lib.es5.d.ts` so that links to
      /// standard library types actually resolve.
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

/// ## helper functions
///
/// these small utilities handle the mechanical work of mapping between
/// the typescript world (`.ts` files in a source tree) and the html
/// world (`.html` files in an output directory).

/// the simplest mapping: `foo.ts` becomes `foo.html`, `foo.d.ts` becomes
/// `foo.d.html`. we handle `.d.ts` first because `.ts` would match it too.
function toHtmlPath(p: string): string {
  return p.replace(/\.d\.ts$/, ".d.html").replace(/\.ts$/, ".html");
}

/// files can end up with weird relative paths — an external dependency
/// might resolve to `../../node_modules/foo/index.ts` relative to the
/// project root. if we naively joined that with the output dir, we'd
/// write files *outside* the output directory. stripping `../` prefixes
/// keeps everything contained.
function toOutputPath(file: string, projectRoot: string, outputDir: string): string {
  let rel = relative(projectRoot, file);

  while (rel.startsWith("../")) {
    rel = rel.slice(3);
  }

  return join(outputDir, toHtmlPath(rel));
}

/// to process a whole directory, we need to find the typescript files in it.
/// but not *all* of them — `node_modules` alone could contain thousands of
/// `.ts` files we didn't write, and `.d.ts` files are generated artifacts
/// that shouldn't be treated as source prose. hidden directories like `.git`
/// are obviously out too. what's left is the code the author actually wrote.
function findTsFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      if (!entry.startsWith(".") && entry !== "node_modules") {
        results.push(...findTsFiles(path));
      }
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      results.push(path);
    }
  }

  return results;
}

/// ## external file processing
///
/// when `--externals` is enabled, we collect all files outside the project
/// that were referenced (via go-to-definition) and generate html for them
/// too. this means links to `Array`, `Promise`, `Map`, etc. will resolve
/// to rendered pages of the typescript lib files.
///
/// in practice this generates a LOT of html (the full lib.es5.d.ts is huge),
/// so it's opt-in.

async function processExternals(externalFiles: Set<string>, projectRoot: string, outputDir: string): Promise<void> {
  /// external files can reference *other* external files (lib.es5.d.ts
  /// references lib.es2015.d.ts, which references lib.es2015.core.d.ts,
  /// and so on). so we process them in a loop: each batch might discover
  /// new externals that need to be added to the next batch. in practice
  /// this converges quickly — the typescript lib files form a shallow DAG.
  const toProcess = new Set(externalFiles);
  const processed = new Set<string>();
  const allExternals = new Map<string, string>();

  while (toProcess.size > 0) {
    const batch = [...toProcess];
    toProcess.clear();

    for (const file of batch) {
      if (processed.has(file)) continue;
      processed.add(file);

      /// some referenced files might not exist on disk — for example, if
      /// a type reference points to a package that isn't installed. we skip
      /// those rather than crashing.
      if (!existsSync(file)) {
        console.log(`  skip ${file} (not found)`);
        continue;
      }

      const source = readFileSync(file, "utf-8");
      allExternals.set(file, source);
    }
  }

  if (allExternals.size === 0) return;

  /// we already have an index page from the main build, so we skip
  /// generating another one. the externals just need their html pages
  /// so the cross-file links have somewhere to land.
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

/// ## dev server
///
/// the serve command does a full initial build, then watches for changes
/// and incrementally regenerates affected files. it serves the output
/// directory over http and uses server-sent events (SSE) to tell the
/// browser to reload when files change.
///
/// the regeneration is debounced — if multiple files change within 100ms
/// (which happens when your editor does a save-all), they're batched
/// into a single rebuild.

async function startServer(srcDir: string, outDir: string, port: number): Promise<void> {
  const projectRoot = resolve(srcDir);
  const outputDir = resolve(outDir);

  /// we keep a cache of every file's content so we can detect when a file
  /// has *actually* changed vs when the editor just touched it without
  /// modifying anything. this avoids unnecessary rebuilds.
  const fileCache = new Map<string, string>();
  
  /// multiple files can change in rapid succession (e.g., your editor does
  /// a "save all" or a git checkout touches many files at once). rather than
  /// rebuilding once per file, we collect changes and rebuild after a 100ms
  /// quiet period.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingChanges = new Set<string>();

  /// ### initial build
  console.log("generating docs...");
  const files = findTsFiles(srcDir);
  const fileMap = new Map<string, string>();

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const absPath = resolve(file);
    fileMap.set(absPath, content);
    fileCache.set(absPath, content);
  }

  /// the initial build generates html for every file at once. this is
  /// slower than incremental rebuilds but ensures all cross-file links
  /// are correct from the start.
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

  if (includeExternals && result.externalFiles.size > 0) {
    console.log(`processing ${result.externalFiles.size} external files...`);
    await processExternals(result.externalFiles, projectRoot, outputDir);
  }

  console.log(`  ${result.files.size} files written to ${outputDir}`);

  const sseClients: Set<import("http").ServerResponse> = new Set();

  /// ### file watcher
  ///
  /// we use node's built-in `fs.watch` with `recursive: true` to monitor
  /// the source directory. when a `.ts` file changes, we check if its
  /// content actually differs from the cached version (editors sometimes
  /// trigger save events without real changes), then add it to the pending
  /// set and start the debounce timer.
  console.log("watching for changes...");
  watch(srcDir, { recursive: true }, async (event, filename) => {
    /// we only care about `.ts` files (not `.d.ts`, not `.js`, not anything
    /// else). and sometimes the watcher fires for files that were deleted
    /// mid-operation, so we check existence too.
    if (!filename || !filename.endsWith(".ts") || filename.endsWith(".d.ts")) {
      return;
    }

    const absPath = resolve(srcDir, filename);
    
    if (!existsSync(absPath)) {
      return;
    }

    /// the cheapest possible change detection: compare the full file content
    /// against our cache. editors like VS Code sometimes trigger "save" events
    /// even when no bytes changed (e.g., format-on-save with no formatting
    /// changes). this avoids a full rebuild for those no-ops.
    const newContent = readFileSync(absPath, "utf-8");
    const oldContent = fileCache.get(absPath);

    if (newContent === oldContent) {
      return;
    }

    pendingChanges.add(absPath);
    fileCache.set(absPath, newContent);

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

      await regenerateFiles(changedFiles, projectRoot, outputDir, fileCache);

      /// once the html is written to disk, every browser tab that's
      /// connected to the SSE endpoint needs to know about it.
      for (const client of sseClients) {
        client.write(`data: reload\n\n`);
      }
    }, 100);
  });

  /// ### http server
  ///
  /// a minimal http server that serves the generated html files and
  /// provides an SSE endpoint at `/__reload` for live reload.
  const server = createServer((req, res) => {
    const url = req.url || "/";

    if (url === "/__reload") {
      /// live reload needs a way to push from server to browser. websockets
      /// would work but they're overkill — we only need one-way communication.
      /// server-sent events are perfect: the browser opens a long-lived HTTP
      /// connection, and we write `data: reload\n\n` whenever something
      /// changes. the browser reconnects automatically if the connection
      /// drops, so we don't even need heartbeat logic.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    /// for everything else, we serve html from the output directory. but
    /// we can't serve the files as-is — they don't know about our SSE
    /// endpoint. so we do a sneaky string replacement: right before
    /// `</body>`, we inject a tiny script that connects to `/__reload`
    /// and calls `location.reload()` when it gets an event.
    /// we assume all routes are html pages. `/foo` becomes `/foo.html`,
    /// `/` becomes `/index.html`. this means you can navigate to
    /// `localhost:3000/src/cli` without typing the extension.
    let path = url === "/" ? "/index.html" : url;
    if (!path.endsWith(".html")) path += ".html";

    const filePath = join(outputDir, path);

    if (existsSync(filePath)) {
      const html = readFileSync(filePath, "utf-8");
      const injected = html.replace(
        "</body>",
        `<script>
new EventSource("/__reload").onmessage = () => location.reload();
</script></body>`
      );
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(injected);
    } else {
      /// if `/foo` doesn't match `/foo.html`, maybe it's a directory with
      /// an `index.html` inside it. this lets you navigate to `/src/html/`
      /// and get the index for that subdirectory.
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

  await new Promise(() => {});
}

/// ## incremental regeneration
///
/// when files change, we don't regenerate everything from scratch. we
/// rebuild the full language service (it needs all files for cross-references),
/// but only write the changed files plus the index to disk. this keeps
/// rebuilds fast even for large projects.

async function regenerateFiles(
  changedFiles: string[],
  projectRoot: string,
  outputDir: string,
  fileCache: Map<string, string>
): Promise<void> {
  const startTime = Date.now();

  /// we rebuild the language service from all cached files, not just the
  /// changed ones. this is necessary because changing file A might affect
  /// the type information displayed in file B (e.g., if B imports from A).
  /// the language service is fast enough that this isn't a bottleneck —
  /// the expensive part is the html generation, which we limit to changed
  /// files only.
  const fileMap = new Map<string, string>();
  for (const [path, content] of fileCache) {
    fileMap.set(path, content);
  }

  const result = await generateHtmlMulti(fileMap, {
    includeHighlightScript: true,
    projectRoot,
    includeExternals
  });

  let writtenCount = 0;
  const changedSet = new Set(changedFiles);

  /// we only write files that actually changed, plus the index (which
  /// might need updating if the changed file added or removed exports).
  /// this keeps incremental rebuilds fast — we're not rewriting 50 html
  /// files because one comment changed.
  for (const [filename, html] of result.files) {
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
