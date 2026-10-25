/**
 * Pure, immutable state for the status footer: a capped history of announcements,
 * newest-updated first. No DOM, no timers and no clock; the messenger shim owns those.
 * Adding or updating creates a new entry object, so a renderer can tell new news from a re-render by identity.
 */

export type AnnouncementType = 'info' | 'success' | 'error';

export interface AnnouncementAction {
	label: string;
	onClick: () => void | Promise<void>;
}

export interface Announcement {
	readonly id: number;
	readonly type: AnnouncementType;
	readonly message: string;
	readonly action: AnnouncementAction | null;
}

export interface AnnouncementLogState {
	/** Newest-updated first, capped at MAX_ENTRIES. */
	readonly entries: readonly Announcement[];
	readonly nextId: number;
}

export interface NewAnnouncement {
	readonly type: AnnouncementType;
	readonly message: string;
}

export interface AnnouncementUpdate extends NewAnnouncement {
	readonly action: AnnouncementAction | null;
}

export const MAX_ENTRIES = 50;

export function emptyLog(): AnnouncementLogState {
	return { entries: [], nextId: 1 };
}

export function addAnnouncement(
	state: AnnouncementLogState,
	announcement: NewAnnouncement,
): { state: AnnouncementLogState; id: number } {
	const id = state.nextId;
	const entry: Announcement = { id, type: announcement.type, message: announcement.message, action: null };
	return {
		id,
		state: {
			entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
			nextId: id + 1,
		},
	};
}

/** Replaces the entry and makes it current again. Unknown (e.g. trimmed) ids leave the state unchanged. */
export function updateAnnouncement(
	state: AnnouncementLogState,
	id: number,
	update: AnnouncementUpdate,
): AnnouncementLogState {
	if (!state.entries.some(entry => entry.id === id)) {
		return state;
	}
	const entry: Announcement = { id, type: update.type, message: update.message, action: update.action };
	return {
		...state,
		entries: [entry, ...state.entries.filter(existing => existing.id !== id)],
	};
}

/** The newest announcement, or null if there is none yet. */
export function currentAnnouncement(state: AnnouncementLogState): Announcement | null {
	return state.entries[0] ?? null;
}

/** Everything except the newest entry, newest first. */
export function olderAnnouncements(state: AnnouncementLogState): readonly Announcement[] {
	return state.entries.slice(1);
}
