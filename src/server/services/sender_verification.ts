import {isHeaderNamed, type GmailHeader} from '../../../models/message.js';
import type {SenderVerification} from '../types/thread.js';

/** The authserv-id Gmail stamps on the Authentication-Results header it adds to inbound mail. */
const GMAIL_AUTHSERV_ID = 'mx.google.com';

function domainOf(email: string): string | undefined {
	const at = email.lastIndexOf('@');
	return at === -1 || at === email.length - 1 ? undefined : email.slice(at + 1).trim().toLowerCase();
}

interface PassingResult {
	method: string;
	properties: ReadonlyMap<string, string>;
}

/** Every `method=pass` result in an Authentication-Results value, with its `property=value` pairs. */
function passingResults(value: string): PassingResult[] {
	return value.split(';').slice(1).flatMap((segment) => {
		const method = /^\s*([a-z0-9-]+)\s*=\s*pass\b/i.exec(segment);
		if (method === null) {
			return [];
		}
		const properties = new Map<string, string>();
		for (const [, key, val] of segment.matchAll(/\b([a-z]+\.[a-z]+)\s*=\s*"?([^\s;"]+)"?/gi)) {
			properties.set(key.toLowerCase(), val.toLowerCase());
		}
		return [{method: method[1].toLowerCase(), properties}];
	});
}

/** The domain a DKIM result says signed the message. Gmail usually reports header.i (`@example.com`) rather than header.d. */
function dkimSigningDomain(properties: ReadonlyMap<string, string>): string | undefined {
	const identity = properties.get('header.i');
	return properties.get('header.d') ?? (identity === undefined ? undefined : domainOf(identity));
}

/**
 * Whether Gmail itself vouches that the message really came from the From
 * address's domain. Only the topmost Authentication-Results header counts, and
 * only if it names Gmail as its authserv-id: Gmail prepends its own, so a
 * header further down could have been written by the sender, and if Gmail's
 * is missing nothing else can be trusted.
 */
export function verifySender(headers: ReadonlyArray<GmailHeader>, fromEmail: string | undefined): SenderVerification {
	const fromDomain = fromEmail === undefined ? undefined : domainOf(fromEmail);
	const topmost = headers.find(isHeaderNamed('Authentication-Results'));
	if (fromDomain === undefined || topmost === undefined || topmost.value.split(';')[0].trim().toLowerCase() !== GMAIL_AUTHSERV_ID) {
		return 'unverified';
	}
	const verified = passingResults(topmost.value).some(({method, properties}) => {
		if (method === 'dmarc') {
			return properties.get('header.from') === fromDomain;
		}
		const signer = method === 'dkim' ? dkimSigningDomain(properties) : undefined;
		return signer !== undefined && (fromDomain === signer || fromDomain.endsWith('.' + signer));
	});
	return verified ? 'verified' : 'unverified';
}
