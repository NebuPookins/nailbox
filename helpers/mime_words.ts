const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/;
// A run of encoded words separated only by whitespace, which isn't part of
// the text (RFC 2047 section 6.2).
const ENCODED_WORD_RUN = new RegExp(`${ENCODED_WORD.source}(?:\\s*${ENCODED_WORD.source})*`, 'g');

interface EncodedWord {
	charset: string;
	bytes: Uint8Array;
}

function decodeQ(text: string): Uint8Array {
	const bytes = text
		.replace(/_/g, ' ')
		.split(/(=[0-9A-Fa-f]{2})/)
		.flatMap((chunk) => /^=[0-9A-Fa-f]{2}$/.test(chunk) ?
			[parseInt(chunk.slice(1), 16)] :
			[...Buffer.from(chunk, 'latin1')]);
	return Uint8Array.from(bytes);
}

function parseWords(run: string): EncodedWord[] {
	return [...run.matchAll(new RegExp(ENCODED_WORD.source, 'g'))].map(([, charset, encoding, text]) => ({
		// RFC 2231 allows a language suffix, e.g. UTF-8*en.
		charset: charset.split('*')[0].toLowerCase(),
		bytes: encoding.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : decodeQ(text),
	}));
}

// Mailers may split a multi-byte character across adjacent words, so words in
// the same charset are decoded together.
function mergeSameCharset(words: readonly EncodedWord[]): EncodedWord[] {
	return words.reduce<EncodedWord[]>((merged, word) => {
		const previous = merged.at(-1);
		return previous?.charset === word.charset ?
			[...merged.slice(0, -1), {charset: word.charset, bytes: Buffer.concat([previous.bytes, word.bytes])}] :
			[...merged, word];
	}, []);
}

function decodeRun(run: string): string | null {
	try {
		return mergeSameCharset(parseWords(run))
			.map(({charset, bytes}) => new TextDecoder(charset).decode(bytes))
			.join('');
	} catch {
		return null;
	}
}

/**
 * Decodes RFC 2047 encoded words (e.g. `=?UTF-8?B?w6k=?=`) in a header value.
 * Runs containing a word in an unknown charset are left as they are.
 */
export function decodeMimeWords(value: string): string {
	return value.replace(ENCODED_WORD_RUN, (run) => decodeRun(run) ?? run);
}
