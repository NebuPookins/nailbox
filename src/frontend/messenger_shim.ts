/**
 * Status footer replacing the Messenger.js jQuery plugin.
 * A thin strip fixed to the bottom of the page is always visible. It shows the newest
 * announcement (with its action, e.g. Undo), or a muted placeholder when there is none,
 * and briefly flashes in the announcement's colour whenever one is added or updated.
 * A toggle on the right expands a panel above the strip listing the older announcements
 * (kept in memory until reload), each with its own action; Escape or the toggle closes it.
 * The strip has a fixed height, reserved as bottom padding on the body (see styles.css).
 * createMessenger() mounts the footer (idempotently); importing this module has no side effects.
 * API mirrors the subset of Messenger used by clientmain.js:
 *   createMessenger().info(msg)  → msgHandle
 *   createMessenger().error(msg) → msgHandle
 *   msgHandle.update({ type, message, action }) → msgHandle (chainable)
 */

import {
	addAnnouncement,
	currentAnnouncement,
	emptyLog,
	olderAnnouncements,
	updateAnnouncement,
	type Announcement,
	type AnnouncementAction,
	type AnnouncementLogState,
	type AnnouncementType,
} from './announcement_log.js';

export type { AnnouncementAction, AnnouncementType };

export interface MsgHandle {
	update(opts: { type: AnnouncementType; message: string; action?: AnnouncementAction | null }): MsgHandle;
}

export interface Messenger {
	info(message: string): MsgHandle;
	error(message: string): MsgHandle;
}

const FOOTER_ID = 'railbox-status-footer';

type BootstrapColor = 'info' | 'success' | 'danger';

const TYPE_STYLES: Record<AnnouncementType, { icon: string; color: BootstrapColor }> = {
	info: { icon: 'bi-info-circle-fill', color: 'info' },
	success: { icon: 'bi-check-circle-fill', color: 'success' },
	error: { icon: 'bi-exclamation-triangle-fill', color: 'danger' },
};

interface FooterUi {
	readonly panel: HTMLElement;
	readonly bar: HTMLElement;
	/** Icon, message and action of the current entry; rebuilt on each render. */
	readonly content: HTMLElement;
	/** Created once so keyboard focus survives re-renders. */
	readonly toggle: HTMLButtonElement;
}

// The only mutable state: the announcement log, whether the history panel is open, the
// entry last flashed (so re-renders don't re-trigger the flash), and the mounted footer.
let state: AnnouncementLogState = emptyLog();
let panelOpen = false;
let flashedEntry: Announcement | null = null;
// What the DOM currently shows, so render() only rebuilds the parts that changed. Rebuilding
// would destroy a focused or hovered action button. undefined = not rendered yet.
let renderedCurrent: Announcement | null | undefined;
let renderedHistory: readonly Announcement[] | null = null;
let mounted: FooterUi | null = null;

function setState(ui: FooterUi, next: AnnouncementLogState): void {
	state = next;
	render(ui);
}

function setPanelOpen(ui: FooterUi, open: boolean): void {
	panelOpen = open;
	render(ui);
}

function mount(): FooterUi {
	const footer = document.createElement('div');
	footer.id = FOOTER_ID;

	const panel = document.createElement('div');
	panel.className = 'status-footer-panel list-group';

	const bar = document.createElement('div');
	bar.className = 'status-footer-bar';
	// Only the strip is a live region, so re-rendering the history panel isn't announced.
	bar.setAttribute('role', 'status');
	bar.setAttribute('aria-live', 'polite');

	const content = document.createElement('div');
	content.className = 'status-footer-content';

	const toggle = createButton('btn btn-sm status-footer-history', '');
	bar.append(content, toggle);
	footer.append(panel, bar);

	const ui: FooterUi = { panel, bar, content, toggle };
	toggle.addEventListener('click', function() { setPanelOpen(ui, !panelOpen); });
	document.addEventListener('keydown', function(event) {
		// native_modal.ts closes the topmost modal on Escape; don't also close the panel then.
		if (event.key === 'Escape' && panelOpen && !document.body.classList.contains('modal-open')) {
			setPanelOpen(ui, false);
		}
	});
	document.body.appendChild(footer);
	document.body.classList.add('has-status-footer');
	render(ui);
	return ui;
}

function runAction(announcement: Announcement, action: AnnouncementAction): void {
	const context = { announcementId: announcement.id, message: announcement.message, actionLabel: action.label };
	// Starting from a resolved promise turns a synchronous throw into a rejection too.
	Promise.resolve().then(action.onClick).catch(function(error: unknown) {
		console.error('Status footer action failed', context, error);
	});
}

function createButton(className: string, text: string, onClick?: () => void): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = className;
	button.textContent = text;
	if (onClick) {
		button.addEventListener('click', onClick);
	}
	return button;
}

function createActionButton(announcement: Announcement, action: AnnouncementAction): HTMLButtonElement {
	return createButton('btn btn-link btn-sm status-footer-action', action.label, function() { runAction(announcement, action); });
}

function createIcon(type: AnnouncementType): HTMLElement {
	const { icon: iconClass, color } = TYPE_STYLES[type];
	const icon = document.createElement('i');
	icon.className = 'bi ' + iconClass + ' text-' + color;
	icon.setAttribute('aria-hidden', 'true');
	return icon;
}

function createMessageText(message: string, extraClass: string = ''): HTMLElement {
	const text = document.createElement('span');
	text.className = ('status-footer-text ' + extraClass).trim();
	text.textContent = message;
	text.title = message;
	return text;
}

function createPanelRow(announcement: Announcement): HTMLElement {
	const row = document.createElement('div');
	row.className = 'list-group-item status-footer-row list-group-item-' + TYPE_STYLES[announcement.type].color;
	row.append(createIcon(announcement.type), createMessageText(announcement.message));
	if (announcement.action) {
		row.append(createActionButton(announcement, announcement.action));
	}
	return row;
}

function sameEntries(a: readonly Announcement[] | null, b: readonly Announcement[] | null): boolean {
	if (a === null || b === null) {
		return a === b;
	}
	return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/** Restarts the highlight animation, but only when the current entry is new or was updated. */
function flashIfNew(bar: HTMLElement, current: Announcement | null): void {
	if (current === flashedEntry) {
		return;
	}
	flashedEntry = current;
	bar.classList.remove('status-footer-flash');
	if (current) {
		bar.style.setProperty('--status-footer-flash-color', 'var(--bs-' + TYPE_STYLES[current.type].color + '-bg-subtle)');
		// Reading offsetWidth forces a reflow so re-adding the class restarts the animation.
		void bar.offsetWidth;
		bar.classList.add('status-footer-flash');
	}
}

function render(ui: FooterUi): void {
	const current = currentAnnouncement(state);
	const older = olderAnnouncements(state);
	const open = panelOpen && older.length > 0;

	if (current !== renderedCurrent) {
		renderedCurrent = current;
		const children: Node[] = current
			? [createIcon(current.type), createMessageText(current.message)]
			: [createMessageText('No recent activity', 'text-body-secondary')];
		if (current && current.action) {
			children.push(createActionButton(current, current.action));
		}
		ui.content.replaceChildren(...children);
	}

	ui.toggle.textContent = (open ? '\u25BE' : '\u25B4') + (older.length > 0 ? ' ' + older.length : '');
	ui.toggle.setAttribute('aria-label', open ? 'Hide earlier messages' : 'Show earlier messages');
	ui.toggle.setAttribute('aria-expanded', String(open));
	ui.toggle.disabled = older.length === 0;

	const wantedHistory = open ? older : null;
	if (!sameEntries(wantedHistory, renderedHistory)) {
		renderedHistory = wantedHistory;
		ui.panel.replaceChildren(...(wantedHistory ?? []).map(createPanelRow));
	}
	ui.panel.hidden = !open;

	flashIfNew(ui.bar, current);
}

function showAnnouncement(ui: FooterUi, message: string, type: AnnouncementType): MsgHandle {
	const added = addAnnouncement(state, { type, message });
	setState(ui, added.state);
	const id = added.id;
	const msgHandle: MsgHandle = {
		update: function({ type, message, action }) {
			setState(ui, updateAnnouncement(state, id, { type, message, action: action ?? null }));
			return msgHandle;
		},
	};
	return msgHandle;
}

/** Mounts the footer on first call (it needs document.body); later calls reuse it. */
export function createMessenger(): Messenger {
	const ui = mounted ?? mount();
	mounted = ui;
	return {
		info: function(message) { return showAnnouncement(ui, message, 'info'); },
		error: function(message) { return showAnnouncement(ui, message, 'error'); },
	};
}

/**
 * A handle for background work: info/success updates are ignored (so they don't bury the
 * user's last announcement, e.g. an Undo), but error updates are logged and shown via `messenger`.
 */
export function silentUnlessFailed(messenger: Messenger): MsgHandle {
	const handle: MsgHandle = {
		update: function({ type, message }) {
			if (type === 'error') {
				console.error('Background task failed', message);
				messenger.error(message);
			}
			return handle;
		},
	};
	return handle;
}
