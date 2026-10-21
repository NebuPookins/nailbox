/**
 * Detects and repairs unreadable email rendering: light text on a light
 * background (or dark text on a dark one), which makes a message look blank.
 *
 * The email iframe cannot run scripts, so this inspects the frame's document
 * from the parent page (the sandbox grants `allow-same-origin`). It samples
 * visible text nodes, compares each one's effective foreground color against
 * its effective background color (walking up past transparent backgrounds),
 * and when at least half of the visible text has too little contrast, it
 * injects an override stylesheet that restores a readable pairing.
 */

/** An sRGB color. */
export interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** Below this WCAG contrast ratio, text counts as unreadable. */
export const CONTRAST_THRESHOLD = 3;

/** Repair kicks in when at least this fraction of the visible text is unreadable. */
export const BAD_TEXT_FRACTION = 0.5;

/** Bound on how many text nodes get sampled, so a huge email stays cheap. */
const MAX_SAMPLED_NODES = 500;

/** Bound on how many characters one text node can contribute, so one giant `<pre>` can't dominate. */
const MAX_CHARS_PER_NODE = 200;

/** Marks the injected repair stylesheet so it can be found and removed again. */
const FIX_STYLE_MARKER = 'data-email-contrast-fix';

const NAMED_COLORS: Record<string, string> = {
	black: '#000000',
	white: '#ffffff',
	red: '#ff0000',
	green: '#008000',
	blue: '#0000ff',
	yellow: '#ffff00',
	cyan: '#00ffff',
	magenta: '#ff00ff',
	gray: '#808080',
	grey: '#808080',
	silver: '#c0c0c0',
	maroon: '#800000',
	olive: '#808000',
	lime: '#00ff00',
	aqua: '#00ffff',
	teal: '#008080',
	navy: '#000080',
	fuchsia: '#ff00ff',
	purple: '#800080',
};

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const RGB_COLOR = /^rgba?\(\s*([^)]+)\)$/;

function channel(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed.endsWith('%')) {
		const percent = parseFloat(trimmed.slice(0, -1));
		return Number.isFinite(percent) ? Math.round((percent / 100) * 255) : null;
	}
	const amount = parseFloat(trimmed);
	return Number.isFinite(amount) ? Math.round(amount) : null;
}

/**
 * Parses a CSS color value (hex, `rgb()`/`rgba()`, or a common named color)
 * into its opaque sRGB channels. Returns `null` for fully transparent colors
 * (`transparent`, `rgba(..., 0)`) and anything it doesn't understand.
 */
export function parseCssColor(css: string): Rgb | null {
	const value = css.trim().toLowerCase();
	if (value === '' || value === 'transparent' || value === 'inherit' || value === 'currentcolor') {
		return null;
	}
	const named = NAMED_COLORS[value];
	if (named !== undefined) {
		return parseCssColor(named);
	}
	const hex = HEX_COLOR.exec(value);
	if (hex !== null) {
		let digits = hex[1];
		if (digits.length === 3 || digits.length === 4) {
			digits = digits.split('').map((digit) => digit + digit).join('');
		}
		const alpha = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
		if (alpha === 0) {
			return null;
		}
		return {
			r: parseInt(digits.slice(0, 2), 16),
			g: parseInt(digits.slice(2, 4), 16),
			b: parseInt(digits.slice(4, 6), 16),
		};
	}
	const rgb = RGB_COLOR.exec(value);
	if (rgb !== null) {
		const parts = rgb[1].split(',').map((part) => part.trim());
		if (parts.length < 3 || parts.length > 4) {
			return null;
		}
		const r = channel(parts[0]);
		const g = channel(parts[1]);
		const b = channel(parts[2]);
		if (r === null || g === null || b === null) {
			return null;
		}
		if (parts.length === 4) {
			const alpha = parseFloat(parts[3]);
			if (!Number.isFinite(alpha)) {
				return null;
			}
			if (alpha <= 0) {
				return null;
			}
		}
		return { r, g, b };
	}
	return null;
}

/** The WCAG relative luminance of an sRGB color, in [0, 1]. */
export function relativeLuminance({ r, g, b }: Rgb): number {
	const linearize = (channelValue: number): number => {
		const srgb = channelValue / 255;
		return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** The WCAG contrast ratio between two colors, from 1 (identical) to 21 (black on white). */
export function contrastRatio(first: Rgb, second: Rgb): number {
	const firstLuminance = relativeLuminance(first);
	const secondLuminance = relativeLuminance(second);
	const lighter = Math.max(firstLuminance, secondLuminance);
	const darker = Math.min(firstLuminance, secondLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}

function isTransparent(value: string): boolean {
	const trimmed = value.trim().toLowerCase();
	if (trimmed === '' || trimmed === 'transparent') {
		return true;
	}
	const rgb = RGB_COLOR.exec(trimmed);
	if (rgb !== null) {
		const parts = rgb[1].split(',').map((part) => part.trim());
		if (parts.length === 4) {
			const alpha = parseFloat(parts[3]);
			return Number.isFinite(alpha) && alpha <= 0;
		}
	}
	return false;
}

function isVisible(style: CSSStyleDeclaration): boolean {
	return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

/**
 * The background color text in `element` actually sits on: the nearest
 * non-transparent background up the ancestor chain. Returns `null` when a
 * background image is in play (its pixels can't be measured), so callers can
 * skip those nodes instead of guessing.
 */
function effectiveBackground(doc: Document, element: Element): Rgb | null {
	let node: Element | null = element;
	while (node !== null) {
		const style = doc.defaultView?.getComputedStyle(node);
		if (!style) {
			return null;
		}
		if (style.backgroundImage !== 'none') {
			return null;
		}
		if (!isTransparent(style.backgroundColor)) {
			return parseCssColor(style.backgroundColor);
		}
		node = node.parentElement;
	}
	// Nothing painted a background: the frame canvas is white.
	return { r: 255, g: 255, b: 255 };
}

interface ContrastSample {
	badChars: number;
	totalChars: number;
}

function sampleContrast(doc: Document): ContrastSample | null {
	const body = doc.body;
	const view = doc.defaultView;
	if (!body || !view) {
		return null;
	}
	let badChars = 0;
	let totalChars = 0;
	let sampledNodes = 0;
	const visit = (node: Node): boolean => {
		if (sampledNodes >= MAX_SAMPLED_NODES) {
			return false;
		}
		if (node.nodeType === 3) {
			const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
			if (text.length > 0) {
				const parent = (node as Text).parentElement;
				if (parent) {
					const style = view.getComputedStyle(parent);
					if (isVisible(style) && style.backgroundImage === 'none') {
						const foreground = parseCssColor(style.color);
						const background = effectiveBackground(doc, parent);
						if (foreground && background) {
							const chars = Math.min(text.length, MAX_CHARS_PER_NODE);
							totalChars += chars;
							sampledNodes += 1;
							if (contrastRatio(foreground, background) < CONTRAST_THRESHOLD) {
								badChars += chars;
							}
						}
					}
				}
			}
		} else if (node.nodeType === 1) {
			for (const child of Array.from(node.childNodes)) {
				if (!visit(child)) {
					return false;
				}
			}
		}
		return true;
	};
	visit(body);
	return totalChars === 0 ? null : { badChars, totalChars };
}

/** Whether at least half of the frame's visible text has too little contrast to read. */
export function isUnreadable(doc: Document): boolean {
	const sample = sampleContrast(doc);
	return sample !== null && sample.badChars / sample.totalChars >= BAD_TEXT_FRACTION;
}

/** The background the email as a whole sits on, defaulting to white. */
function pageBackground(doc: Document): Rgb {
	if (!doc.body) {
		return { r: 255, g: 255, b: 255 };
	}
	return effectiveBackground(doc, doc.body) ?? { r: 255, g: 255, b: 255 };
}

// The repair only needs to beat the email's own styles; the email can never
// beat `!important`, and no scripts run in the frame, so this is not a
// privilege the email could use against the rest of the app.
const LIGHT_BACKGROUND_FIX = [
	'html,body{background:#fff!important}',
	'body{background-color:#fff!important}',
	'body *{background-image:none!important}',
	'body,body *:not(a){color:#1f2937!important}',
	'a{color:#1a5fb4!important}',
].join('');

const DARK_BACKGROUND_FIX = [
	'html,body{background:#111418!important}',
	'body{background-color:#111418!important}',
	'body *{background-image:none!important}',
	'body,body *:not(a){color:#e8eaed!important}',
	'a{color:#8ab4f8!important}',
].join('');

/** Removes any previously injected contrast repair. */
export function removeContrastFix(doc: Document): void {
	doc.querySelectorAll(`style[${FIX_STYLE_MARKER}]`).forEach((element) => element.remove());
}

/**
 * Injects the contrast repair when the frame's email renders unreadable, and
 * reports whether it did. On a light background the text is forced dark; on a
 * dark one the text is forced light against a neutral dark background.
 */
export function applyContrastFix(doc: Document): boolean {
	removeContrastFix(doc);
	if (!isUnreadable(doc)) {
		return false;
	}
	const fix = relativeLuminance(pageBackground(doc)) > 0.35
		? LIGHT_BACKGROUND_FIX
		: DARK_BACKGROUND_FIX;
	const style = doc.createElement('style');
	style.setAttribute(FIX_STYLE_MARKER, '');
	style.textContent = fix;
	const head = doc.head ?? doc.documentElement;
	head.appendChild(style);
	return true;
}

/**
 * Repairs the frame document when its email renders unreadable. Re-checks once
 * resources finish loading: a background image that arrives late can make the
 * repair unnecessary, so the check re-runs against the unfixed rendering and
 * only re-applies when the text is still unreadable. Returns a cleanup that
 * removes the repair and the re-check.
 */
export function ensureReadableContrast(doc: Document): () => void {
	applyContrastFix(doc);
	const recheck = (): void => {
		removeContrastFix(doc);
		applyContrastFix(doc);
	};
	doc.addEventListener('load', recheck, { once: true });
	return () => {
		doc.removeEventListener('load', recheck);
		removeContrastFix(doc);
	};
}
