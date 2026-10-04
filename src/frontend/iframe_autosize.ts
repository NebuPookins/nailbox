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
