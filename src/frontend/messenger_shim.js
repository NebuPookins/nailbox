// @ts-nocheck
/**
 * Minimal native notification system replacing the Messenger.js jQuery plugin.
 * Renders Bootstrap-styled alert toasts fixed at the bottom-right of the page.
 * API mirrors the subset of Messenger used by clientmain.js:
 *   createMessenger().info(msg)  → msgHandle
 *   createMessenger().error(msg) → msgHandle
 *   msgHandle.update({ type, message }) → msgHandle (chainable)
 */

const CONTAINER_ID = 'nailbox-messenger-container';
const AUTO_DISMISS_MS = 5000;

function getOrCreateContainer() {
	let el = document.getElementById(CONTAINER_ID);
	if (!el) {
		el = document.createElement('div');
		el.id = CONTAINER_ID;
		el.style.cssText = 'position:fixed;bottom:10em;right:10px;z-index:9999;width:320px;';
		document.body.appendChild(el);
	}
	return el;
}

function typeToClass(type) {
	if (type === 'success') return 'alert-success';
	if (type === 'error') return 'alert-danger';
	return 'alert-info';
}

function showToast(initialMessage, initialType) {
	const container = getOrCreateContainer();
	const el = document.createElement('div');
	el.style.marginBottom = '5px';
	el.className = 'alert alert-dismissible ' + typeToClass(initialType);

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = 'close';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.innerHTML = '<span aria-hidden="true">&times;</span>';
	closeBtn.addEventListener('click', function() { el.remove(); });

	const textSpan = document.createElement('span');
	textSpan.textContent = initialMessage;

	el.appendChild(closeBtn);
	el.appendChild(textSpan);
	container.appendChild(el);

	let autoTimer = setTimeout(function() { el.remove(); }, AUTO_DISMISS_MS);

	const msgHandle = {
		update: function({ type, message }) {
			clearTimeout(autoTimer);
			el.className = 'alert alert-dismissible ' + typeToClass(type);
			textSpan.textContent = message;
			autoTimer = setTimeout(function() { el.remove(); }, AUTO_DISMISS_MS);
			return msgHandle;
		},
	};
	return msgHandle;
}

export function createMessenger() {
	return {
		info: function(message) { return showToast(message, 'info'); },
		error: function(message) { return showToast(message, 'error'); },
		update: function() { return this; },
	};
}
