// A very small, safe Markdown renderer for the rules pages: headings, bullet and numbered lists, paragraphs,
// **bold**, *italic* and `code`. Everything is HTML-escaped first, so rules text can never inject markup.
// Depends on: nothing (used by useGameRules.js and the help pop-up).

// Returns `text` with the characters that matter in HTML turned into entities (done before any markup is added).
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Returns `text` escaped, with `code`, **bold** and *italic* spans turned into tags.
const inline = (text) =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

/**
 * Renders a small subset of Markdown (headings become h2-h4, lists, paragraphs, bold, italic, code) to safe HTML.
 * @param {*} source  the Markdown text (anything else is turned into a string first)
 * @returns {string}  HTML, one block per line
 * Side effects: none.
 */
export function renderMarkdown(source) {
  const out = [];
  let list = null; // 'ul' | 'ol'
  let paragraph = [];
  // Flushes the lines gathered so far as one <p>. Returns nothing.
  const closeParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  // Ends the open list, if any, with its closing tag. Returns nothing.
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const raw of String(source).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      closeParagraph();
      closeList();
    } else if (heading) {
      closeParagraph();
      closeList();
      out.push(`<h${heading[1].length + 1}>${inline(heading[2])}</h${heading[1].length + 1}>`);
    } else if (bullet || numbered) {
      closeParagraph();
      const wanted = bullet ? 'ul' : 'ol';
      if (list !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        list = wanted;
      }
      out.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
    } else {
      closeList();
      paragraph.push(line.trim());
    }
  }
  closeParagraph();
  closeList();
  return out.join('\n');
}
