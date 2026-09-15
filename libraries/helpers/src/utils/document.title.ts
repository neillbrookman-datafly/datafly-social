/**
 * The title LinkedIn shows on a document (carousel) post, when nobody typed one.
 *
 * LinkedIn requires a title and displays it on the carousel's title bar. It used
 * to default to "slides", which looks unfinished. The uploaded file's name is
 * nearly always the real title — Canva exports name the file (and the PDF's
 * own Title) after the design, e.g. "Carousel_You bought it on Tuesday.pdf" —
 * it just needs tidying.
 *
 * Shared by the editor (pre-fills the Document title field and the preview) and
 * the publisher (backstop when the field is empty), so both always agree.
 */

export const DEFAULT_DOCUMENT_TITLE = 'Carousel';

const MAX_LENGTH = 100;

// Names that say nothing about the content, left behind by tools and downloads.
const GENERIC = /^(untitled( design)?|document|download|file|export|scan|slides?|carousel|presentation|deck|pdf)$/i;

/** A tidy title from an uploaded file name, or '' if the name isn't useful. */
export function documentTitleFromFileName(fileName?: string | null): string {
  if (!fileName) {
    return '';
  }

  let name = fileName.split(/[\\/]/).pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not URI-encoded; use as is.
  }

  name = name
    .replace(/\.pdf$/i, '')
    .replace(/_+/g, ' ')
    // Leading "Carousel" / "LinkedIn carousel" is redundant — LinkedIn already
    // presents it as a carousel.
    .replace(/^\s*(linkedin\s+)?carousel\b[\s:\-–]*/i, '')
    // Duplicate-download suffixes: "Deck (1)".
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Our own stored upload names are random hex; never show those.
  if (!name || GENERIC.test(name) || /^[a-f0-9]{16,}$/i.test(name)) {
    return '';
  }

  if (name.length > MAX_LENGTH) {
    const cut = name.slice(0, MAX_LENGTH);
    name = (cut.lastIndexOf(' ') > 40 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).trim();
  }
  return name;
}

/** Typed title, else a tidy file name, else the neutral default. */
export function resolveDocumentTitle(
  typedTitle?: string | null,
  fileName?: string | null
): string {
  return (
    (typedTitle || '').trim() ||
    documentTitleFromFileName(fileName) ||
    DEFAULT_DOCUMENT_TITLE
  );
}
