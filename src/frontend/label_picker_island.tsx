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
}

interface LabelPickerAppProps {
	notify: Notify | undefined;
	onDismiss: (() => void) | undefined;
	onMoveThread: ((threadId: string, labelId: string) => Promise<{ ok: boolean } | undefined>) | undefined;
	state: LabelPickerState;
}

function LabelPickerApp({ notify, onDismiss, onMoveThread, state }: LabelPickerAppProps) {
	const [pendingLabelId, setPendingLabelId] = useState('');
	const hasThread = Boolean(state.threadId);

	async function handleLabelClick(labelId: string) {
		if (!hasThread) {
			notify?.error?.('Missing thread id.');
			return;
		}
		setPendingLabelId(labelId);
		try {
			const result = await Promise.resolve(onMoveThread?.(state.threadId as string, labelId));
			if (result && result.ok === false) {
				return;
			}
			onDismiss?.();
		} catch (error: unknown) {
			const message = error instanceof Error && error.message
				? error.message
				: 'Failed to move thread to label.';
			notify?.error?.(message);
		} finally {
			setPendingLabelId('');
		}
	}

	if (state.labels.length === 0) {
		return <p className="text-muted">No visible labels available.</p>;
	}

	return (
		<div className="label-picker-app">
			<div className="label-picker-grid">
				{state.labels.map((label) => (
					<button
						className={`btn ${label.type === 'system' ? 'btn-warning' : ''}`}
						data-label-id={label.id}
						disabled={!hasThread || pendingLabelId.length > 0}
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
}

export function mountLabelPickerIsland({ container, notify, onDismiss, onMoveThread }: MountLabelPickerIslandDeps) {
	const root = createRoot(container);
	const state: LabelPickerState = {
		labels: [],
		threadId: null,
	};

	function renderApp() {
		root.render(
			<LabelPickerApp
				notify={notify}
				onDismiss={onDismiss}
				onMoveThread={onMoveThread}
				state={state}
			/>
		);
	}

	renderApp();

	return {
		clear() {
			state.threadId = null;
			renderApp();
		},
		open({ labels, threadId }: { labels?: Label[]; threadId?: string | null }) {
			state.labels = Array.isArray(labels) ? labels : [];
			state.threadId = threadId || null;
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
