import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LATER_PRESET_OPTIONS, resolveHideUntilPreset } from './later_picker_presets.js';

interface LaterPresetOption {
	glyph: string;
	label: string;
	value: string;
}

interface HideUntilValue {
	type: 'timestamp' | 'when-i-have-time';
	value?: number;
}

interface Notify {
	error?: (msg: string) => void;
}

interface LaterPickerState {
	onHide: ((targetId: string, hideUntil: HideUntilValue) => Promise<unknown>) | null;
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
	onHidden: ((threadId: string) => void) | undefined;
	state: LaterPickerState;
}

function LaterPickerApp({ notify, onDismiss, onHidden, state }: LaterPickerAppProps) {
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
			await Promise.resolve(state.onHide?.(state.targetId as string, hideUntil));
			onHidden?.(state.targetId as string);
			onDismiss?.();
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
	onHidden?: (threadId: string) => void;
}

export function mountLaterPickerIsland({ container, notify, onDismiss, onHidden }: MountLaterPickerIslandDeps) {
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
				onHidden={onHidden}
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
		open({ onHideThread, threadId }: { onHideThread: (threadId: string, hideUntil: HideUntilValue) => Promise<unknown>; threadId: string }) {
			state.onHide = onHideThread;
			state.targetId = threadId;
			renderApp();
		},
		openForBundle({ bundleId, onHideBundle }: { bundleId: string; onHideBundle: (bundleId: string, hideUntil: HideUntilValue) => Promise<unknown> }) {
			state.onHide = onHideBundle;
			state.targetId = bundleId;
			renderApp();
		},
		unmount() {
			root.unmount();
		},
	};
}
