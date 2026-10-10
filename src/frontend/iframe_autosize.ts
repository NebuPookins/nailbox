/**
 * Calls `onReady` once with the frame's srcdoc document as soon as it has been
 * parsed (not waiting for images, unlike the frame's `load` event) and `isNew`
 * accepts it. Returns a function that cancels the wait.
 *
 * This polls because there is nothing to listen to: a sandboxed srcdoc can't run
 * scripts to tell us it is ready, and listeners can't be attached to a document
 * that doesn't exist yet (the frame starts out on an initial about:blank document
 * and navigation replaces it with a new one).
 */
export function whenFrameDocumentReady(
	frame: HTMLIFrameElement,
	isNew: (doc: Document) => boolean,
	onReady: (doc: Document) => void,
): () => void {
	let handle = 0;
	const poll = () => {
		const doc = frame.contentDocument;
		if (doc && doc.URL === 'about:srcdoc' && doc.readyState !== 'loading' && isNew(doc)) {
			onReady(doc);
			return;
		}
		handle = requestAnimationFrame(poll);
	};
	poll();
	return () => cancelAnimationFrame(handle);
}

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
	// Resizing the frame can itself change the measurement (scrollbars, multi-column
	// balancing, media queries), which would make the frame flip between sizes
	// forever. So within one document the height only ever grows.
	let tallest = 0;
	const measure = () => {
		// A horizontal scrollbar (for content wider than the frame) eats into the viewport height.
		const scrollbarHeight = Math.max(0, win.innerHeight - root.clientHeight);
		// Emails often set `html, body {height: 100%}`, pinning the root to the
		// frame's own height; then only scrollHeight reveals the content's height.
		const contentHeight = root.scrollHeight > root.clientHeight
			? root.scrollHeight
			: root.getBoundingClientRect().height;
		const height = Math.ceil(contentHeight) + scrollbarHeight;
		if (height > tallest) {
			tallest = height;
			onHeight(height);
		}
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
