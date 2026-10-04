import { Readability } from '@mozilla/readability';
import type { ParsedArticle } from './reader_view.js';

/** Extracts the main article from HTML using Mozilla's Readability. Needs a browser DOM. */
export function parseWithReadability(html: string): ParsedArticle | null {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return new Readability(doc).parse();
}
