import { describe, it, expect, vi } from 'vitest';

const {
  collectArticleImageReferences,
  replaceArticleContentImageSources,
  resolveArticleImages,
} = require('../services/article-image-assets');

function pngBytes(size = 16) {
  const bytes = Buffer.alloc(size);
  bytes[0] = 0x89;
  bytes.write('PNG', 1, 'ascii');
  return bytes;
}

function makeApp(files = {}) {
  const byPath = new Map(Object.entries(files));
  return {
    metadataCache: {
      getFirstLinkpathDest: vi.fn((linkpath) => byPath.get(linkpath) || null),
    },
    vault: {
      getAbstractFileByPath: vi.fn((filePath) => byPath.get(filePath) || null),
      getResourcePath: vi.fn((file) => `app://local/${encodeURIComponent(file.path)}`),
      readBinary: vi.fn(async (file) => file.bytes),
    },
  };
}

describe('article image asset resolver', () => {
  it('collects markdown and wikilink image references', () => {
    const refs = collectArticleImageReferences('a ![[img one.png|示例]] b ![alt](https://example.com/a.png)');

    expect(refs.map((ref) => ({ type: ref.type, src: ref.src, alt: ref.alt }))).toEqual([
      { type: 'wiki', src: 'img one.png', alt: '示例' },
      { type: 'markdown', src: 'https://example.com/a.png', alt: 'alt' },
    ]);
  });

  it('ignores image-looking markdown inside fenced code blocks', () => {
    const refs = collectArticleImageReferences([
      '```md',
      '![example](local.png)',
      '![[also-local.png]]',
      '```',
      '',
      '![real](real.png)',
    ].join('\n'));

    expect(refs.map((ref) => ref.src)).toEqual(['real.png']);
  });

  it('turns local wikilinks and relative markdown images into bridge assets', async () => {
    const imageFile = {
      path: 'notes/assets/local.png',
      name: 'local.png',
      extension: 'png',
      bytes: pngBytes(24),
    };
    const app = makeApp({
      'assets/local.png': imageFile,
      'notes/assets/local.png': imageFile,
    });

    const result = await resolveArticleImages(
      '![[assets/local.png|图一]]\n\n![again](assets/local.png)\n\n![remote](https://cdn.example.com/a.png)',
      { path: 'notes/post.md', basename: 'post' },
      { app }
    );

    expect(result.warnings).toEqual([]);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      id: 'image-1',
      filename: 'local.png',
      mimeType: 'image/png',
      size: 24,
      source: {
        kind: 'obsidian-local',
        originalSrc: 'assets/local.png',
        notePath: 'notes/post.md',
        vaultRelativePath: 'notes/assets/local.png',
      },
    });
    expect(result.markdown).toContain('![图一](asset://image-1)');
    expect(result.markdown).toContain('![again](asset://image-1)');
    expect(result.markdown).toContain('![remote](https://cdn.example.com/a.png)');
  });

  it('reports missing and oversized local images before bridge delivery', async () => {
    const imageFile = {
      path: 'big.png',
      name: 'big.png',
      extension: 'png',
      bytes: pngBytes(8),
    };
    const app = makeApp({ 'big.png': imageFile });

    const result = await resolveArticleImages('![big](big.png)\n\n![missing](missing.png)', { path: 'post.md' }, {
      app,
      maxImageSizeBytes: 4,
    });

    expect(result.assets).toHaveLength(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'image_too_large',
      'image_local_missing',
    ]);
  });

  it('rewrites prepared HTML local image src values with asset placeholders', () => {
    const html = '<p><img src="app://local/notes%2Fassets%2Flocal.png" alt="x"></p>';
    const output = replaceArticleContentImageSources(html, [{
      id: 'image-1',
      source: {
        originalSrc: 'assets/local.png',
        resourceSrc: 'app://local/notes%2Fassets%2Flocal.png',
        vaultRelativePath: 'notes/assets/local.png',
      },
    }]);

    expect(output).toContain('src="asset://image-1"');
  });
});
