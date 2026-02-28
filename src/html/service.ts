/// # typescript language service wrappers
///
/// the typescript language service is the same engine that powers VS Code's
/// intellisense. we create lightweight instances of it to get:
///
/// - **syntactic classification** — is this token a keyword? a string? an identifier?
/// - **semantic classification** — is this identifier a function? a type? a variable?
/// - **go-to-definition** — where is this symbol defined?
/// - **quick info** — what's the type signature? (the hover tooltip)
/// - **navigation tree** — what symbols are exported? (for the index page)
///
/// we provide two flavors: one for a single file (used in single-file mode)
/// and one for multiple files (used when generating a whole project, so
/// cross-file references resolve correctly).

import ts from "typescript";
import { illiterate } from "../extract.js";

/// ## single-file language service
///
/// typescript's language service doesn't just take a string and give you
/// answers. it expects a `LanguageServiceHost` — an object that acts as
/// its window into the filesystem. "what files are in this project?"
/// "what are the compiler settings?" "give me the contents of this file."
///
/// for single-file mode we give it the simplest possible host: one file,
/// sensible defaults, and the real filesystem for everything else (so it
/// can find `lib.d.ts` and friends).

export function createLanguageService(filename: string, source: string): ts.LanguageService {
  const host: ts.LanguageServiceHost = {
    /// "what files should i analyze?" — just the one.
    getScriptFileNames: () => [filename],
    /// "has this file changed since i last looked?" — no, we only read
    /// each file once. returning a constant version string means the
    /// service never invalidates its cache.
    getScriptVersion: () => "1",
    /// "give me the contents of this file." for our target file, we serve
    /// the in-memory source string. for anything else (like `lib.d.ts`),
    /// we read from disk. this is how the service finds type definitions
    /// for built-in types like `Array` and `Promise`.
    getScriptSnapshot: (name) => {
      if (name === filename) {
        return ts.ScriptSnapshot.fromString(source);
      }
      if (ts.sys.fileExists(name)) {
        return ts.ScriptSnapshot.fromString(ts.sys.readFile(name) ?? "");
      }
      return undefined;
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      strict: true,
    }),
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (name) => name === filename || ts.sys.fileExists(name),
    readFile: (name) => name === filename ? source : ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

/// ## multi-file language service
///
/// when generating html for a whole project, we need the language service
/// to know about ALL the files so that cross-file go-to-definition works.
/// if file A imports a type from file B, we need to be able to link to
/// file B's generated html page.
///
/// crucially, we illiterate all files before handing them to the service.
/// the `///` prose lines get blanked to spaces so typescript doesn't try
/// to parse them as code, but the positions stay aligned.

export function createMultiFileLanguageService(files: Map<string, string>): ts.LanguageService {
  const fileNames = [...files.keys()];
  
  /// we illiterate all files upfront rather than on-demand. this is a one-time
  /// cost and ensures the language service never sees `///` prose lines.
  const illiteratedFiles = new Map<string, string>();
  for (const [name, source] of files) {
    illiteratedFiles.set(name, illiterate(source));
  }
  
  const host: ts.LanguageServiceHost = {
    /// "what files should i analyze?" — all of them. this is how the language
    /// service knows that `import { foo } from "./bar"` should resolve to
    /// our bar.ts, not some random file on disk.
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const content = illiteratedFiles.get(name);
      if (content !== undefined) {
        return ts.ScriptSnapshot.fromString(content);
      }
      /// if it's not one of our project files, it's probably something like
      /// `lib.es5.d.ts` or a dependency in `node_modules`. typescript needs
      /// these to resolve types, so we let it read them from disk.
      if (ts.sys.fileExists(name)) {
        return ts.ScriptSnapshot.fromString(ts.sys.readFile(name) ?? "");
      }
      return undefined;
    },
    getCurrentDirectory: () => process.cwd(),
    /// `NodeNext` module resolution is important here — without it, typescript
    /// won't resolve `.js` extension imports (which are standard for ESM
    /// projects that compile `.ts` → `.js`).
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
    }),
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (name) => illiteratedFiles.has(name) || ts.sys.fileExists(name),
    readFile: (name) => illiteratedFiles.get(name) ?? ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}
