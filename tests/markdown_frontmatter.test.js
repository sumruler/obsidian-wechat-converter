import { describe, it, expect } from 'vitest';

const { stripMarkdownFrontmatter } = require('../services/markdown-utils.js');

describe('stripMarkdownFrontmatter', () => {
  it('removes YAML frontmatter at the start of a note', () => {
    const markdown = [
      '---',
      'title: Demo',
      'tags:',
      '  - obsidian',
      '---',
      '# 正文',
      '',
      '内容',
    ].join('\n');

    expect(stripMarkdownFrontmatter(markdown)).toBe('# 正文\n\n内容');
  });

  it('supports CRLF and YAML document end markers', () => {
    const markdown = '---\r\ntitle: Demo\r\n...\r\n# 正文';

    expect(stripMarkdownFrontmatter(markdown)).toBe('# 正文');
  });

  it('does not remove horizontal rules outside the opening frontmatter block', () => {
    const markdown = '# 正文\n\n---\n\n后续内容';

    expect(stripMarkdownFrontmatter(markdown)).toBe(markdown);
  });
});
