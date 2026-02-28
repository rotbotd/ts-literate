// shared types for html generation

export interface HtmlOptions {
  // CSS file to link (default: inline styles)
  cssFile?: string;
  // include the hover-highlight script
  includeHighlightScript?: boolean;
  // title for the HTML page
  title?: string;
  // project root for computing relative paths (default: cwd)
  projectRoot?: string;
  // include external files (node_modules, lib.d.ts) in output
  includeExternals?: boolean;
  // skip generating index.html (used for external file processing)
  skipIndex?: boolean;
}

export interface HtmlResult {
  html: string;
  // map from definition id to its location
  definitions: Map<string, { file: string; line: number; column: number }>;
}

export interface MultiFileResult {
  // map from original filename to generated HTML
  files: Map<string, string>;
  // all definitions across all files
  definitions: Map<string, { file: string; line: number; column: number }>;
  // external files that were referenced (for includeExternals mode)
  externalFiles: Set<string>;
}

// info about a token we want to render
export interface TokenInfo {
  start: number;
  length: number;
  text: string;
  classes: string[];
  definitionId?: string;
  definitionFile?: string;
  isDefinition?: boolean;
  quickInfo?: string;  // hover tooltip text
}
