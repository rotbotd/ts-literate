/// # CSS and JavaScript assets
///
/// all the styles and client-side scripts are defined here as template
/// literals. they get inlined directly into each generated html page
/// (unless you provide an external CSS file via the `cssFile` option).
///
/// ## design philosophy
///
/// the visual design follows a few principles:
///
/// - **code blocks go full-width** — they break out of the prose column
///   using negative margins (`calc(-50vw + 50%)`). this gives code room
///   to breathe while keeping prose at a comfortable reading width.
/// - **github-light color scheme** — the syntax highlighting colors match
///   VS Code's github-light theme, which is what most people associate
///   with "github-style" code rendering.
/// - **minimal chrome** — no line numbers, no copy buttons, no file
///   headers. just code and prose flowing together.
/// - **interactive but not flashy** — hover highlighting and tooltips
///   reveal structure on demand without cluttering the default view.

export const defaultCss = `
body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 2rem 1rem;
  line-height: 1.6;
}

/// the watermark is a subtle header with an "index" link on the left
/// and "ts-literate" branding on the right. it uses \`pointer-events: none\`
/// so it doesn't interfere with the content underneath.
.watermark {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  font-size: 12px;
  color: #ccc;
  pointer-events: none;
  z-index: 100;
}

.watermark a {
  color: #ccc;
  text-decoration: none;
  border-bottom: none;
}

.watermark a:hover {
  color: #999;
  background: none;
}

.watermark-right {
  font-style: italic;
}

/// the \`.literate\` container constrains prose to 80ch width, which is
/// a comfortable reading measure for proportional fonts.
.literate {
  font-size: 15px;
  max-width: 80ch;
  margin: 0 auto;
}

/// ## prose styles
///
/// prose sections get full markdown styling — headings, lists, blockquotes,
/// code blocks (within prose, these are fenced code blocks highlighted by
/// shiki), tables, etc.
.prose {
  margin: 1.5rem 0;
}

.prose h1 {
  font-size: 1.8rem;
  margin: 2rem 0 1rem;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.3rem;
}

.prose h2 {
  font-size: 1.4rem;
  margin: 1.5rem 0 0.75rem;
}

.prose h3 {
  font-size: 1.1rem;
  margin: 1rem 0 0.5rem;
}

.prose p {
  margin: 0.75rem 0;
}

.prose h4 {
  font-size: 1rem;
  margin: 0.75rem 0 0.5rem;
  font-weight: 600;
}

.prose h5, .prose h6 {
  font-size: 0.9rem;
  margin: 0.5rem 0;
  font-weight: 600;
}

.prose ul, .prose ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.prose li {
  margin: 0.25rem 0;
}

.prose li > ul, .prose li > ol {
  margin: 0.25rem 0;
}

.prose blockquote {
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  border-left: 4px solid #dfe2e5;
  color: #6a737d;
  background: #f6f8fa;
}

.prose blockquote > :first-child {
  margin-top: 0;
}

.prose blockquote > :last-child {
  margin-bottom: 0;
}

.prose code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  background: #f6f8fa;
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

.prose pre {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.5;
  background: #f6f8fa;
  padding: 1rem;
  margin: 0.75rem 0;
  border-radius: 6px;
  overflow-x: auto;
}

.prose pre code {
  background: none;
  padding: 0;
  font-size: inherit;
}

.prose hr {
  border: none;
  border-top: 1px solid #eee;
  margin: 1.5rem 0;
}

.prose table {
  border-collapse: collapse;
  margin: 1rem 0;
  width: 100%;
}

.prose th, .prose td {
  border: 1px solid #dfe2e5;
  padding: 0.5rem 0.75rem;
  text-align: left;
}

.prose th {
  background: #f6f8fa;
  font-weight: 600;
}

.prose tr:nth-child(even) {
  background: #f6f8fa;
}

.prose strong {
  font-weight: 600;
}

.prose em {
  font-style: italic;
}

.prose a {
  color: #0366d6;
  text-decoration: none;
}

.prose a:hover {
  text-decoration: underline;
}

.prose img {
  max-width: 100%;
  height: auto;
}

/// ## code block styles
///
/// code blocks (the actual typescript source, not fenced code in prose)
/// use the full-width breakout technique. the negative margins and calc
/// values make the code extend to the viewport edges while keeping the
/// text aligned with the prose column.
pre.code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.5;
  background: #f6f8fa;
  padding: 1rem;
  margin: 0.5rem -1rem;
  margin-left: calc(-50vw + 50%);
  margin-right: calc(-50vw + 50%);
  padding-left: calc(50vw - 50% + 1rem);
  padding-right: calc(50vw - 50% + 1rem);
  width: 100%;
  overflow-x: auto;
}

/// ## syntax highlighting colors
///
/// these follow the github-light theme from VS Code / shiki:
///
/// | color     | usage                              |
/// |-----------|------------------------------------|
/// | \`#d73a49\` | keywords, operators, storage       |
/// | \`#6f42c1\` | functions, classes, types (purple)  |
/// | \`#005cc5\` | constants, properties (blue)        |
/// | \`#032f62\` | strings                            |
/// | \`#6a737d\` | comments                           |
/// | \`#22863a\` | jsx tags (green)                   |
/// | \`#24292e\` | default text                       |

/* syntactic tokens */
.ts-keyword { color: #d73a49; }
.ts-operator { color: #d73a49; }
.ts-string { color: #032f62; }
.ts-number { color: #005cc5; }
.ts-comment { color: #6a737d; font-style: italic; }
.ts-identifier { color: #24292e; }
.ts-punctuation { color: #24292e; }

/* semantic tokens - entity names purple */
.ts-class { color: #6f42c1; }
.ts-interface { color: #6f42c1; }
.ts-enum { color: #6f42c1; }
.ts-type { color: #6f42c1; }
.ts-type-parameter { color: #6f42c1; }
.ts-namespace { color: #6f42c1; }
.ts-function { color: #6f42c1; }
.ts-method { color: #6f42c1; }

/* semantic tokens - constants blue */
.ts-property { color: #005cc5; }
.ts-enum-member { color: #005cc5; }

/* semantic tokens - variables default (variable.other scope) */
.ts-variable { color: #24292e; }
.ts-parameter { color: #24292e; }

/* jsx tags green */
.ts-jsx-open-tag-name { color: #22863a; }
.ts-jsx-close-tag-name { color: #22863a; }
.ts-jsx-self-closing-tag-name { color: #22863a; }

/* syntactic fallbacks for declarations */
.ts-class-name { color: #6f42c1; }
.ts-interface-name { color: #6f42c1; }
.ts-enum-name { color: #6f42c1; }
.ts-type-parameter-name { color: #6f42c1; }
.ts-module-name { color: #6f42c1; }
.ts-parameter-name { color: #24292e; }

/// ## hover highlighting
///
/// when you mouse over any identifier, all other references to the same
/// definition light up with a yellow background. this makes it easy to
/// see at a glance where a variable is used.
/* hover highlight */
.hover-highlight {
  background: #fff3cd;
  border-radius: 2px;
}

a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px dotted #888;
}

a:hover {
  background: #e8f4ff;
}

/// ## tooltip styles
///
/// the quickinfo tooltip appears on hover and shows type information
/// (the same thing VS Code shows). it uses \`position: fixed\` with a
/// CSS transform for GPU-accelerated positioning, and fades in/out
/// with a short opacity transition.
/* quickinfo tooltip - using transform for GPU acceleration */
#tooltip {
  position: fixed;
  top: 0;
  left: 0;
  background: #fff;
  color: #333;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  border: 1px solid #ccc;
  max-width: 50vw;
  white-space: pre-wrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s;
  z-index: 1000;
  will-change: transform;
}

#tooltip.visible {
  opacity: 1;
}

`;

/// ## tooltip script
///
/// the tooltip works by looking up `<template>` elements by id. when you
/// hover over a token that has an id attribute, we look for a corresponding
/// `<template id="qi-{id}">` element and clone its content into the tooltip
/// div. this is efficient because we avoid storing potentially large type
/// signatures as data attributes.

export const tooltipScript = `
(function() {
  var tooltip = document.createElement('div');
  tooltip.id = 'tooltip';
  document.body.appendChild(tooltip);
  
  function showTooltip(id) {
    var tmpl = document.getElementById('qi-' + id);
    if (tmpl) {
      tooltip.textContent = '';
      tooltip.appendChild(tmpl.content.cloneNode(true));
      tooltip.classList.add('visible');
    }
  }
  
  function hideTooltip() {
    tooltip.classList.remove('visible');
  }
  
  function positionTooltip(e) {
    tooltip.style.transform = 'translate(' + (e.clientX + 12) + 'px, ' + (e.clientY + 12) + 'px)';
  }
  
  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('[id]');
    if (el) {
      positionTooltip(e);
      showTooltip(el.id);
    }
  });
  
  document.addEventListener('mousemove', function(e) {
    if (tooltip.classList.contains('visible')) {
      positionTooltip(e);
    }
  });
  
  document.addEventListener('mouseout', function(e) {
    var el = e.target.closest('[id]');
    if (el) {
      hideTooltip();
    }
  });
})();
`;

/// ## hover highlight script
///
/// this script builds a map from href → set of elements. when you hover
/// over any link, it finds all other links with the same href (i.e., all
/// references to the same definition) and adds the `hover-highlight` class.
/// this creates the "light up all usages" effect.

export const highlightScript = `
var dict = new Map();

window.onload = function () {
  var objs = document.querySelectorAll('a[href]');
  
  for (var i = 0; i < objs.length; i++) {
    var obj = objs[i];
    var key = obj.href;
    var set = dict.get(key) || new Set();
    set.add(obj);
    dict.set(key, set);
  }
  
  for (var i = 0; i < objs.length; i++) {
    var obj = objs[i];
    obj.onmouseover = function () {
      var s = dict.get(this.href);
      if (s) s.forEach(function(o) { o.classList.add('hover-highlight'); });
    }
    obj.onmouseout = function () {
      var s = dict.get(this.href);
      if (s) s.forEach(function(o) { o.classList.remove('hover-highlight'); });
    }
  }
};
`;
