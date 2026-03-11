import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LATER_PRESET_OPTIONS, resolveHideUntilPreset } from './later_picker_presets.js';

function chunkPresetOptions(options, chunkSize) {
	const rows = [];
	for (let index = 0; index < options.length; index += chunkSize) {
		rows.push(options.slice(index, index + chunkSize));
	}
	return rows;
}

function LaterPickerApp({ notify, onDismiss, onHidden, state }) {
	const [pendingPreset, setPendingPreset] = useState('');
	const hasThread = Boolean(state.threadId);

	async function handlePresetClick(presetValue) {
		if (!hasThread) {
			notify?.error?.('Tried to hide thread, but no threadId was found.');
			return;
		}
		const hideUntil = resolveHideUntilPreset(presetValue);
		if (!hideUntil) {
			notify?.error?.(`Forgot to implement ${presetValue}`);
			return;
		}
		setPendingPreset(presetValue);
		try {
			await Promise.resolve(state.onHideThread?.(state.threadId, hideUntil));
			onHidden?.(state.threadId);
			onDismiss?.();
		} catch (error) {
			const message = error instanceof Error && error.message
				? error.message
				: 'Failed to hide thread.';
			notify?.error?.(message);
		} finally {
			setPendingPreset('');
		}
	}

	return (
		<div className="later-picker-app">
			{chunkPresetOptions(LATER_PRESET_OPTIONS, 3).map((row, rowIndex) => (
				<div className="row" key={`later-picker-row-${rowIndex}`}>
					{row.map((option) => (
						<div className="col-xs-4" key={option.value}>
							<button
								className="button btn btn-link"
								disabled={!hasThread || pendingPreset.length > 0}
								onClick={() => handlePresetClick(option.value)}
								type="button"
							>
								<span className={`glyphicon glyphicon-${option.glyph}`} />
								<div className="later-label noselect">
									{pendingPreset === option.value ? 'Working...' : option.label}
								</div>
							</button>
						</div>
					))}
				</div>
			))}
		</div>
	);
}

export function mountLaterPickerIsland({ container, notify, onDismiss, onHidden }) {
	const root = createRoot(container);
	const state = {
		onHideThread: null,
		threadId: null,
	};

	function renderApp() {
		root.render(
			<LaterPickerApp
				notify={notify}
				onDismiss={onDismiss}
				onHidden={onHidden}
				state={state}
			/>
		);
	}

	renderApp();

	return {
		open({ onHideThread, threadId }) {
			state.onHideThread = onHideThread;
			state.threadId = threadId;
			renderApp();
		},
		unmount() {
			root.unmount();
		},
	};
}
