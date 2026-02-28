/// # shared types
///
/// these interfaces define the configuration and output shapes for
/// html generation. they're shared across the html module so that
/// `index.ts`, `render.ts`, and `tokens.ts` all agree on the same
/// structures.

/// ## HtmlOptions
///
/// controls how html is generated. most fields are optional with
/// sensible defaults.
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

/// ## HtmlResult
///
/// the output of single-file generation.
export interface HtmlResult {
  html: string;
  /// a map from definition id (like `"file.ts:42"`) to its source location.
  /// this is used for building cross-file links.
  definitions: Map<string, { file: string; line: number; column: number }>;
}

/// ## MultiFileResult
///
/// the output of multi-file generation. each input `.ts` file maps to a
/// generated `.html` string, plus an index page.
export interface MultiFileResult {
  files: Map<string, string>;
  definitions: Map<string, { file: string; line: number; column: number }>;
  /// files outside the project that were referenced. only populated when
  /// `includeExternals` is true.
  externalFiles: Set<string>;
}

/// ## TokenInfo
///
/// describes a single token we want to render in the html output. the
/// html renderer collects these from the typescript language service,
/// enriches them with definition info and hover tooltips, then renders
/// each one as an `<a>` (if it's linkable) or `<span>`.
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
