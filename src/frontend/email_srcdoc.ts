/**
 * Builds the documents shown inside the sandboxed iframes that render email.
 * Isolation is the iframe's job: the sandbox (never granting scripts) plus the
 * Content-Security-Policy written here, which also decides whether remote
 * content may load.
 */

/**
 * Deliberately lacks `allow-scripts`. `allow-same-origin` only lets the parent
 * measure the content; without scripts the email can't use it.
 */
export const EMAIL_FRAME_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

/** Whether images and fonts may be fetched from the web, or only from this page's own origin and `data:` URLs. */
export type RemoteContent = 'blocked' | 'allowed';

const BASE_STYLESHEET = 'body{margin:8px; overflow-wrap:anywhere} img{max-width:100%; height:auto}';

const READER_STYLESHEET = [
	'html{background:#fff; color:#222}',
	'body{max-width:40em; margin:0 auto; padding:16px; line-height:1.6; font-size:16px; overflow-wrap:anywhere;',
	' font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
	'h1,h2,h3,h4,h5,h6{line-height:1.25; margin:1.4em 0 .5em}',
	'img,video,figure{max-width:100%; height:auto}',
	'pre{white-space:pre-wrap; overflow-x:auto; background:#f5f5f5; padding:8px}',
	'blockquote{margin:1em 0; padding-left:1em; border-left:3px solid #ddd; color:#555}',
	'a{color:#1a5fb4}',
	'table{border-collapse:collapse; max-width:100%}',
	'td,th{padding:4px 8px; border:1px solid #ddd}',
].join('\n');

/**
 * The CSP source for inline (`cid:`) images, which our server serves under
 * /api/threads/. Narrower than `'self'` so an email can't make the browser
 * request arbitrary endpoints of this app.
 */
function inlineImageSource(origin: string): string {
	return `${origin}/api/threads/`;
}

function contentSecurityPolicy(remoteContent: RemoteContent, ownImages: string): string {
	const remote = remoteContent === 'allowed' ? ' https: http:' : '';
	const sources = `data: ${ownImages}${remote}`;
	// Remote stylesheets (an `@import` of web fonts, typically) load along with remote images.
	return `default-src 'none'; style-src 'unsafe-inline'${remote}; img-src ${sources}; font-src ${sources}`;
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

interface SrcdocParts {
	bodyHtml: string;
	/** Placed before the body, so the content's own styles can override it. */
	stylesheet: string;
	remoteContent: RemoteContent;
	/** Origin of this app (e.g. `location.origin`), whose inline-image URLs may load. */
	origin: string;
}

function buildSrcdoc({bodyHtml, stylesheet, remoteContent, origin}: SrcdocParts): string {
	return [
		'<!DOCTYPE html><html><head><meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(contentSecurityPolicy(remoteContent, inlineImageSource(origin)))}">`,
		'<base target="_blank">',
		`<style>${stylesheet}</style>`,
		`</head><body>${bodyHtml}</body></html>`,
	].join('');
}

interface FrameContent {
	html: string;
	remoteContent: RemoteContent;
	origin: string;
}

/** The document for showing a message as its sender designed it. `html` must already be sanitized. */
export function buildEmailSrcdoc({html, remoteContent, origin}: FrameContent): string {
	return buildSrcdoc({bodyHtml: html, stylesheet: BASE_STYLESHEET, remoteContent, origin});
}

/** The document for showing extracted article content in a clean, readable layout. */
export function buildReaderSrcdoc({html, remoteContent, origin}: FrameContent): string {
	return buildSrcdoc({bodyHtml: html, stylesheet: READER_STYLESHEET, remoteContent, origin});
}

/**
 * Whether the HTML appears to refer to web images, backgrounds or stylesheets
 * that a `blocked` document would refuse to load. It only decides whether
 * offering "load images" is worthwhile, so it errs towards detecting.
 */
export function mayReferenceRemoteContent(html: string): boolean {
	return /<[a-z][^>]*\s(?:src|srcset|background)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html)
		|| /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)
		|| /@import/i.test(html);
}
