import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders headings one level down (the page owns h1)', () => {
    expect(renderMarkdown('# One\n## Two\n### Three')).toBe('<h2>One</h2>\n<h3>Two</h3>\n<h4>Three</h4>');
  });

  it('does not treat four hashes as a heading', () => {
    expect(renderMarkdown('#### Nope')).toBe('<p>#### Nope</p>');
  });

  it('joins consecutive lines into one paragraph and splits on blank lines', () => {
    expect(renderMarkdown('a\nb\n\nc')).toBe('<p>a b</p>\n<p>c</p>');
  });

  it('renders bullet lists with - and *', () => {
    expect(renderMarkdown('- one\n* two')).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
  });

  it('renders numbered lists with . and )', () => {
    expect(renderMarkdown('1. one\n2) two')).toBe('<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
  });

  it('closes one list before starting another of a different kind', () => {
    expect(renderMarkdown('- a\n1. b')).toBe('<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>');
  });

  it('ends a list at a paragraph, and a paragraph at a list', () => {
    expect(renderMarkdown('para\n- item\ntext')).toBe('<p>para</p>\n<ul>\n<li>item</li>\n</ul>\n<p>text</p>');
  });

  it('renders bold, italic and code inline', () => {
    expect(renderMarkdown('**bold** and *italic* and `code`')).toBe('<p><strong>bold</strong> and <em>italic</em> and <code>code</code></p>');
  });

  it('applies inline formatting inside headings and list items', () => {
    expect(renderMarkdown('# A **b**')).toContain('<h2>A <strong>b</strong></h2>');
    expect(renderMarkdown('- *c*')).toContain('<li><em>c</em></li>');
  });

  it('copes with CRLF line endings and empty input', () => {
    expect(renderMarkdown('a\r\n\r\nb')).toBe('<p>a</p>\n<p>b</p>');
    expect(renderMarkdown('')).toBe('');
  });

  describe('escaping', () => {
    const attack = '<script>alert(1)</script>';
    const parse = (html) => {
      const box = document.createElement('div');
      box.innerHTML = html;
      return box;
    };

    it.each([
      ['paragraph', attack],
      ['heading', `# ${attack}`],
      ['bullet item', `- ${attack}`],
      ['numbered item', `1. ${attack}`],
      ['bold', `**${attack}**`],
      ['code', `\`${attack}\``],
    ])('never produces a script element in a %s', (_name, source) => {
      const html = renderMarkdown(source);
      expect(html).not.toContain('<script');
      expect(parse(html).querySelector('script')).toBeNull();
      expect(parse(html).textContent).toContain('<script>alert(1)</script>');
    });

    it('escapes ampersands, angle brackets and quotes', () => {
      expect(renderMarkdown('a & b < c > d "e"')).toBe('<p>a &amp; b &lt; c &gt; d &quot;e&quot;</p>');
    });

    it('cannot break out into attributes or elements', () => {
      const box = parse(renderMarkdown('"><img src=x onerror=alert(1)> **"><b onclick=x>**'));
      expect(box.querySelector('img')).toBeNull();
      expect(box.querySelector('[onclick]')).toBeNull();
      expect(box.querySelector('[onerror]')).toBeNull();
      expect([...box.querySelectorAll('*')].map((e) => e.tagName)).toEqual(['P', 'STRONG']);
    });

    it('does not double-unescape entities', () => {
      expect(renderMarkdown('&lt;b&gt;')).toBe('<p>&amp;lt;b&amp;gt;</p>');
    });

    it('produces only the expected tags from a hostile heading and list', () => {
      const box = parse(renderMarkdown('# <img src=x onerror=1>\n- <a href="javascript:1">x</a>\n- <iframe>'));
      expect([...box.querySelectorAll('*')].map((e) => e.tagName)).toEqual(['H2', 'UL', 'LI', 'LI']);
    });
  });
});
