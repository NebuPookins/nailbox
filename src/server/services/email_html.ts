import sanitizeHtml from 'sanitize-html';
import {decode} from 'html-entities';

type Attributes = Record<string, string>;

const CID_PREFIX = /^cid:/i;
const CID_REFERENCE = /cid:[^\s,]+/gi;
const CSS_CID_URL = /url\(\s*(["']?)\s*(cid:[^"')\s]+)\s*\1\s*\)/gi;

const PRESENTATIONAL_ATTRIBUTES = ['align', 'valign', 'bgcolor', 'width', 'height', 'border', 'background', 'color', 'face', 'size', 'dir', 'lang', 'title'];

const ALLOWED_TAGS = [
	'a', 'abbr', 'acronym', 'address', 'area', 'article', 'aside', 'b', 'bdi', 'bdo', 'big',
	'blockquote', 'body', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd',
	'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'footer',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'img', 'ins', 'kbd', 'li',
	'main', 'map', 'mark', 'nav', 'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's',
	'samp', 'section', 'small', 'source', 'span', 'strike', 'strong', 'style', 'sub', 'summary',
	'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var',
	'wbr',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
	'*': ['class', 'id', 'style', ...PRESENTATIONAL_ATTRIBUTES],
	a: ['href', 'name', 'rel', 'target'],
	area: ['href', 'shape', 'coords', 'alt', 'target'],
	col: ['span'],
	colgroup: ['span'],
	img: ['alt', 'src', 'srcset', 'sizes', 'usemap', 'hspace', 'vspace'],
	map: ['name'],
	ol: ['start', 'type', 'reversed'],
	source: ['srcset', 'sizes', 'media', 'type'],
	table: ['cellpadding', 'cellspacing', 'summary'],
	td: ['colspan', 'rowspan', 'nowrap', 'headers'],
	th: ['colspan', 'rowspan', 'nowrap', 'headers', 'scope'],
	time: ['datetime'],
};

/** Tags whose content is never meaningful as text (note: `style` is deliberately absent). */
const NON_TEXT_TAGS = ['script', 'textarea', 'option', 'title', 'noscript', 'template'];

export interface SanitizeEmailHtmlOptions {
	/** Maps the Content-ID from a `cid:` reference (without angle brackets) to the URL serving that part. */
	cidUrl: (contentId: string) => string;
}

/**
 * Makes email HTML safe to render inside a script-less sandboxed iframe with a
 * restrictive CSP. It keeps the email's own styling (`<style>` blocks, style
 * attributes, classes) so it can look the way its sender intended, and removes
 * everything active: scripts, embedded documents, forms, event handlers and
 * non-web URL schemes. `cid:` image references are rewritten to `cidUrl`.
 *
 * `<style>` survives only because sanitize-html is told to allow vulnerable tags;
 * that is acceptable solely because the result is never rendered outside such an iframe.
 */
export function sanitizeEmailHtml(html: string, {cidUrl}: SanitizeEmailHtmlOptions): string {
	const rewriteCid = (url: string): string =>
		CID_PREFIX.test(url) ? cidUrl(contentIdOf(url)) : url;
	/** How each attribute that may hold a `cid:` reference is rewritten. */
	const rewriters = new Map<string, (value: string) => string>([
		['src', rewriteCid],
		['background', rewriteCid],
		['srcset', (srcset) => srcset.replace(CID_REFERENCE, rewriteCid)],
		['style', (style) => style.replace(CSS_CID_URL, (_match, quote: string, reference: string) => `url(${quote}${rewriteCid(reference)}${quote})`)],
	]);
	const withRewrittenCids = (attribs: Attributes): Attributes => Object.fromEntries(
		Object.entries(attribs).map(([name, value]) => [name, rewriters.get(name)?.(value) ?? value]),
	);
	return sanitizeHtml(html, {
		allowVulnerableTags: true,
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: ALLOWED_ATTRIBUTES,
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		allowedSchemesByTag: {img: ['http', 'https', 'data', 'cid']},
		allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'background'],
		nonTextTags: NON_TEXT_TAGS,
		transformTags: {
			// Applies to every tag. It runs before the scheme filter, so rewritten cid: URLs survive it.
			'*': (tagName: string, attribs: Attributes) => {
				const rewritten = withRewrittenCids(attribs);
				return {
					tagName,
					attribs: tagName === 'a' && rewritten['href'] !== undefined
						? {...rewritten, target: '_blank', rel: 'noopener noreferrer'}
						: rewritten,
				};
			},
		},
	});
}

/** The Content-ID a `cid:` URL refers to. Such URLs are URL-encoded (RFC 2392), e.g. `cid:logo%40example.com`. */
function contentIdOf(cidReference: string): string {
	const encoded = cidReference.replace(CID_PREFIX, '').trim();
	try {
		return decodeURIComponent(encoded);
	} catch {
		// Not valid percent-encoding, so it was most likely never encoded.
		return encoded;
	}
}

const BLOCK_BREAK_TAGS = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'ul', 'ol', 'table', 'hr', 'section', 'article', 'header', 'footer', 'address'];
const LINE_BREAK_TAGS = ['li', 'tr', 'dt', 'dd', 'caption', 'figcaption'];
const BLOCK_BREAK = new RegExp(`</?(?:${BLOCK_BREAK_TAGS.join('|')})(?: [^>]*)?/?>`, 'gi');
const LINE_BREAK = new RegExp(`</(?:${LINE_BREAK_TAGS.join('|')})>`, 'gi');

/**
 * Derives readable plain text from HTML. Paragraph-like elements are separated
 * by a blank line, other line-level elements and `<br>` by a line break.
 */
export function htmlToPlainText(html: string): string {
	const structureOnly = sanitizeHtml(html, {
		allowedTags: [...BLOCK_BREAK_TAGS, ...LINE_BREAK_TAGS, 'br'],
		allowedAttributes: {},
		nonTextTags: [...NON_TEXT_TAGS, 'style'],
	});
	const withBreaks = structureOnly
		.replace(/[ \t\r\n\f ]+/g, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(BLOCK_BREAK, '\n\n')
		.replace(LINE_BREAK, '\n')
		.replace(/<[^>]*>/g, '');
	return decode(withBreaks)
		.replace(/ /g, ' ')
		.split('\n')
		.map(line => line.replace(/[ \t]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Counts whitespace-separated words. */
export function countWords(text: string): number {
	return text.split(/\s+/).filter(word => word.length > 0).length;
}

const READING_WORDS_PER_MINUTE = 200;

export function readTimeSecondsFor(wordCount: number): number {
	return Math.round((wordCount * 60) / READING_WORDS_PER_MINUTE);
}
