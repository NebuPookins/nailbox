import React from 'react';
import { createRoot } from 'react-dom/client';

type AuthStateType = 'idle' | 'setup-needed' | 'disconnected' | 'connected-loading' | 'empty' | 'error';

interface AuthState {
	type: AuthStateType;
	message: string | null;
	emailAddress: string | null;
}

interface StatusBannerProps {
	state: AuthState;
}

function StatusBanner({ state }: StatusBannerProps) {
	if (state.type === 'idle') {
		return null;
	}
	if (state.type === 'setup-needed') {
		return (
			<div className="jumbotron">
				<h1>Google OAuth setup required</h1>
				<p>{state.message || 'Configure Google OAuth before Nailbox can talk to Gmail.'}</p>
				<p><a className="btn btn-primary" href="/setup">Open setup</a></p>
			</div>
		);
	}
	if (state.type === 'disconnected') {
		return (
			<div className="jumbotron">
				<h1>Connect Gmail</h1>
				<p>{state.message || 'Gmail is not connected.'}</p>
				<p>
					<a className="btn btn-primary" href="/auth/google/start">Connect Gmail</a>{' '}
					<a className="btn btn-default" href="/setup">Review setup</a>
				</p>
			</div>
		);
	}
	if (state.type === 'connected-loading') {
		return (
			<div className="jumbotron">
				<h1>Loading Nailbox</h1>
				<p>Reading cached mail and refreshing Gmail in the background...</p>
			</div>
		);
	}
	if (state.type === 'empty') {
		return (
			<div className="jumbotron">
				<h1>No mail in cache yet</h1>
				<p>Use &ldquo;Sync Gmail&rdquo; to download mail into the local cache.</p>
			</div>
		);
	}
	if (state.type === 'error') {
		return (
			<div className="jumbotron">
				<h1>Failed to load cached mail</h1>
				<p>Check the server logs, then try syncing Gmail again.</p>
			</div>
		);
	}
	return null;
}

interface AuthControlsProps {
	state: AuthState;
	onDisconnect: () => void;
	onRefreshNow: () => void;
}

function AuthControls({ state, onDisconnect, onRefreshNow }: AuthControlsProps) {
	if (state.type === 'setup-needed') {
		return null;
	}
	if (state.type === 'disconnected') {
		return (
			<a className="btn btn-primary btn-sm" href="/auth/google/start">Connect Gmail</a>
		);
	}
	return (
		<span>
			<span className="text-muted" style={{ marginRight: '10px' }}>
				{state.emailAddress || 'Connected'}
			</span>
			<button
				className="btn btn-default btn-sm"
				onClick={onRefreshNow}
				type="button"
			>
				Sync Gmail
			</button>
			{' '}
			<button
				className="btn btn-warning btn-sm"
				onClick={onDisconnect}
				type="button"
			>
				Disconnect
			</button>
		</span>
	);
}

interface AuthShellIslandDeps {
	statusContainer: Element;
	authControlsContainer: Element;
	onDisconnect: () => void;
	onRefreshNow: () => void;
}

export function mountAuthShellIsland({ statusContainer, authControlsContainer, onDisconnect, onRefreshNow }: AuthShellIslandDeps) {
	const statusRoot = createRoot(statusContainer);
	const authControlsRoot = createRoot(authControlsContainer);
	const state: AuthState = { type: 'connected-loading', message: null, emailAddress: null };

	function renderAll() {
		statusRoot.render(<StatusBanner state={state} />);
		authControlsRoot.render(
			<AuthControls
				state={state}
				onDisconnect={onDisconnect}
				onRefreshNow={onRefreshNow}
			/>
		);
	}

	renderAll();

	return {
		setSetupNeeded(message?: string | null) {
			state.type = 'setup-needed';
			state.message = message || null;
			state.emailAddress = null;
			renderAll();
		},
		setDisconnected(message?: string | null) {
			state.type = 'disconnected';
			state.message = message || null;
			state.emailAddress = null;
			renderAll();
		},
		setConnectedLoading({ emailAddress }: { emailAddress?: string | null } = {}) {
			state.type = 'connected-loading';
			state.message = null;
			state.emailAddress = emailAddress || null;
			renderAll();
		},
		setIdle() {
			state.type = 'idle';
			renderAll();
		},
		setEmpty() {
			state.type = 'empty';
			renderAll();
		},
		setError() {
			state.type = 'error';
			renderAll();
		},
	};
}
