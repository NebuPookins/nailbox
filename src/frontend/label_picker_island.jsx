import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getLabelButtonStyle, getLabelDisplayName } from './label_picker_presenter.js';

function LabelPickerApp({ notify, onDismiss, onMoveThread, state }) {
	const [pendingLabelId, setPendingLabelId] = useState('');
	const hasThread = Boolean(state.threadId);

	async function handleLabelClick(labelId) {
		if (!hasThread) {
			notify?.error?.('Missing thread id.');
			return;
		}
		setPendingLabelId(labelId);
		try {
			const result = await Promise.resolve(onMoveThread?.(state.threadId, labelId));
			if (result && result.ok === false) {
				return;
			}
			onDismiss?.();
		} catch (error) {
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

export function mountLabelPickerIsland({ container, notify, onDismiss, onMoveThread }) {
	const root = createRoot(container);
	const state = {
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
		open({ labels, threadId }) {
			state.labels = Array.isArray(labels) ? labels : [];
			state.threadId = threadId || null;
			renderApp();
		},
		setLabels(labels) {
			state.labels = Array.isArray(labels) ? labels : [];
			renderApp();
		},
		unmount() {
			root.unmount();
		},
	};
}
