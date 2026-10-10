import type { ThreadGroup, ThreadRowItem } from './thread_grouping.js';

/** Logical clock value; only meaningful relative to other Ticks from the same state. */
export type Tick = number & { readonly __brand: 'Tick' };

function toTick(value: number): Tick {
	return value as Tick;
}

export type RemovalTarget =
	| { readonly kind: 'thread'; readonly threadId: string }
	| { readonly kind: 'bundle'; readonly bundleId: string };

/**
 * A removal the user asked for that the latest server snapshot may not reflect yet.
 * In-flight: the server has not confirmed the action. Confirmed: it has, as of `confirmedAt`.
 */
export type PendingRemoval =
	| { readonly id: string; readonly target: RemovalTarget; readonly status: 'in-flight' }
	| { readonly id: string; readonly target: RemovalTarget; readonly status: 'confirmed'; readonly confirmedAt: Tick };

export interface ServerSnapshot {
	readonly groups: readonly ThreadGroup[];
	/** When the GET was sent, not when it returned. */
	readonly requestedAt: Tick;
}

export interface ThreadListState {
	readonly clock: Tick;
	readonly snapshot: ServerSnapshot | null;
	readonly pending: readonly PendingRemoval[];
}

export function initialThreadListState(): ThreadListState {
	return { clock: toTick(0), snapshot: null, pending: [] };
}

export function removalStarted(state: ThreadListState, id: string, target: RemovalTarget): ThreadListState {
	return { ...state, pending: [...state.pending, { id, target, status: 'in-flight' }] };
}

/** The server finished the action; any snapshot requested from now on reflects it. */
export function removalConfirmed(state: ThreadListState, id: string): ThreadListState {
	const confirmedAt = toTick(state.clock + 1);
	return {
		...state,
		clock: confirmedAt,
		pending: state.pending.map(function(removal): PendingRemoval {
			return removal.id === id && removal.status === 'in-flight'
				? { id: removal.id, target: removal.target, status: 'confirmed', confirmedAt }
				: removal;
		}),
	};
}

/** The action failed, so the row is shown again (if the snapshot has it). */
export function removalFailed(state: ThreadListState, id: string): ThreadListState {
	return { ...state, pending: state.pending.filter(function(removal) { return removal.id !== id; }) };
}

/** The caller sends the snapshot GET tagged with the returned tick. */
export function snapshotRequested(state: ThreadListState): [ThreadListState, Tick] {
	const requestedAt = toTick(state.clock + 1);
	return [{ ...state, clock: requestedAt }, requestedAt];
}

export function snapshotReceived(state: ThreadListState, groups: readonly ThreadGroup[], requestedAt: Tick): ThreadListState {
	if (state.snapshot && state.snapshot.requestedAt > requestedAt) {
		return state;
	}
	return {
		...state,
		snapshot: { groups, requestedAt },
		// A GET sent after the server finished the action is authoritative about it.
		pending: state.pending.filter(function(removal) {
			return removal.status === 'in-flight' || removal.confirmedAt >= requestedAt;
		}),
	};
}

function removeThreadFromItems(items: readonly ThreadRowItem[], threadId: string): ThreadRowItem[] {
	return items.flatMap(function(item): ThreadRowItem[] {
		if (item.type === 'bundle') {
			const containsThread = item.threadIds.includes(threadId);
			if (!containsThread) {
				return [item];
			}
			const remainingMemberThreads = (item.memberThreads || [])
				.filter(function(thread) { return thread.threadId !== threadId; });
			const remainingThreadIds = item.threadIds.filter(function(id) { return id !== threadId; });
			if (remainingThreadIds.length >= 2) {
				return [{
					...item,
					threadIds: remainingThreadIds,
					threadCount: remainingMemberThreads.length,
					memberThreads: remainingMemberThreads,
				}];
			}
			if (remainingMemberThreads.length === 1) {
				return [remainingMemberThreads[0]];
			}
			return [];
		}
		if (item.threadId === threadId) {
			return [];
		}
		return [item];
	});
}

function removeBundleFromItems(items: readonly ThreadRowItem[], bundleId: string): ThreadRowItem[] {
	return items.filter(function(item) { return item.type !== 'bundle' || item.bundleId !== bundleId; });
}

function applyRemoval(groups: readonly ThreadGroup[], target: RemovalTarget): readonly ThreadGroup[] {
	return groups
		.map(function(group): ThreadGroup {
			return {
				...group,
				items: target.kind === 'thread'
					? removeThreadFromItems(group.items, target.threadId)
					: removeBundleFromItems(group.items, target.bundleId),
			};
		})
		.filter(function(group) { return group.items.length > 0; });
}

/** The server's latest snapshot with every pending removal applied. */
export function visibleGroups(state: ThreadListState): readonly ThreadGroup[] {
	return state.pending.reduce(
		function(groups, removal) { return applyRemoval(groups, removal.target); },
		state.snapshot?.groups ?? []
	);
}
