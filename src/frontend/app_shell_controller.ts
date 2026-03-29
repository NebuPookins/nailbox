declare const moment: {
	duration(amount: number, unit: string): { humanize(): string; as(unit: string): number };
};

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
	loadAuthStatus(): Promise<unknown>;
	disconnectGmail(): Promise<unknown>;
}

export function createAppShellController({
	appApi,
	getAuthStatus,
	loadLabels,
	messengerGetter,
	renderConnectedState,
	renderDisconnectedState,
	renderSetupNeededState,
	reportError,
	scheduleInterval = setInterval,
	setAuthStatus,
	syncThreadsFromGoogle,
	updateUiWithThreadsFromServer,
}: {
	appApi: AppApi;
	getAuthStatus(): AuthStatus;
	loadLabels(): Promise<unknown>;
	messengerGetter(): Messenger;
	renderConnectedState(): void;
	renderDisconnectedState(message?: string): void;
	renderSetupNeededState(message?: string): void;
	reportError(error: unknown): void;
	scheduleInterval?: typeof setInterval;
	setAuthStatus(status: AuthStatus): void;
	syncThreadsFromGoogle(messenger: MsgHandle): Promise<unknown>;
	updateUiWithThreadsFromServer(messenger: MsgHandle): Promise<unknown>;
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
			await syncThreadsFromGoogle(messengerGetter().info('Downloading new threads from Gmail...'));
			await updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
		} catch (error) {
			messengerGetter().error('Failed to refresh Gmail. Cached mail is still available.');
		}

		scheduleInterval(function() {
			if (getAuthStatus().connected) {
				updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...')).catch(reportError);
			}
		}, moment.duration(5, 'minutes').as('milliseconds'));

		scheduleInterval(function() {
			if (getAuthStatus().connected) {
				syncThreadsFromGoogle(messengerGetter().info('Downloading new threads from Gmail...'))
					.then(function() {
						return updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
					})
					.catch(reportError);
			}
		}, moment.duration(30, 'minutes').as('milliseconds'));
	}

	return {
		async initialize() {
			const status = await appApi.loadAuthStatus() as AuthStatus;
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
