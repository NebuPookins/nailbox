import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LATER_PRESET_OPTIONS, resolveHideUntilPreset } from './later_picker_presets.js';
import type { HideUntilValue } from './api.js';

interface LaterPresetOption {
	glyph: string;
	label: string;
	value: string;
}

interface Notify {
	error?: (msg: string) => void;
}

interface LaterPickerState {
	onHide: ((targetId: string, hideUntil: HideUntilValue) => Promise<void>) | null;
	targetId: string | null;
}

function chunkPresetOptions(options: LaterPresetOption[], chunkSize: number): LaterPresetOption[][] {
	const rows: LaterPresetOption[][] = [];
	for (let index = 0; index < options.length; index += chunkSize) {
		rows.push(options.slice(index, index + chunkSize));
	}
	return rows;
}

interface LaterPickerAppProps {
	notify: Notify | undefined;
	onDismiss: (() => void) | undefined;
	state: LaterPickerState;
}

function LaterPickerApp({ notify, onDismiss, state }: LaterPickerAppProps) {
	const [pendingPreset, setPendingPreset] = useState('');
	const hasTarget = Boolean(state.targetId);

	async function handlePresetClick(presetValue: string) {
		if (!hasTarget) {
			notify?.error?.('Tried to hide thread, but no target was found.');
			return;
		}
		const hideUntil = resolveHideUntilPreset(presetValue) as HideUntilValue | null;
		if (!hideUntil) {
			notify?.error?.(`Forgot to implement ${presetValue}`);
			return;
		}
		setPendingPreset(presetValue);
		try {
			// Hiding removes the row right away, so close the picker now rather than after the
			// server responds; a failure brings the row back and is reported through the messenger.
			const pending = state.onHide?.(state.targetId as string, hideUntil);
			onDismiss?.();
			await pending;
		} catch (error: unknown) {
			const message = error instanceof Error && error.message
				? error.message
				: 'Failed to hide thread.';
			notify?.error?.(message);
		} finally {
			setPendingPreset('');
		}
	}

	const presetOptions = LATER_PRESET_OPTIONS as LaterPresetOption[];

	return (
		<div className="later-picker-app">
			{chunkPresetOptions(presetOptions, 3).map((row, rowIndex) => (
				<div className="row" key={`later-picker-row-${rowIndex}`}>
					{row.map((option) => (
						<div className="col-xs-4" key={option.value}>
							<button
								className="button btn btn-default"
								disabled={!hasTarget || pendingPreset.length > 0}
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

interface MountLaterPickerIslandDeps {
	container: Element;
	notify?: Notify;
	onDismiss?: () => void;
}

export function mountLaterPickerIsland({ container, notify, onDismiss }: MountLaterPickerIslandDeps) {
	const root = createRoot(container);
	const state: LaterPickerState = {
		onHide: null,
		targetId: null,
	};

	function renderApp() {
		root.render(
			<LaterPickerApp
				notify={notify}
				onDismiss={onDismiss}
				state={state}
			/>
		);
	}

	renderApp();

	return {
		clear() {
			state.onHide = null;
			state.targetId = null;
			renderApp();
		},
		open({ onHideThread, threadId }: { onHideThread: (threadId: string, hideUntil: HideUntilValue) => Promise<void>; threadId: string }) {
			state.onHide = onHideThread;
			state.targetId = threadId;
			renderApp();
		},
		openForBundle({ bundleId, onHideBundle }: { bundleId: string; onHideBundle: (bundleId: string, hideUntil: HideUntilValue) => Promise<void> }) {
			state.onHide = onHideBundle;
			state.targetId = bundleId;
			renderApp();
		},
		unmount() {
			root.unmount();
		},
	};
}
