const path = require('path');

const DEFAULT_MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const RECOGNIZED_UNSUPPORTED_IMAGE_MIME_BY_EXT = {
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
};

function normalizePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

function getExtension(filename) {
  const ext = String(filename || '').split('?')[0].split('#')[0].split('.').pop();
  return ext && ext !== filename ? ext.toLowerCase() : '';
}

function isRemoteImageSrc(src) {
  return /^https?:\/\//i.test(String(src || '').trim());
}

function isDataImageSrc(src) {
  return /^data:image\//i.test(String(src || '').trim());
}

function isAssetImageSrc(src) {
  return /^asset:\/\//i.test(String(src || '').trim());
}

function isFileUrl(src) {
  return /^file:\/\//i.test(String(src || '').trim());
}

function getFilenameFromPath(src) {
  const value = String(src || '').split('?')[0].split('#')[0].replace(/\\/g, '/');
  const filename = value.split('/').filter(Boolean).pop();
  return filename || 'image';
}

function stripMarkdownDestination(rawDestination) {
  const raw = String(rawDestination || '').trim();
  if (raw.startsWith('<')) {
    const end = raw.indexOf('>');
    if (end > 0) return raw.slice(1, end).trim();
  }
  return raw.replace(/\\([()])/g, '$1').trim();
}

function splitWikiEmbedTarget(rawTarget) {
  const parts = String(rawTarget || '').split('|');
  const src = (parts.shift() || '').trim();
  const alias = parts.join('|').trim();
  return { src, alias };
}

function createAltFromSrc(src, fallback = '图片') {
  const filename = getFilenameFromPath(src);
  return filename.replace(/\.(png|jpe?g|gif|webp|svg|heic|heif|avif)$/i, '') || fallback;
}

function collectWikiImageEmbeds(markdown) {
  const results = [];
  const pattern = /!\[\[([^\]\n]+?)\]\]/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    const { src, alias } = splitWikiEmbedTarget(match[1]);
    if (!src) continue;
    results.push({
      type: 'wiki',
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      src,
      alt: alias || createAltFromSrc(src),
    });
  }
  return results;
}

function collectMarkdownImages(markdown) {
  const results = [];
  let index = 0;
  while (index < markdown.length) {
    const start = markdown.indexOf('![', index);
    if (start < 0) break;

    let cursor = start + 2;
    let escaped = false;
    let altEnd = -1;
    while (cursor < markdown.length) {
      const char = markdown[cursor];
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === ']') {
        altEnd = cursor;
        break;
      }
      cursor += 1;
    }
    if (altEnd < 0 || markdown[altEnd + 1] !== '(') {
      index = start + 2;
      continue;
    }

    const destinationStart = altEnd + 2;
    cursor = destinationStart;
    let depth = 0;
    escaped = false;
    let destinationEnd = -1;
    while (cursor < markdown.length) {
      const char = markdown[cursor];
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        if (depth === 0) {
          destinationEnd = cursor;
          break;
        }
        depth -= 1;
      }
      cursor += 1;
    }
    if (destinationEnd < 0) {
      index = start + 2;
      continue;
    }

    const alt = markdown.slice(start + 2, altEnd);
    const destination = stripMarkdownDestination(markdown.slice(destinationStart, destinationEnd));
    if (destination) {
      results.push({
        type: 'markdown',
        start,
        end: destinationEnd + 1,
        raw: markdown.slice(start, destinationEnd + 1),
        src: destination,
        alt,
      });
    }
    index = destinationEnd + 1;
  }
  return results;
}

function collectFencedCodeRanges(markdown) {
  const ranges = [];
  const fencePattern = /^( {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
  let match;
  let open = null;
  while ((match = fencePattern.exec(markdown)) !== null) {
    const marker = match[2][0];
    const length = match[2].length;
    if (!open) {
      open = { start: match.index, marker, length };
      continue;
    }
    if (open.marker === marker && length >= open.length) {
      ranges.push({ start: open.start, end: match.index + match[0].length });
      open = null;
    }
  }
  if (open) ranges.push({ start: open.start, end: markdown.length });
  return ranges;
}

function isInsideRanges(index, ranges) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function collectArticleImageReferences(markdown) {
  const codeRanges = collectFencedCodeRanges(markdown);
  return [
    ...collectWikiImageEmbeds(markdown),
    ...collectMarkdownImages(markdown),
  ]
    .filter((ref) => !isInsideRanges(ref.start, codeRanges))
    .sort((a, b) => a.start - b.start);
}

function bufferFromBinary(binary) {
  if (Buffer.isBuffer(binary)) return binary;
  if (binary instanceof ArrayBuffer) return Buffer.from(binary);
  if (ArrayBuffer.isView(binary)) {
    return Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength);
  }
  return Buffer.from(binary || []);
}

function inferMimeType(filename, buffer) {
  const ext = getExtension(filename);
  if (SUPPORTED_IMAGE_MIME_BY_EXT[ext]) return SUPPORTED_IMAGE_MIME_BY_EXT[ext];
  if (RECOGNIZED_UNSUPPORTED_IMAGE_MIME_BY_EXT[ext]) {
    return RECOGNIZED_UNSUPPORTED_IMAGE_MIME_BY_EXT[ext];
  }
  if (buffer?.length >= 12) {
    if (buffer[0] === 0x89 && buffer.slice(1, 4).toString('ascii') === 'PNG') return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
    if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  }
  return ext ? `image/${ext}` : 'application/octet-stream';
}

function createWarning(code, message, details = {}) {
  return {
    code,
    message,
    severity: details.severity || 'error',
    src: details.src || '',
    filename: details.filename || '',
    size: details.size || 0,
  };
}

function isSupportedImageFile(filename) {
  return !!SUPPORTED_IMAGE_MIME_BY_EXT[getExtension(filename)];
}

function isRecognizedUnsupportedImageFile(filename) {
  return !!RECOGNIZED_UNSUPPORTED_IMAGE_MIME_BY_EXT[getExtension(filename)];
}

function getNoteSourcePath(noteFile) {
  return typeof noteFile?.path === 'string' ? noteFile.path : '';
}

function resolveVaultFile(app, src, noteFile) {
  if (!app || !src) return null;
  const decoded = (() => {
    try {
      return decodeURI(src);
    } catch {
      return src;
    }
  })();
  const sourcePath = getNoteSourcePath(noteFile);
  const metadataCache = app.metadataCache;
  const vault = app.vault;

  try {
    const linked = metadataCache?.getFirstLinkpathDest?.(decoded, sourcePath);
    if (linked?.extension) return linked;
  } catch {
    // Fall through to path-based candidates.
  }

  const candidates = [];
  const normalized = normalizePath(decoded);
  if (normalized) candidates.push(normalized);
  if (sourcePath && normalized && !normalized.startsWith('/')) {
    const noteDir = path.posix.dirname(normalizePath(sourcePath));
    candidates.push(normalizePath(path.posix.join(noteDir === '.' ? '' : noteDir, normalized)));
  }

  for (const candidate of candidates) {
    try {
      const file = vault?.getAbstractFileByPath?.(candidate);
      if (file?.extension) return file;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function readFileUrlAsset(src) {
  const fs = require('fs/promises');
  const { fileURLToPath } = require('url');
  const filePath = fileURLToPath(src);
  const buffer = await fs.readFile(filePath);
  return {
    buffer,
    filename: getFilenameFromPath(filePath),
    vaultRelativePath: '',
    resourceSrc: '',
  };
}

async function readVaultAsset(app, file) {
  const binary = await app.vault.readBinary(file);
  const buffer = bufferFromBinary(binary);
  let resourceSrc = '';
  try {
    resourceSrc = app.vault.getResourcePath?.(file) || '';
  } catch {
    resourceSrc = '';
  }
  return {
    buffer,
    filename: file.name || getFilenameFromPath(file.path),
    vaultRelativePath: file.path || '',
    resourceSrc,
  };
}

function makeAssetId(index) {
  return `image-${index}`;
}

function createMarkdownImage(alt, src) {
  const safeAlt = String(alt || createAltFromSrc(src)).replace(/\]/g, '\\]');
  return `![${safeAlt}](${src})`;
}

function replaceRanges(markdown, replacements) {
  return replacements
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((output, item) => (
      output.slice(0, item.start) + item.value + output.slice(item.end)
    ), markdown);
}

function isLocalLikeSrc(src) {
  if (!src) return false;
  if (isRemoteImageSrc(src) || isDataImageSrc(src) || isAssetImageSrc(src)) return false;
  return true;
}

async function resolveLocalImageAsset({
  app,
  src,
  noteFile,
  assetIndex,
  originalSrc = src,
  existingByKey,
  limits,
}) {
  let file = null;
  let readResult = null;
  let cacheKey = '';

  if (isFileUrl(src)) {
    cacheKey = `file:${src}`;
  } else {
    file = resolveVaultFile(app, src, noteFile);
    if (!file) {
      return {
        warning: createWarning('image_local_missing', '本地图片未找到', { src: originalSrc }),
      };
    }
    cacheKey = `vault:${file.path || src}`;
  }

  if (existingByKey.has(cacheKey)) {
    return { asset: existingByKey.get(cacheKey), reused: true };
  }

  try {
    readResult = file ? await readVaultAsset(app, file) : await readFileUrlAsset(src);
  } catch (error) {
    return {
      warning: createWarning('image_local_read_failed', `读取本地图片失败：${error.message || String(error)}`, {
        src: originalSrc,
        filename: file?.name || getFilenameFromPath(src),
      }),
    };
  }

  const { buffer, filename, vaultRelativePath, resourceSrc } = readResult;
  const mimeType = inferMimeType(filename, buffer);
  const size = buffer.length;

  if (!isSupportedImageFile(filename)) {
    const code = isRecognizedUnsupportedImageFile(filename) ? 'image_invalid_mime' : 'image_invalid_mime';
    return {
      warning: createWarning(code, `暂不支持该图片格式：${filename}`, {
        src: originalSrc,
        filename,
        size,
      }),
    };
  }

  if (size > limits.maxImageSizeBytes) {
    return {
      warning: createWarning('image_too_large', `图片超过 ${Math.round(limits.maxImageSizeBytes / 1024 / 1024)} MB：${filename}`, {
        src: originalSrc,
        filename,
        size,
      }),
    };
  }

  const asset = {
    id: makeAssetId(assetIndex),
    filename,
    mimeType,
    size,
    base64: buffer.toString('base64'),
    source: {
      kind: 'obsidian-local',
      originalSrc,
      notePath: getNoteSourcePath(noteFile),
      vaultRelativePath,
    },
  };
  if (resourceSrc) asset.source.resourceSrc = resourceSrc;

  existingByKey.set(cacheKey, asset);
  return { asset };
}

function getFirstMarkdownImageSrc(markdown) {
  const first = collectArticleImageReferences(markdown)[0];
  return first?.src || '';
}

function replaceArticleContentImageSources(html, assets = []) {
  let output = String(html || '');
  for (const asset of assets) {
    const assetSrc = `asset://${asset.id}`;
    const candidates = [
      asset?.source?.resourceSrc,
      asset?.source?.originalSrc,
      asset?.source?.vaultRelativePath,
    ].filter(Boolean);
    for (const candidate of candidates) {
      output = output.replace(
        new RegExp(`(<img\\b[^>]*\\bsrc=["'])${escapeRegExp(candidate)}(["'][^>]*>)`, 'gi'),
        `$1${assetSrc}$2`
      );
    }
  }
  return output;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatArticleImageWarnings(warnings = []) {
  const items = warnings.filter((warning) => warning?.severity !== 'info');
  if (!items.length) return '';
  const preview = items.slice(0, 3).map((warning) => {
    const target = warning.filename || warning.src || '图片';
    return `${warning.message || '图片处理失败'}（${target}）`;
  }).join('；');
  const suffix = items.length > 3 ? `，另有 ${items.length - 3} 项` : '';
  return `${preview}${suffix}`;
}

async function resolveArticleImages(markdown, noteFile, options = {}) {
  const app = options.app;
  const limits = {
    maxImageSizeBytes: options.maxImageSizeBytes || DEFAULT_MAX_IMAGE_SIZE_BYTES,
    maxTotalImageSizeBytes: options.maxTotalImageSizeBytes || DEFAULT_MAX_TOTAL_IMAGE_SIZE_BYTES,
  };
  const sourceMarkdown = String(markdown || '');
  const references = collectArticleImageReferences(sourceMarkdown);
  const warnings = [];
  const replacements = [];
  const assets = [];
  const existingByKey = new Map();

  const resolveSrc = async (src, originalSrc = src) => {
    const trimmed = String(src || '').trim();
    if (!trimmed) return { src: trimmed };
    if (!isLocalLikeSrc(trimmed)) return { src: trimmed };
    if (!isFileUrl(trimmed) && /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      return {
        src: trimmed,
        warning: createWarning('image_unsupported_protocol', '不支持的图片地址', { src: originalSrc }),
      };
    }

    const result = await resolveLocalImageAsset({
      app,
      src: trimmed,
      noteFile,
      assetIndex: assets.length + 1,
      originalSrc,
      existingByKey,
      limits,
    });
    if (result.warning) return { src: trimmed, warning: result.warning };
    if (result.asset && !result.reused) assets.push(result.asset);
    return { src: `asset://${result.asset.id}`, asset: result.asset };
  };

  for (const ref of references) {
    const result = await resolveSrc(ref.src, ref.src);
    if (result.warning) {
      warnings.push(result.warning);
      continue;
    }
    if (result.src !== ref.src) {
      replacements.push({
        start: ref.start,
        end: ref.end,
        value: createMarkdownImage(ref.alt, result.src),
      });
    }
  }

  let cover = options.cover || '';
  if (cover && isLocalLikeSrc(cover)) {
    const coverResult = await resolveSrc(cover, cover);
    if (coverResult.warning) {
      warnings.push(coverResult.warning);
    } else {
      cover = coverResult.src;
    }
  }

  const totalSize = assets.reduce((sum, asset) => sum + (asset.size || 0), 0);
  if (totalSize > limits.maxTotalImageSizeBytes) {
    warnings.push(createWarning('image_too_large', `文章图片总量超过 ${Math.round(limits.maxTotalImageSizeBytes / 1024 / 1024)} MB`, {
      size: totalSize,
    }));
  }

  const resolvedMarkdown = replaceRanges(sourceMarkdown, replacements);
  return {
    markdown: resolvedMarkdown,
    assets,
    warnings,
    cover,
    firstImageSrc: getFirstMarkdownImageSrc(resolvedMarkdown),
  };
}

module.exports = {
  DEFAULT_MAX_IMAGE_SIZE_BYTES,
  DEFAULT_MAX_TOTAL_IMAGE_SIZE_BYTES,
  collectArticleImageReferences,
  formatArticleImageWarnings,
  getFirstMarkdownImageSrc,
  replaceArticleContentImageSources,
  resolveArticleImages,
};
