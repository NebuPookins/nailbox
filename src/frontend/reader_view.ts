/** What a reader-mode parser extracted from a message. */
export interface ParsedArticle {
	content: string | null | undefined;
	textContent: string | null | undefined;
}

export type ReaderView =
	| { kind: 'article'; html: string }
	| { kind: 'unavailable' };

/** Shorter extractions are almost certainly not the actual message. */
export const MIN_ARTICLE_TEXT_LENGTH = 200;

/**
 * Decides whether a parse result is worth showing in reader view, falling back
 * to `unavailable` when nothing was extracted or what was extracted is tiny.
 * The parser is injected so this stays independent of a DOM.
 */
export function readerViewFor(
	html: string,
	parse: (html: string) => ParsedArticle | null,
): ReaderView {
	const article = parse(html);
	if (!article || !article.content) {
		return { kind: 'unavailable' };
	}
	const textLength = (article.textContent ?? '').trim().length;
	return textLength < MIN_ARTICLE_TEXT_LENGTH
		? { kind: 'unavailable' }
		: { kind: 'article', html: article.content };
}
