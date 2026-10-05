/**
 * Keeps `onHeight` informed of the full height of an iframe's document, so the
 * frame can be sized to show all of it. This relies on the frame being
 * same-origin (`allow-same-origin`). Returns a function that stops observing.
 */
export function observeContentHeight(
	frame: HTMLIFrameElement,
	onHeight: (heightPx: number) => void,
): () => void {
	const doc = frame.contentDocument;
	const win = frame.contentWindow;
	if (!doc || !win) {
		return () => {};
	}
	const root = doc.documentElement;
	const measure = () => {
		// A horizontal scrollbar (for content wider than the frame) eats into the viewport height.
		const scrollbarHeight = Math.max(0, win.innerHeight - root.clientHeight);
		// Emails often set `html, body {height: 100%}`, pinning the root to the
		// frame's own height; then only scrollHeight reveals the content's height.
		const contentHeight = root.scrollHeight > root.clientHeight
			? root.scrollHeight
			: root.getBoundingClientRect().height;
		onHeight(Math.ceil(contentHeight) + scrollbarHeight);
	};
	const observer = new ResizeObserver(measure);
	// The root alone may not resize when content grows (see above), so watch the body's children too.
	[root, ...Array.from(doc.body?.children ?? [])].forEach(element => observer.observe(element));
	// Images that finish loading change the height; they don't bubble, so capture.
	doc.addEventListener('load', measure, true);
	measure();
	return () => {
		observer.disconnect();
		doc.removeEventListener('load', measure, true);
	};
}

/**
 * Key presses inside an iframe never bubble to the parent document, so app-level
 * shortcuts (Delete, Escape) would die whenever the frame has focus. Re-dispatches
 * them from the frame element so they bubble through the parent as usual. Relies on
 * the frame being same-origin. Returns a function that stops forwarding.
 */
export function forwardKeydownToParent(frame: HTMLIFrameElement): () => void {
	const doc = frame.contentDocument;
	if (!doc) {
		return () => {};
	}
	const forward = (event: KeyboardEvent) => {
		const forwarded = new KeyboardEvent('keydown', {
			key: event.key,
			code: event.code,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			metaKey: event.metaKey,
			repeat: event.repeat,
			bubbles: true,
			cancelable: true,
		});
		if (!frame.dispatchEvent(forwarded) || forwarded.defaultPrevented) {
			event.preventDefault();
		}
	};
	doc.addEventListener('keydown', forward);
	return () => doc.removeEventListener('keydown', forward);
}
