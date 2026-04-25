interface MsgHandle {
	update(opts: { type: string; message: string }): void;
}

interface Messenger {
	info(message: string): MsgHandle;
	error(message: string): MsgHandle;
}

interface AuthStatus {
	configured?: boolean;
	connected?: boolean;
	emailAddress?: string | null;
}

interface AppApi {
	loadAuthStatus(): Promise<AuthStatus>;
	disconnectGmail(): Promise<void>;
}

interface ThreadUpdatesConnection {
	connect(): void;
	disconnect(): void;
}

export function createAppShellController({
	appApi,
	getAuthStatus,
	loadGroupingRules,
	loadLabels,
	messengerGetter,
	renderConnectedState,
	renderDisconnectedState,
	renderSetupNeededState,
	reportError,
	setAuthStatus,
	syncThreadsFromGoogle,
	threadUpdatesConnection,
	updateUiWithThreadsFromServer,
}: {
	appApi: AppApi;
	getAuthStatus(): AuthStatus;
	loadGroupingRules?(): Promise<void>;
	loadLabels(): Promise<void>;
	messengerGetter(): Messenger;
	renderConnectedState(): void;
	renderDisconnectedState(message?: string): void;
	renderSetupNeededState(message?: string): void;
	reportError(error: unknown): void;
	setAuthStatus(status: AuthStatus): void;
	syncThreadsFromGoogle(messenger: MsgHandle): Promise<void>;
	threadUpdatesConnection?: ThreadUpdatesConnection;
	updateUiWithThreadsFromServer(messenger: MsgHandle): Promise<void>;
}) {
	async function bootstrapConnectedApp() {
		renderConnectedState();
		try {
			await updateUiWithThreadsFromServer(messengerGetter().info('Loading cached threads...'));
			try {
				await loadLabels();
			} catch (error) {
				messengerGetter().error('Failed to load Gmail labels. Continuing with cached mail.');
			}
			try {
				await loadGroupingRules?.();
			} catch (error) {
				messengerGetter().error('Failed to load grouping rules. Continuing with current grouping.');
			}
		} catch (error) {
			messengerGetter().error('Failed to refresh cached threads.');
		}
		threadUpdatesConnection?.connect();
	}

	return {
		async initialize() {
			const status = await appApi.loadAuthStatus();
			setAuthStatus(status);
			if (!status.configured) {
				renderSetupNeededState();
				return {
					ok: true,
					state: 'setup-needed',
				};
			}
			if (!status.connected) {
				renderDisconnectedState();
				return {
					ok: true,
					state: 'disconnected',
				};
			}
			await bootstrapConnectedApp();
			return {
				ok: true,
				state: 'connected',
			};
		},

		async disconnectGmail() {
			await appApi.disconnectGmail();
			setAuthStatus({
				...getAuthStatus(),
				connected: false,
				emailAddress: null,
			});
			threadUpdatesConnection?.disconnect();
			renderDisconnectedState('Gmail disconnected.');
			return {
				ok: true,
			};
		},

		async refreshNow() {
			await syncThreadsFromGoogle(messengerGetter().info('Syncing Gmail...'));
			await updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
			return {
				ok: true,
			};
		},
	};
}
