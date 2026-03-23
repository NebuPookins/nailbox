// @ts-nocheck
/**
 * Show/hide Bootstrap 3 modals without the jQuery plugin.
 * Dispatches a native `hidden.bs.modal` CustomEvent after the CSS transition.
 * Handles the Escape key globally to close the topmost open modal.
 */

const TRANSITION_MS = 300;

/** @type {Map<Element, Element>} modal element → backdrop element */
const activeModals = new Map();

export function showModal(el) {
	if (activeModals.has(el)) return;
	const backdrop = document.createElement('div');
	backdrop.className = 'modal-backdrop fade';
	document.body.appendChild(backdrop);
	document.body.classList.add('modal-open');
	el.style.display = 'block';
	el.removeAttribute('aria-hidden');
	// Force reflow to trigger CSS transition
	backdrop.offsetWidth; // eslint-disable-line no-unused-expressions
	backdrop.classList.add('in');
	el.classList.add('in');
	el.focus();
	el.addEventListener('click', function(event) {
		if (event.target === el) {
			hideModal(el);
		}
	});
	activeModals.set(el, backdrop);
}

export function hideModal(el) {
	const backdrop = activeModals.get(el);
	if (backdrop === undefined) return;
	activeModals.delete(el);
	el.classList.remove('in');
	backdrop.classList.remove('in');
	setTimeout(function() {
		el.style.display = 'none';
		el.setAttribute('aria-hidden', 'true');
		if (backdrop.parentNode) {
			backdrop.parentNode.removeChild(backdrop);
		}
		if (activeModals.size === 0) {
			document.body.classList.remove('modal-open');
		}
		el.dispatchEvent(new CustomEvent('hidden.bs.modal', { bubbles: true }));
	}, TRANSITION_MS);
}

document.addEventListener('keydown', function(event) {
	if (event.key !== 'Escape') return;
	const modals = Array.from(activeModals.keys());
	if (modals.length > 0) {
		hideModal(modals[modals.length - 1]);
	}
});
