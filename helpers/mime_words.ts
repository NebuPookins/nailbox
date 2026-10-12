const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;
// Whitespace between two adjacent encoded words isn't part of the text (RFC 2047 section 6.2).
const SPACE_BETWEEN_ENCODED_WORDS = /(\?=)\s+(?==\?)/g;

function decodeQ(text: string): Uint8Array {
	const bytes = text
		.replace(/_/g, ' ')
		.split(/(=[0-9A-Fa-f]{2})/)
		.flatMap((chunk) => /^=[0-9A-Fa-f]{2}$/.test(chunk) ?
			[parseInt(chunk.slice(1), 16)] :
			[...Buffer.from(chunk, 'latin1')]);
	return Uint8Array.from(bytes);
}

function decodeWord(charset: string, encoding: string, text: string): string | null {
	const bytes = encoding.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : decodeQ(text);
	// RFC 2231 allows a language suffix, e.g. UTF-8*en.
	const label = charset.split('*')[0];
	try {
		return new TextDecoder(label).decode(bytes);
	} catch {
		return null;
	}
}

/**
 * Decodes RFC 2047 encoded words (e.g. `=?UTF-8?B?w6k=?=`) in a header value.
 * Words in an unknown charset are left as they are.
 */
export function decodeMimeWords(value: string): string {
	return value
		.replace(SPACE_BETWEEN_ENCODED_WORDS, '$1')
		.replace(ENCODED_WORD, (word, charset: string, encoding: string, text: string) =>
			decodeWord(charset, encoding, text) ?? word);
}
