import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getLabelButtonStyle, getLabelDisplayName } from './label_picker_presenter.js';

interface Label {
	id: string;
	name: string;
	type: 'system' | 'user';
	hue?: number;
}

interface Notify {
	error?: (msg: string) => void;
}

interface LabelPickerState {
	labels: Label[];
	threadId: string | null;
	bundleId: string | null;
}

interface LabelPickerAppProps {
	notify: Notify | undefined;
	onDismiss: (() => void) | undefined;
	onMoveThread: ((threadId: string, labelId: string) => Promise<{ ok: boolean } | undefined>) | undefined;
	onMoveBundle: ((bundleId: string, labelId: string) => Promise<void>) | undefined;
	state: LabelPickerState;
}

function LabelPickerApp({ notify, onDismiss, onMoveThread, onMoveBundle, state }: LabelPickerAppProps) {
	const [pendingLabelId, setPendingLabelId] = useState('');
	const [filterText, setFilterText] = useState('');
	const hasTarget = Boolean(state.threadId) || Boolean(state.bundleId);

	async function handleLabelClick(labelId: string) {
		if (!hasTarget) {
			notify?.error?.('Missing thread or bundle id.');
			return;
		}
		setPendingLabelId(labelId);
		try {
			if (state.bundleId) {
				await Promise.resolve(onMoveBundle?.(state.bundleId, labelId));
			} else {
				const result = await Promise.resolve(onMoveThread?.(state.threadId as string, labelId));
				if (result && result.ok === false) {
					return;
				}
			}
			onDismiss?.();
		} catch (error: unknown) {
			const message = error instanceof Error && error.message
				? error.message
				: 'Failed to apply label.';
			notify?.error?.(message);
		} finally {
			setPendingLabelId('');
		}
	}

	if (state.labels.length === 0) {
		return <p className="text-muted">No visible labels available.</p>;
	}

	const lowerFilter = filterText.toLowerCase();
	const visibleLabels = filterText
		? state.labels.filter((label) => getLabelDisplayName(label).toLowerCase().includes(lowerFilter))
		: state.labels;

	return (
		<div className="label-picker-app">
			<input
				autoFocus
				className="form-control mb-2"
				onChange={(e) => setFilterText(e.target.value)}
				placeholder="Filter labels..."
				type="text"
				value={filterText}
			/>
			<div className="label-picker-grid">
				{visibleLabels.map((label) => (
					<button
						className={`btn ${label.type === 'system' ? 'btn-warning' : ''}`}
						data-label-id={label.id}
						disabled={!hasTarget || pendingLabelId.length > 0}
						key={label.id}
						onClick={() => handleLabelClick(label.id)}
						style={getLabelButtonStyle(label)}
						type="button"
					>
						{pendingLabelId === label.id ? 'Working...' : getLabelDisplayName(label)}
					</button>
				))}
			</div>
		</div>
	);
}

interface MountLabelPickerIslandDeps {
	container: Element;
	notify?: Notify;
	onDismiss?: () => void;
	onMoveThread?: (threadId: string, labelId: string) => Promise<{ ok: boolean } | undefined>;
	onMoveBundle?: (bundleId: string, labelId: string) => Promise<void>;
}

export function mountLabelPickerIsland({ container, notify, onDismiss, onMoveThread, onMoveBundle }: MountLabelPickerIslandDeps) {
	const root = createRoot(container);
	const state: LabelPickerState = {
		labels: [],
		threadId: null,
		bundleId: null,
	};

	function renderApp() {
		root.render(
			<LabelPickerApp
				notify={notify}
				onDismiss={onDismiss}
				onMoveThread={onMoveThread}
				onMoveBundle={onMoveBundle}
				state={state}
			/>
		);
	}

	renderApp();

	return {
		clear() {
			state.threadId = null;
			state.bundleId = null;
			renderApp();
		},
		open({ labels, threadId }: { labels?: Label[]; threadId?: string | null }) {
			state.labels = Array.isArray(labels) ? labels : [];
			state.threadId = threadId || null;
			state.bundleId = null;
			renderApp();
		},
		openForBundle({ labels, bundleId }: { labels?: Label[]; bundleId: string }) {
			state.labels = Array.isArray(labels) ? labels : [];
			state.threadId = null;
			state.bundleId = bundleId;
			renderApp();
		},
		setLabels(labels: Label[]) {
			state.labels = Array.isArray(labels) ? labels : [];
			renderApp();
		},
		unmount() {
			root.unmount();
		},
	};
}
