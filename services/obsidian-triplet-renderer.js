const { MarkdownRenderer } = require('obsidian');
const { serializeObsidianRenderedHtml } = require('./obsidian-triplet-serializer');
const { normalizeRenderedDomPunctuation } = require('./chinese-punctuation');
const {
  hasMermaidMarker,
  renderMermaidCodeBlocks,
  looksLikeMermaidSvg,
  normalizeRenderedMermaidDiagrams,
  rasterizeRenderedMermaidDiagrams,
} = require('./rendered-mermaid');

function isFencedBlockDelimiter(line) {
  return /^\s{0,3}(?:`{3,}|~{3,})/.test(String(line || ''));
}

function parseFencedBlockDelimiter(line) {
  const value = String(line || '');
  const match = value.match(/^\s{0,3}((`{3,})|(~{3,}))(.*)$/);
  if (!match) return null;
  const markerRun = match[1] || '';
  const markerChar = markerRun.charAt(0);
  if (markerChar !== '`' && markerChar !== '~') return null;
  return {
    marker: markerChar,
    length: markerRun.length,
  };
}

function isMathFenceDelimiter(line) {
  return /^\s*\$\$\s*$/.test(String(line || ''));
}

function isQuoteLine(line) {
  return /^\s{0,3}(?:>\s?)+/.test(String(line || ''));
}

function stripQuotePrefix(line) {
  return String(line || '').replace(/^\s{0,3}(?:>\s?)+/, '');
}

function isQuotePrefix(prefix) {
  return /^\s{0,3}(?:>\s?)+$/.test(String(prefix || ''));
}

function startsNewBlock(trimmedLine) {
  if (!trimmedLine) return true;
  if (/^#{1,6}\s/.test(trimmedLine)) return true;
  if (/^>/.test(trimmedLine)) return true;
  if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmedLine)) return true;
  if (/^(?:[*+-]|\d+[.)])\s+/.test(trimmedLine)) return true;
  if (/^\|/.test(trimmedLine)) return true;
  if (/^<[^>]+>/.test(trimmedLine)) return true;
  if (isFencedBlockDelimiter(trimmedLine)) return true;
  return false;
}

function isListItemLine(trimmedLine) {
  return /^(?:[*+-]|\d+[.)])\s+/.test(String(trimmedLine || ''));
}

function appendLegacyHardBreak(line) {
  const value = String(line || '');
  if (!value) return value;
  if (/<br\s*\/?>\s*$/i.test(value)) return value;
  return `${value.replace(/[ \t]+$/, '')}<br>`;
}

function appendQuoteHardBreak(line) {
  const value = String(line || '');
  if (!value) return value;
  if (/<br\s*\/?>\s*$/i.test(value)) return value;
  return `${value.replace(/[ \t]+$/, '')}<br>`;
}

function injectHardBreaksForLegacyParity(markdown) {
  const lines = String(markdown || '').split('\n');
  let fenceState = null;
  let inMathFence = false;

  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    const fenceDelimiter = parseFencedBlockDelimiter(line);
    if (fenceDelimiter) {
      if (!fenceState) {
        fenceState = fenceDelimiter;
      } else if (
        fenceDelimiter.marker === fenceState.marker &&
        fenceDelimiter.length >= fenceState.length
      ) {
        fenceState = null;
      }
      continue;
    }

    if (!fenceState && isMathFenceDelimiter(line)) {
      inMathFence = !inMathFence;
      continue;
    }

    if (fenceState || inMathFence) continue;
    if (!line || !nextLine) continue;
    if (/[ \t]{2,}$/.test(line) || /\\$/.test(line)) continue;

    if (isQuoteLine(line) && isQuoteLine(nextLine)) {
      const currentQuoteContent = stripQuotePrefix(line).trim();
      const nextQuoteContent = stripQuotePrefix(nextLine).trim();
      if (!currentQuoteContent || !nextQuoteContent) continue;
      if (/^\[!/.test(currentQuoteContent) || /^\[!/.test(nextQuoteContent)) continue;
      lines[i] = appendQuoteHardBreak(line);
      continue;
    }

    const currentTrimmed = line.trim();
    if (startsNewBlock(currentTrimmed) && !isListItemLine(currentTrimmed)) continue;
    if (startsNewBlock(nextLine.trim())) continue;

    lines[i] = appendLegacyHardBreak(line);
  }

  return lines.join('\n');
}

function neutralizeUnsafeMarkdownLinks(markdown) {
  const source = String(markdown || '');
  if (!source) return source;

  // markdown-it rejects javascript:/vbscript:/data: links in markdown syntax and
  // keeps them as literal text. Escape leading "[" to mimic that behavior in triplet.
  const unsafeLinkPattern = /\[[^\]]+\]\(((?:javascript|vbscript|data):[^)\r\n]*)\)/gi;
  return source.replace(unsafeLinkPattern, (match, _href, offset, fullText) => {
    const prevChar = offset > 0 ? fullText[offset - 1] : '';
    if (prevChar === '!' || prevChar === '\\') {
      return match;
    }
    return `\\${match}`;
  });
}

function neutralizePlainWikilinks(markdown) {
  const source = String(markdown || '');
  if (!source) return source;

  const escapePlainWikilinks = (value) =>
    String(value || '').replace(/(^|[^!\\])(\[\[[^[\]\r\n]+?\]\])/g, (_match, prefix, wikilink) => {
      return `${prefix}\\${wikilink}`;
    });

  const neutralizeLineOutsideInlineCode = (line) => {
    const value = String(line || '');
    if (!value || !value.includes('[[')) return value;

    let result = '';
    let cursor = 0;
    const codeSpanPattern = /(`+)([\s\S]*?)(\1)/g;
    let match = codeSpanPattern.exec(value);

    while (match) {
      const [segment] = match;
      const start = match.index;
      const end = start + segment.length;
      result += escapePlainWikilinks(value.slice(cursor, start));
      result += segment;
      cursor = end;
      match = codeSpanPattern.exec(value);
    }

    result += escapePlainWikilinks(value.slice(cursor));
    return result;
  };

  const lines = source.split('\n');
  let fenceState = null;
  let inMathFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const fenceDelimiter = parseFencedBlockDelimiter(line);
    if (fenceDelimiter) {
      if (!fenceState) {
        fenceState = fenceDelimiter;
      } else if (
        fenceDelimiter.marker === fenceState.marker &&
        fenceDelimiter.length >= fenceState.length
      ) {
        fenceState = null;
      }
      continue;
    }

    if (!fenceState && isMathFenceDelimiter(line)) {
      inMathFence = !inMathFence;
      continue;
    }

    if (fenceState || inMathFence) continue;

    lines[i] = neutralizeLineOutsideInlineCode(line);
  }

  return lines.join('\n');
}

// Known safe HTML tags that should NOT be escaped
// This list includes common HTML5 tags that users might intentionally use
const KNOWN_HTML_TAGS = new Set([
  // Block elements
  'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr', 'br',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'main', 'section',
  'article', 'aside', 'header', 'footer', 'nav', 'address',
  // Inline elements
  'a', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'code', 'kbd',
  'samp', 'var', 'mark', 'small', 'sub', 'sup', 'span', 'abbr', 'cite', 'q',
  'time', 'ruby', 'rt', 'rp', 'bdi', 'bdo', 'dfn', 'wbr',
  // Media elements
  'img', 'picture', 'source', 'video', 'audio', 'track', 'canvas', 'svg', 'math',
  // Table elements
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Form elements (though these are stripped by sanitizer)
  'form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea', 'label',
  'fieldset', 'legend', 'datalist', 'output', 'progress', 'meter',
  // Other common elements
  'details', 'summary', 'dialog', 'menu', 'menuitem', 'noscript', 'template',
  // MathJax specific
  'mjx-container', 'mjx-math',
]);

/**
 * Escape pseudo-HTML tags that look like HTML but are actually text.
 * For example: <Title>_xxx_MS.pdf should be rendered as text, not as an HTML tag.
 */
function escapePseudoHtmlTags(markdown) {
  const lines = markdown.split('\n');
  const result = [];
  let inCodeBlock = false;
  let codeBlockFence = null; // { marker: '`' or '~', length: number }

  for (const line of lines) {
    // Track code block boundaries using existing parser (supports 0-3 leading spaces)
    const parsed = parseFencedBlockDelimiter(line);
    if (parsed) {
      if (!inCodeBlock) {
        // Opening fence
        inCodeBlock = true;
        codeBlockFence = { marker: parsed.marker, length: parsed.length };
      } else if (parsed.marker === codeBlockFence.marker && parsed.length >= codeBlockFence.length) {
        // Closing fence must match marker type and be at least as long
        inCodeBlock = false;
        codeBlockFence = null;
      }
      // If marker doesn't match, it's content inside the code block (not a closing fence)
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // Escape pseudo-HTML tags outside code blocks, but preserve inline code
    const processed = escapeLinePreservingInlineCode(line);
    result.push(processed);
  }

  return result.join('\n');
}

/**
 * Escape pseudo-HTML tags in a line while preserving inline code content.
 * Supports multi-backtick code spans (CommonMark compliant).
 */
function escapeLinePreservingInlineCode(line) {
  const segments = [];
  let lastIndex = 0;
  let i = 0;

  while (i < line.length) {
    // Look for backtick sequence (inline code span start)
    if (line[i] === '`') {
      // Skip fenced block markers at line start (3+ backticks)
      if (i === 0 && line.match(/^`{3,}/)) {
        i++;
        continue;
      }

      // Count opening delimiter run length
      const startIndex = i;
      let openLen = 0;
      while (i < line.length && line[i] === '`') {
        openLen++;
        i++;
      }

      // Find matching closing delimiter run of the same length
      let foundClose = false;
      while (i < line.length) {
        if (line[i] === '`') {
          const closeStart = i;
          let closeLen = 0;
          while (i < line.length && line[i] === '`') {
            closeLen++;
            i++;
          }
          // Closing delimiter must match opening length
          if (closeLen === openLen) {
            foundClose = true;
            break;
          }
          // Otherwise continue searching
        } else {
          i++;
        }
      }

      if (foundClose) {
        // Add text before code span and the code span itself
        segments.push(line.slice(lastIndex, startIndex));
        segments.push(line.slice(startIndex, i));
        lastIndex = i;
      }
      // If no close found, the opening backticks are just literal text
    } else {
      i++;
    }
  }

  // Add remaining text
  if (lastIndex < line.length) {
    segments.push(line.slice(lastIndex));
  }

  // If no inline code found, process the whole line
  if (segments.length === 0) {
    return escapePseudoHtmlInText(line);
  }

  // Process non-code segments (even indices are text, odd are code spans)
  return segments.map((seg, idx) => {
    if (idx % 2 === 1) return seg; // Preserve code span as-is
    return escapePseudoHtmlInText(seg);
  }).join('');
}

/**
 * Escape pseudo-HTML tags in plain text (not inside code).
 * Matches full tag patterns including attributes and closing bracket.
 */
function escapePseudoHtmlInText(text) {
  // Match opening tags: <tag> or <tag attr="value">
  // Match closing tags: </tag>
  return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (match, tagName, attrs) => {
    const lowerTag = tagName.toLowerCase();
    // If it's a known HTML tag, keep it as-is
    if (KNOWN_HTML_TAGS.has(lowerTag)) {
      return match;
    }
    // Otherwise escape the angle brackets
    if (match.startsWith('</')) {
      return `&lt;/${tagName}&gt;`;
    }
    return `&lt;${tagName}${attrs}&gt;`;
  });
}

// Generate a unique placeholder that won't conflict with user content
// Uses a random session ID + counter to prevent collision
const MATH_PLACEHOLDER_SESSION = `M${Date.now().toString(36)}X`;
let mathPlaceholderCounter = 0;

function generateMathPlaceholder(type) {
  const id = `${MATH_PLACEHOLDER_SESSION}_${mathPlaceholderCounter}_${Math.random().toString(36).slice(2, 6)}`;
  mathPlaceholderCounter += 1;
  // Zero-width spaces protect from Markdown, unique ID prevents collision
  return `\u200B${id}_${type}\u200B`;
}

/**
 * Pre-render math formulas and return both the processed markdown and formulas array.
 * This function is pure - it doesn't use or modify any global state.
 * @returns {{ markdown: string, formulas: Array<{placeholder: string, rendered: string, isBlock: boolean}> }}
 */
function preRenderMathFormulas(markdown, converter) {
  const formulas = [];

  if (!converter || !converter.md) return { markdown, formulas };
  if (typeof converter.md.render !== 'function') return { markdown, formulas };

  let output = markdown;

  // First, handle block math ($$...$$) - must be processed before inline
  // Match $$...$$ where content can span multiple lines
  const blockMathPattern = /\$\$([\s\S]+?)\$\$/g;
  output = output.replace(blockMathPattern, (match, formula, offset, fullText) => {
    const placeholder = generateMathPlaceholder('BLOCK');
    try {
      let normalizedFormula = formula;
      const safeOffset = Number(offset) || 0;
      const source = String(fullText || '');
      const lineStart = source.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
      const openingPrefix = source.slice(lineStart, safeOffset);

      // In quoted blocks/callouts, captured formula lines include leading ">" markers.
      // Strip them before MathJax rendering to avoid rendering stray ">" symbols.
      if (isQuotePrefix(openingPrefix)) {
        normalizedFormula = String(formula || '')
          .split('\n')
          .map((line) => stripQuotePrefix(line))
          .join('\n');
      }

      // Render using full markdown-it (handles block math)
      const rendered = converter.md.render(`$$${normalizedFormula}$$`);
      // Extract just the rendered math (strip wrapper <p> if any)
      const cleaned = rendered.replace(/^<p>|<\/p>$/g, '').trim();
      formulas.push({ placeholder, rendered: cleaned, isBlock: true });
      return placeholder;
    } catch (error) {
      return match;
    }
  });

  // Then, handle inline math ($...$) - single $ not $$
  // Use negative lookbehind/lookahead to avoid matching $$
  const inlineMathPattern = /(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g;
  output = output.replace(inlineMathPattern, (match, formula) => {
    const placeholder = generateMathPlaceholder('INLINE');
    try {
      // Render using renderInline for inline math
      const rendered = converter.md.renderInline(`$${formula}$`);
      formulas.push({ placeholder, rendered, isBlock: false });
      return placeholder;
    } catch (error) {
      return match;
    }
  });

  return { markdown: output, formulas };
}

const IMAGE_SWIPE_DEFAULT_WARNING = '此类图片可能引发不适，向左滑动查看';
const IMAGE_SWIPE_DEFAULT_HINT = '左右滑动查看图片';
const IMAGE_SWIPE_TYPES = new Set(['image-swipe', 'image-sensitive']);

function encodeImageSwipeValue(value) {
  return encodeURIComponent(String(value || ''));
}

function escapeImageSwipeHtmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getImageCaptionFromPath(imagePath) {
  const value = String(imagePath || '').trim();
  if (!value) return '';
  const filename = value.split('/').pop().split('\\').pop() || value;
  return filename.replace(/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/i, '');
}

function hasExplicitUrlProtocol(value) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(String(value || '').trim());
}

function shouldMaterializeLocalMarkdownImage(src) {
  const value = String(src || '').trim();
  if (!value) return false;
  if (/^(?:https?:)?\/\//i.test(value)) return false;
  if (/^data:image\//i.test(value)) return false;
  return !hasExplicitUrlProtocol(value);
}

function encodeMarkdownImageSrc(src) {
  const value = String(src || '').trim();
  try {
    return encodeURI(decodeURI(value));
  } catch (error) {
    return encodeURI(value);
  }
}

function findInlineCodeRanges(line) {
  const value = String(line || '');
  const ranges = [];
  let index = 0;

  while (index < value.length) {
    if (value[index] !== '`') {
      index += 1;
      continue;
    }

    let markerLength = 1;
    while (value[index + markerLength] === '`') {
      markerLength += 1;
    }

    const marker = '`'.repeat(markerLength);
    const closeIndex = value.indexOf(marker, index + markerLength);
    if (closeIndex === -1) {
      index += markerLength;
      continue;
    }

    ranges.push([index, closeIndex + markerLength]);
    index = closeIndex + markerLength;
  }

  return ranges;
}

function findHtmlTagRanges(line) {
  const value = String(line || '');
  const ranges = [];
  let index = 0;

  while (index < value.length) {
    const start = value.indexOf('<', index);
    if (start === -1) break;
    if (!/[A-Za-z/!?]/.test(value[start + 1] || '')) {
      index = start + 1;
      continue;
    }

    const end = value.indexOf('>', start + 1);
    if (end === -1) break;
    ranges.push([start, end + 1]);
    index = end + 1;
  }

  return ranges;
}

function findHtmlElementContentRanges(line) {
  const value = String(line || '');
  const ranges = [];
  const openTagPattern = /<([A-Za-z][\w:-]*)(?:\s[^<>]*)?>/g;
  let match;

  while ((match = openTagPattern.exec(value)) !== null) {
    const rawTag = match[0] || '';
    if (/\/\s*>$/.test(rawTag)) continue;

    const tagName = String(match[1] || '').toLowerCase();
    const closePattern = new RegExp(`</${tagName}\\s*>`, 'i');
    const rest = value.slice(openTagPattern.lastIndex);
    const closeMatch = closePattern.exec(rest);
    if (!closeMatch) continue;

    ranges.push([match.index, openTagPattern.lastIndex + closeMatch.index + closeMatch[0].length]);
  }

  return ranges;
}

function findMarkdownLinkLabelRanges(line) {
  const value = String(line || '');
  const ranges = [];

  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== '[' || value[i - 1] === '!' || value[i - 1] === '\\') continue;

    let depth = 1;
    let cursor = i + 1;
    while (cursor < value.length) {
      const char = value[cursor];
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      if (char === '[') {
        depth += 1;
      } else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          if (value[cursor + 1] === '(') {
            ranges.push([i, cursor + 1]);
          }
          break;
        }
      }
      cursor += 1;
    }
  }

  return ranges;
}

function isOffsetInRanges(offset, ranges) {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function isHtmlVoidTag(tagName) {
  return HTML_VOID_TAGS.has(String(tagName || '').toLowerCase());
}

function findClosingMarkdownBracket(value, startIndex) {
  let index = startIndex;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === ']') return index;
    index += 1;
  }
  return -1;
}

function parseQuotedMarkdownTitle(value, startIndex) {
  const quote = value[startIndex];
  if (quote !== '"' && quote !== "'") return null;

  let index = startIndex + 1;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }

  return null;
}

function parseParenthesizedMarkdownTitle(value, startIndex) {
  if (value[startIndex] !== '(') return null;

  let depth = 1;
  let index = startIndex + 1;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }

  return null;
}

function parseMarkdownImageTitleAndClose(value, startIndex) {
  let index = startIndex;
  while (/\s/.test(value[index] || '')) index += 1;
  if (value[index] === ')') return index + 1;

  const titleEnd = value[index] === '('
    ? parseParenthesizedMarkdownTitle(value, index)
    : parseQuotedMarkdownTitle(value, index);
  if (!titleEnd) return null;

  index = titleEnd;
  while (/\s/.test(value[index] || '')) index += 1;
  return value[index] === ')' ? index + 1 : null;
}

function parseMarkdownImageTargetAt(value, openParenIndex) {
  let index = openParenIndex + 1;
  while (/\s/.test(value[index] || '')) index += 1;

  if (value[index] === '<') {
    const targetStart = index + 1;
    index += 1;
    while (index < value.length) {
      if (value[index] === '\\') {
        index += 2;
        continue;
      }
      if (value[index] === '>') {
        const target = value.slice(targetStart, index);
        index += 1;
        const endIndex = parseMarkdownImageTitleAndClose(value, index);
        if (!endIndex) return null;
        return { rawTarget: target, endIndex };
      }
      index += 1;
    }
    return null;
  }

  const targetStart = index;
  let depth = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (/\s/.test(char) && depth === 0) {
      const target = value.slice(targetStart, index);
      const endIndex = parseMarkdownImageTitleAndClose(value, index);
      if (!endIndex) return null;
      return { rawTarget: target, endIndex };
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      if (depth > 0) {
        depth -= 1;
      } else {
        return {
          rawTarget: value.slice(targetStart, index),
          endIndex: index + 1,
        };
      }
    }
    index += 1;
  }

  return null;
}

function replaceLocalMarkdownImagesInLine(line, protectedRanges) {
  const value = String(line || '');
  let output = '';
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf('![', cursor);
    if (start === -1) {
      output += value.slice(cursor);
      break;
    }

    output += value.slice(cursor, start);

    const closeBracketIndex = findClosingMarkdownBracket(value, start + 2);
    const openParenIndex = closeBracketIndex >= 0 ? closeBracketIndex + 1 : -1;
    const parsedTarget = openParenIndex >= 0 && value[openParenIndex] === '('
      ? parseMarkdownImageTargetAt(value, openParenIndex)
      : null;
    if (!parsedTarget) {
      output += value[start];
      cursor = start + 1;
      continue;
    }

    const rawAlt = value.slice(start + 2, closeBracketIndex);
    const match = value.slice(start, parsedTarget.endIndex);
    if (
      isOffsetInRanges(start, protectedRanges)
      || value[start - 1] === '['
      || value[start - 1] === '\\'
    ) {
      output += match;
      cursor = parsedTarget.endIndex;
      continue;
    }

    const src = parseImageSwipeMarkdownTarget(parsedTarget.rawTarget);
    if (!shouldMaterializeLocalMarkdownImage(src)) {
      output += match;
      cursor = parsedTarget.endIndex;
      continue;
    }

    output += `<img src="${escapeImageSwipeHtmlAttr(encodeMarkdownImageSrc(src))}" alt="${escapeImageSwipeHtmlAttr(String(rawAlt || '').trim())}">`;
    cursor = parsedTarget.endIndex;
  }

  return output;
}

function parseImageSwipeMarkdownTarget(rawTarget) {
  const value = String(rawTarget || '').trim();
  if (!value) return '';

  if (value.startsWith('<')) {
    const endIndex = value.indexOf('>');
    if (endIndex > 1) return value.slice(1, endIndex).trim();
  }

  const titledMatch = value.match(/^(.+?)\s+(['"]).*\2\s*$/);
  return (titledMatch ? titledMatch[1] : value).trim();
}

function parseImageSwipeBareRemoteUrlLine(value) {
  const match = String(value || '').trim().match(/^<?((?:https?:)?\/\/[^\s<>]+)>?$/i);
  if (!match) return null;
  return {
    src: encodeURI(match[1]),
    alt: '',
  };
}

function isImageSwipeRemoteSrc(src) {
  return /^(?:https?:)?\/\//i.test(String(src || '').trim());
}

function extractImageSwipeWidthHint(alt) {
  const match = String(alt || '').match(/\|\s*(\d{2,4})(?:x\d+)?\s*$/i);
  return match ? match[1] : '';
}

function renderImageSwipeImgTag(image) {
  const attrs = [
    `src="${escapeImageSwipeHtmlAttr(image.src)}"`,
    `alt="${escapeImageSwipeHtmlAttr(image.alt)}"`,
  ];
  const width = extractImageSwipeWidthHint(image.alt);
  if (width) attrs.push(`width="${width}"`);
  if (isImageSwipeRemoteSrc(image.src)) attrs.push('referrerpolicy="no-referrer"');
  return `<img ${attrs.join(' ')}>`;
}

function parseImageSwipeMarkdownLine(line) {
  const value = String(line || '').trim();
  const bareRemoteImage = parseImageSwipeBareRemoteUrlLine(value);
  if (bareRemoteImage) return bareRemoteImage;

  const wikiMatch = value.match(/^!\[\[([^\]|]+)(?:\|([^\]]+))?]]$/);
  if (wikiMatch) {
    return {
      src: encodeURI(String(wikiMatch[1] || '').trim()),
      alt: String(wikiMatch[2] || '').trim(),
    };
  }

  const markdownMatch = value.match(/^!\[([^\]]*)]\(([\s\S]+)\)$/);
  if (!markdownMatch) return null;
  const src = parseImageSwipeMarkdownTarget(markdownMatch[2]);
  if (!src) return null;

  return {
    src: encodeURI(src),
    alt: String(markdownMatch[1] || '').trim(),
  };
}

function materializeLocalMarkdownImages(markdown) {
  const lines = String(markdown || '').split('\n');
  const output = [];
  let fenceState = null;
  let inMathFence = false;
  let rawHtmlBlockTag = '';
  let inHtmlComment = false;

  for (const line of lines) {
    const fenceDelimiter = parseFencedBlockDelimiter(line);
    if (!inMathFence && fenceDelimiter) {
      if (!fenceState) {
        fenceState = fenceDelimiter;
      } else if (
        fenceDelimiter.marker === fenceState.marker &&
        fenceDelimiter.length >= fenceState.length
      ) {
        fenceState = null;
      }
      output.push(line);
      continue;
    }

    if (!fenceState && isMathFenceDelimiter(line)) {
      inMathFence = !inMathFence;
      output.push(line);
      continue;
    }

    if (fenceState || inMathFence) {
      output.push(line);
      continue;
    }

    if (inHtmlComment) {
      output.push(line);
      if (String(line || '').includes('-->')) {
        inHtmlComment = false;
      }
      continue;
    }

    if (rawHtmlBlockTag) {
      output.push(line);
      if (new RegExp(`</${rawHtmlBlockTag}\\s*>`, 'i').test(String(line || ''))) {
        rawHtmlBlockTag = '';
      }
      continue;
    }

    if (/^(?: {4}|\t)/.test(String(line || ''))) {
      output.push(line);
      continue;
    }

    if (/^\s{0,3}<!--/.test(String(line || '')) && !String(line || '').includes('-->')) {
      inHtmlComment = true;
      output.push(line);
      continue;
    }

    const rawBlockMatch = String(line || '').match(/^\s{0,3}<([A-Za-z][\w:-]*)(?:\s[^<>]*)?>\s*$/);
    const rawBlockTag = String(rawBlockMatch?.[1] || '').toLowerCase();
    const isSelfClosingRawBlock = /\/\s*>\s*$/.test(String(line || ''));
    if (
      rawBlockMatch
      && !isHtmlVoidTag(rawBlockTag)
      && !isSelfClosingRawBlock
      && !new RegExp(`</${rawBlockTag}\\s*>`, 'i').test(String(line || ''))
    ) {
      rawHtmlBlockTag = rawBlockTag;
      output.push(line);
      continue;
    }

    const protectedRanges = [
      ...findInlineCodeRanges(line),
      ...findHtmlTagRanges(line),
      ...findHtmlElementContentRanges(line),
      ...findMarkdownLinkLabelRanges(line),
    ];

    output.push(replaceLocalMarkdownImagesInLine(line, protectedRanges));
  }

  return output.join('\n');
}

function extractImageSwipeItalicCaption(lines, imageIndex) {
  for (let i = imageIndex + 1; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;
    if (parseImageSwipeMarkdownLine(line)) return '';
    const match = line.match(/^(?:\*|_)(.+?)(?:\*|_)$/);
    return match ? String(match[1] || '').trim() : '';
  }
  return '';
}

function collectImageSwipeImages(blockLines) {
  const images = [];
  for (let i = 0; i < blockLines.length; i += 1) {
    const image = parseImageSwipeMarkdownLine(blockLines[i]);
    if (!image) continue;
    const caption = image.alt || extractImageSwipeItalicCaption(blockLines, i);
    images.push({ ...image, alt: caption });
  }
  return images;
}

function hasRemoteImageSwipeImage(blockLines) {
  return collectImageSwipeImages(blockLines).some((image) => isImageSwipeRemoteSrc(image.src));
}

function normalizeBareRemoteImageSwipeQuoteLine(line) {
  const match = String(line || '').match(/^(\s{0,3}>\s?)([\s\S]*)$/);
  if (!match) return line;
  const image = parseImageSwipeBareRemoteUrlLine(match[2]);
  if (!image) return line;
  return `${match[1]}![](${image.src})`;
}

function renderImageSwipeHtmlBlock(type, blockLines, optionText) {
  const images = collectImageSwipeImages(blockLines);
  if (!images.length) return null;

  const attrs = [
    'data-owc-image-swipe="1"',
    `data-owc-image-swipe-type="${type}"`,
  ];
  if (type === 'image-sensitive') {
    attrs.push(`data-owc-image-swipe-warning="${escapeImageSwipeHtmlAttr(encodeImageSwipeValue(optionText || IMAGE_SWIPE_DEFAULT_WARNING))}"`);
  } else {
    attrs.push(`data-owc-image-swipe-hint="${escapeImageSwipeHtmlAttr(encodeImageSwipeValue(optionText || IMAGE_SWIPE_DEFAULT_HINT))}"`);
  }

  return [
    `<section ${attrs.join(' ')}>`,
    ...images.map((image) => renderImageSwipeImgTag(image)),
    '</section>',
  ];
}

function parseImageSwipeCalloutOpen(line) {
  const match = String(line || '').match(/^\s{0,3}>\s?\[!\s*([a-z-]+)\s*](?:[+-])?\s*(.*)$/i);
  if (!match) return null;
  const type = String(match[1] || '').toLowerCase();
  if (!IMAGE_SWIPE_TYPES.has(type)) return null;
  return {
    type,
    optionText: String(match[2] || '').trim(),
  };
}

function stripSingleQuotePrefix(line) {
  return String(line || '').replace(/^\s{0,3}>\s?/, '');
}

function preprocessImageSwipeCallouts(markdown) {
  const lines = String(markdown || '').split('\n');
  const output = [];
  let fenceState = null;
  let inMathFence = false;

  for (let i = 0; i < lines.length;) {
    const fenceDelimiter = parseFencedBlockDelimiter(lines[i]);
    if (fenceDelimiter) {
      if (!fenceState) {
        fenceState = fenceDelimiter;
      } else if (
        fenceDelimiter.marker === fenceState.marker &&
        fenceDelimiter.length >= fenceState.length
      ) {
        fenceState = null;
      }
      output.push(lines[i]);
      i += 1;
      continue;
    }

    if (!fenceState && isMathFenceDelimiter(lines[i])) {
      inMathFence = !inMathFence;
      output.push(lines[i]);
      i += 1;
      continue;
    }

    if (fenceState || inMathFence) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    const callout = parseImageSwipeCalloutOpen(lines[i]);
    if (!callout) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    const originalLines = [lines[i]];
    const blockLines = [];
    i += 1;
    while (i < lines.length && isQuoteLine(lines[i])) {
      originalLines.push(lines[i]);
      blockLines.push(stripSingleQuotePrefix(lines[i]));
      i += 1;
    }

    if (hasRemoteImageSwipeImage(blockLines)) {
      output.push(...originalLines.map((line, index) => (
        index === 0 ? line : normalizeBareRemoteImageSwipeQuoteLine(line)
      )));
      continue;
    }

    const rendered = renderImageSwipeHtmlBlock(callout.type, blockLines, callout.optionText);
    if (rendered) {
      output.push(...rendered);
    } else {
      output.push(...originalLines);
    }
  }

  return output.join('\n');
}

/**
 * Preprocess markdown for triplet rendering.
 * Returns an object with processed markdown and pre-rendered math formulas.
 * This function is pure - no global state is used.
 * @returns {{ markdown: string, mathFormulas: Array }}
 */
function preprocessMarkdownForTriplet(markdown, converter) {
  let output = preprocessImageSwipeCallouts(markdown);

  // Align with converter.convert preprocessing to reduce non-semantic parity noise.
  output = output.replace(/^[\t ]+(\$\$)/gm, '$1');
  output = output.replace(/!\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (match, imagePath, alt) => {
    const normalizedPath = String(imagePath || '').trim();
    return `![${alt || getImageCaptionFromPath(normalizedPath)}](${encodeURI(normalizedPath)})`;
  });
  output = materializeLocalMarkdownImages(output);

  if (converter && typeof converter.stripFrontmatter === 'function') {
    output = converter.stripFrontmatter(output);
  }

  // Pre-render math formulas using markdown-it + MathJax before Obsidian renders
  // This is needed because Obsidian's MarkdownRenderer.renderMarkdown doesn't render LaTeX
  const { markdown: mathProcessed, formulas: mathFormulas } = preRenderMathFormulas(output, converter);
  output = mathProcessed;

  // Escape pseudo-HTML tags that look like HTML but are actually text
  // For example: <Title>_xxx_MS.pdf should render as text, not as an HTML tag
  output = escapePseudoHtmlTags(output);

  output = neutralizeUnsafeMarkdownLinks(output);
  output = neutralizePlainWikilinks(output);

  // Legacy converter runs markdown-it with breaks=true. Normalize soft line breaks
  // so Obsidian renderer emits equivalent <br> in common paragraph text.
  output = injectHardBreaksForLegacyParity(output);

  return { markdown: output, mathFormulas };
}

function countUnresolvedImageEmbeds(root) {
  if (!root) return 0;
  const embeds = Array.from(root.querySelectorAll('span.internal-embed,span.image-embed,div.internal-embed,div.image-embed'));
  let unresolved = 0;
  for (const embed of embeds) {
    const isImageEmbed = embed.classList.contains('image-embed');
    const hasImgChild = !!embed.querySelector('img');
    if (isImageEmbed && !hasImgChild) {
      unresolved += 1;
    }
  }
  return unresolved;
}

function shouldObserveMermaidRenderWindow(markdown) {
  const lines = String(markdown || '').split('\n');
  let fenceState = null;

  for (const line of lines) {
    const delimiter = parseFencedBlockDelimiter(line);
    if (!delimiter) continue;

    if (!fenceState) {
      const infoString = String(line || '').replace(/^\s{0,3}(?:`{3,}|~{3,})/, '').trim().toLowerCase();
      if (infoString === 'mermaid' || infoString.startsWith('mermaid ')) {
        return true;
      }
      fenceState = delimiter;
      continue;
    }

    if (delimiter.marker === fenceState.marker && delimiter.length >= fenceState.length) {
      fenceState = null;
    }
  }

  return false;
}

function collectMermaidHostElements(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const elements = Array.from(root.querySelectorAll('*')).filter((el) => hasMermaidMarker(el));
  return elements.filter((el) => {
    if (el.closest('mjx-container')) return false;
    const tagName = el.tagName?.toLowerCase?.();
    if (tagName === 'pre' || tagName === 'code') return false;
    return true;
  });
}

function countRenderedMermaidDiagrams(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  const svgCount = Array.from(root.querySelectorAll('svg')).filter(looksLikeMermaidSvg).length;
  const imageCount = root.querySelectorAll('img.mermaid-diagram-image').length;
  return svgCount + imageCount;
}

function countPendingMermaidHosts(root) {
  const hosts = collectMermaidHostElements(root);
  let pending = 0;
  for (const host of hosts) {
    if (host.tagName?.toLowerCase?.() === 'svg') continue;
    if (host.tagName?.toLowerCase?.() === 'img' && host.classList.contains('mermaid-diagram-image')) continue;
    const hasRenderedSvg = Array.from(host.querySelectorAll('svg')).some(looksLikeMermaidSvg);
    const hasRenderedImage = !!host.querySelector('img.mermaid-diagram-image');
    if (!hasRenderedSvg && !hasRenderedImage) {
      pending += 1;
    }
  }
  return pending;
}

function normalizeReferenceLabel(label) {
  return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractInlineImageTarget(rawTarget) {
  const value = String(rawTarget || '').trim();
  if (!value) return '';
  if (value.startsWith('<')) {
    const endIndex = value.indexOf('>');
    if (endIndex > 1) {
      return value.slice(1, endIndex).trim();
    }
  }
  return value.split(/\s+/)[0] || '';
}

function collectImageTargets(markdown) {
  const source = String(markdown || '');
  const targets = [];
  if (!source || !source.includes('![')) return targets;

  const referenceTargets = new Map();
  const referenceDefinitionPattern = /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>\r\n]+)>|(\S+))/gm;
  let definitionMatch = referenceDefinitionPattern.exec(source);
  while (definitionMatch) {
    const label = normalizeReferenceLabel(definitionMatch[1]);
    const target = String(definitionMatch[2] || definitionMatch[3] || '').trim();
    if (label && target && !referenceTargets.has(label)) {
      referenceTargets.set(label, target);
    }
    definitionMatch = referenceDefinitionPattern.exec(source);
  }

  const inlineImagePattern = /!\[[^\]]*]\(([^)\r\n]+)\)/g;
  let inlineMatch = inlineImagePattern.exec(source);
  while (inlineMatch) {
    targets.push(extractInlineImageTarget(inlineMatch[1]));
    inlineMatch = inlineImagePattern.exec(source);
  }

  const fullReferenceImagePattern = /!\[([^\]]*)]\[([^\]]*)]/g;
  let fullReferenceMatch = fullReferenceImagePattern.exec(source);
  while (fullReferenceMatch) {
    const fallbackLabel = String(fullReferenceMatch[1] || '');
    const refLabel = String(fullReferenceMatch[2] || '');
    const normalizedLabel = normalizeReferenceLabel(refLabel || fallbackLabel);
    targets.push(referenceTargets.get(normalizedLabel) || '');
    fullReferenceMatch = fullReferenceImagePattern.exec(source);
  }

  const shortcutReferenceImagePattern = /!\[([^\]]+)](?![\[(])/g;
  let shortcutReferenceMatch = shortcutReferenceImagePattern.exec(source);
  while (shortcutReferenceMatch) {
    const label = normalizeReferenceLabel(shortcutReferenceMatch[1]);
    targets.push(referenceTargets.get(label) || '');
    shortcutReferenceMatch = shortcutReferenceImagePattern.exec(source);
  }

  return targets;
}

function shouldObserveAsyncEmbedWindow(markdown) {
  const source = String(markdown || '');
  if (!source || !source.includes('![')) return false;

  const targets = collectImageTargets(source);
  if (targets.length === 0) {
    // Unknown image syntax: keep conservative short observe window.
    return true;
  }

  for (const item of targets) {
    // collectImageTargets already strips angle brackets via extractInlineImageTarget
    // and referenceDefinitionPattern's capturing groups.
    const target = String(item || '').trim().toLowerCase();
    if (!target) return true;

    // Remote/data images are rendered directly; local-like paths may resolve
    // asynchronously via Obsidian embed pipeline.
    const isRemoteLike = (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('data:')
    );
    if (!isRemoteLike) return true;
  }

  return false;
}

async function waitForTripletDomToSettle(root, options = {}) {
  if (!root) return;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 500;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 16;
  const observeMermaid = options.observeMermaid === true;
  const minObserveMs = Number.isFinite(options.minObserveMs)
    ? Math.max(0, Math.floor(options.minObserveMs))
    : Math.min(48, timeoutMs);
  const mermaidObserveMs = observeMermaid
    ? (
      Number.isFinite(options.mermaidObserveMs)
        ? Math.max(0, Math.floor(options.mermaidObserveMs))
        : Math.min(180, timeoutMs)
    )
    : 0;

  const start = Date.now();
  let unresolved = countUnresolvedImageEmbeds(root);
  let renderedMermaid = observeMermaid ? countRenderedMermaidDiagrams(root) : 0;
  let pendingMermaid = observeMermaid ? countPendingMermaidHosts(root) : 0;
  const initialObserveMs = Math.max(minObserveMs, mermaidObserveMs);

  if (unresolved === 0 && renderedMermaid === 0 && pendingMermaid === 0 && initialObserveMs <= 0) {
    return;
  }

  // Fast path with a short observation window: avoid waiting full settle time
  // while still catching delayed async embed insertion after render.
  if (unresolved === 0 && renderedMermaid === 0 && pendingMermaid === 0 && initialObserveMs > 0) {
    while (Date.now() - start < initialObserveMs) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      unresolved = countUnresolvedImageEmbeds(root);
      renderedMermaid = observeMermaid ? countRenderedMermaidDiagrams(root) : 0;
      pendingMermaid = observeMermaid ? countPendingMermaidHosts(root) : 0;
      if (unresolved > 0 || renderedMermaid > 0 || pendingMermaid > 0) break;
    }
    if (unresolved === 0 && renderedMermaid === 0 && pendingMermaid === 0) return;
  }

  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    unresolved = countUnresolvedImageEmbeds(root);
    renderedMermaid = observeMermaid ? countRenderedMermaidDiagrams(root) : 0;
    pendingMermaid = observeMermaid ? countPendingMermaidHosts(root) : 0;
    const mermaidReady = !observeMermaid || (
      (pendingMermaid === 0 && renderedMermaid > 0)
      || (pendingMermaid === 0 && renderedMermaid === 0 && (Date.now() - start >= mermaidObserveMs))
    );
    if (unresolved === 0 && mermaidReady) {
      stableCount += 1;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function renderByObsidianMarkdownRenderer({
  app,
  markdown,
  sourcePath,
  targetEl,
  component = null,
  markdownRenderer = MarkdownRenderer,
}) {
  if (!markdownRenderer) {
    throw new Error('Obsidian MarkdownRenderer is not available');
  }

  if (typeof markdownRenderer.renderMarkdown === 'function') {
    await markdownRenderer.renderMarkdown(markdown, targetEl, sourcePath || '', component);
    return;
  }

  if (typeof markdownRenderer.render === 'function') {
    if (!app) throw new Error('Obsidian app instance is required for MarkdownRenderer.render');
    await markdownRenderer.render(app, markdown, targetEl, sourcePath || '', component);
    return;
  }

  throw new Error('Obsidian MarkdownRenderer does not expose renderMarkdown/render');
}

async function renderObsidianTripletMarkdown({
  app,
  converter,
  markdown,
  sourcePath = '',
  component = null,
  settings = {},
  markdownRenderer = MarkdownRenderer,
  serializer = serializeObsidianRenderedHtml,
  mermaidCodeRenderer = renderMermaidCodeBlocks,
  mermaidRasterizer = rasterizeRenderedMermaidDiagrams,
  mermaidApi = null,
  rasterizeMermaid = true,
  preserveSvgStyleTags = false,
}) {
  if (typeof document === 'undefined') {
    throw new Error('Triplet renderer requires DOM environment');
  }
  if (!converter) {
    throw new Error('Triplet renderer requires converter runtime');
  }

  const container = document.createElement('div');
  const { markdown: preparedMarkdown, mathFormulas } = preprocessMarkdownForTriplet(markdown, converter);

  const shouldObserveWindow = shouldObserveAsyncEmbedWindow(markdown) || shouldObserveAsyncEmbedWindow(preparedMarkdown);
  const shouldObserveMermaid = shouldObserveMermaidRenderWindow(preparedMarkdown);
  await renderByObsidianMarkdownRenderer({
    app,
    markdown: preparedMarkdown,
    sourcePath,
    targetEl: container,
    component,
    markdownRenderer,
  });

  // Wait for image embeds to settle; MarkdownRenderer may resolve embeds asynchronously.
  await waitForTripletDomToSettle(container, {
    minObserveMs: shouldObserveWindow ? void 0 : 0,
    observeMermaid: shouldObserveMermaid,
  });
  await mermaidCodeRenderer(container, { mermaidApi });
  normalizeRenderedMermaidDiagrams(container);
  if (rasterizeMermaid !== false) {
    await mermaidRasterizer(container);
  }

  normalizeRenderedDomPunctuation(container, {
    enabled: settings.normalizeChinesePunctuation === true,
  });

  const serializedHtml = serializer({
    root: container,
    converter,
    sourcePath,
    app,
    preRenderedMath: mathFormulas,
    preserveSvgStyleTags,
  });

  return serializedHtml;
}

module.exports = {
  neutralizeUnsafeMarkdownLinks,
  neutralizePlainWikilinks,
  preprocessMarkdownForTriplet,
  injectHardBreaksForLegacyParity,
  normalizeRenderedDomPunctuation,
  shouldObserveAsyncEmbedWindow,
  shouldObserveMermaidRenderWindow,
  waitForTripletDomToSettle,
  renderByObsidianMarkdownRenderer,
  renderObsidianTripletMarkdown,
};
