export type TextSegment =
	| { kind: 'text'; text: string }
	| { kind: 'link'; url: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** Splits text into plain runs and http(s) URLs, leaving trailing punctuation outside the URL. */
export function linkifySegments(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	let consumedUpTo = 0;
	for (const match of text.matchAll(URL_PATTERN)) {
		const url = match[0].replace(TRAILING_PUNCTUATION, '');
		if (match.index > consumedUpTo) {
			segments.push({ kind: 'text', text: text.slice(consumedUpTo, match.index) });
		}
		segments.push({ kind: 'link', url });
		consumedUpTo = match.index + url.length;
	}
	if (consumedUpTo < text.length) {
		segments.push({ kind: 'text', text: text.slice(consumedUpTo) });
	}
	return segments;
}
