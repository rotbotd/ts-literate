// typescript language service wrappers

import ts from "typescript";
import { illiterate } from "../extract.js";

// create a language service for a single file
export function createLanguageService(filename: string, source: string): ts.LanguageService {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [filename],
    getScriptVersion: () => "1",
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

// create a language service for multiple files
export function createMultiFileLanguageService(files: Map<string, string>): ts.LanguageService {
  const fileNames = [...files.keys()];
  
  // illiterate all files (blank /// lines)
  const illiteratedFiles = new Map<string, string>();
  for (const [name, source] of files) {
    illiteratedFiles.set(name, illiterate(source));
  }
  
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const content = illiteratedFiles.get(name);
      if (content !== undefined) {
        return ts.ScriptSnapshot.fromString(content);
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
