/// # shared types
///
/// these interfaces define the configuration and output shapes for
/// html generation. they're shared across the html module so that
/// `index.ts`, `render.ts`, and `tokens.ts` all agree on the same
/// structures.

/// most of the time you just want the defaults — inline styles, hover
/// highlighting, the filename as the page title. but when you need control,
/// these options let you customize the output without touching the rendering
/// pipeline.
export interface HtmlOptions {
  /// path to an external CSS file. if omitted, styles are inlined
  /// directly into the `<style>` tag of each generated page.
  cssFile?: string;
  /// whether to include the hover-highlight script that lights up
  /// all references to the same definition when you mouse over one.
  /// defaults to `true`.
  includeHighlightScript?: boolean;
  /// title for the html page. defaults to the filename.
  title?: string;
  /// root directory of the project. used for computing relative paths
  /// in multi-file mode. defaults to `process.cwd()`.
  projectRoot?: string;
  /// if true, external files (things in `node_modules/`, `lib.d.ts`,
  /// etc.) that are referenced by your code will also get rendered to
  /// html so that cross-file links don't break.
  includeExternals?: boolean;
  /// skip generating `index.html`. used internally when processing
  /// external files (since the main files already made an index).
  skipIndex?: boolean;
}

/// when you generate html for a single file, you get back the html string
/// plus a map of all the definitions found in that file. the definition map
/// is how multi-file mode knows where to link references — file A discovers
/// its definitions, file B can link to them.
export interface HtmlResult {
  html: string;
  /// a map from definition id (like `"file.ts:42"`) to its source location.
  /// this is used for building cross-file links.
  definitions: Map<string, { file: string; line: number; column: number }>;
}

/// multi-file generation produces a richer result: a map from each input
/// file to its generated html, plus the combined definition map spanning
/// all files. it also tracks external files that were referenced, in case
/// you want to generate html for those too.
export interface MultiFileResult {
  files: Map<string, string>;
  definitions: Map<string, { file: string; line: number; column: number }>;
  /// files outside the project that were referenced. only populated when
  /// `includeExternals` is true.
  externalFiles: Set<string>;
}

/// the rendering pipeline works token by token. for each token the
/// language service identifies, we build one of these — collecting the
/// text, the CSS classes, where it's defined, and what the hover tooltip
/// should say. then `renderToken` turns it into html: an `<a>` if it
/// can be linked, a `<span>` otherwise.
export interface TokenInfo {
  start: number;
  length: number;
  text: string;
  /// CSS classes to apply (e.g. `["keyword"]`, `["identifier", "function"]`).
  classes: string[];
  /// if this token references a definition, this is the definition's unique id
  /// (formatted as `"filename:offset"`).
  definitionId?: string;
  /// the file where the definition lives.
  definitionFile?: string;
  /// true if this token IS the definition site (not just a reference to it).
  isDefinition?: boolean;
  /// hover tooltip text from the language service's `getQuickInfoAtPosition`.
  quickInfo?: string;
}
