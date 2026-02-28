# ts-literate

Literate programming for TypeScript. Extracts `///` comments as prose and renders your source files as readable, annotated HTML documents.

## What it does

In literate programming, documentation and code live together. `ts-literate` treats triple-slash comments (`///`) as prose sections:

```typescript
/// # Hello World
/// This function greets someone.

function greet(name: string) {
  /// We log the greeting to the console.
  console.log(`Hello, ${name}!`);
}
```

This gets rendered into an HTML document where the `///` comments become formatted prose (with full markdown support) interspersed with syntax-highlighted code blocks.

## Install

```bash
bun add ts-literate
```

## Usage

### CLI

```bash
# Render a single file
ts-literate render src/index.ts -o output.html

# Watch mode
ts-literate render src/index.ts -o output.html --watch

# Serve with hot reload
ts-literate serve src/ --port 3000
```

### API

```typescript
import { extract } from "ts-literate";

// Extract prose and code segments from a TypeScript file
const segments = extract(sourceCode);
```

## How it works

1. **Extract**: Parses TypeScript source, splitting it into prose (`///` comments) and code segments
2. **Render**: Prose segments are rendered as markdown via [marked](https://github.com/markedjs/marked), code segments are syntax-highlighted via [shiki](https://github.com/shikijs/shiki)
3. **Serve**: Optional dev server with file watching and hot reload

## License

MIT
