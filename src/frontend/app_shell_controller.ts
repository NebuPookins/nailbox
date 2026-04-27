import { type Result, type AppApi } from './api.js';
import { type MsgHandle } from './messenger_shim.js';

interface Messenger {
	info(message: string): MsgHandle;
	error(message: string): MsgHandle;
}

interface AuthStatus {
	configured?: boolean;
	connected?: boolean;
	emailAddress?: string | null;
}

interface ThreadUpdatesConnection {
	connect(): void;
	disconnect(): void;
}

interface AppShellController {
	initialize(): Promise<Result<'setup-needed' | 'disconnected' | 'connected'>>;
	disconnectGmail(): Promise<{ ok: true }>;
	refreshNow(): Promise<{ ok: true }>;
}


export function createAppShellController(options: {
	appApi: AppApi;
	getAuthStatus: () => AuthStatus;
	loadGroupingRules: () => Promise<void>;
	loadLabels: () => Promise<Result<void>>;
	messengerGetter: () => Messenger;
	renderConnectedState: () => void;
	renderDisconnectedState: (message?: string) => void;
	renderSetupNeededState: (message?: string) => void;
	setAuthStatus: (status: AuthStatus) => void;
	syncThreadsFromGoogle: (messenger: MsgHandle) => Promise<void>;
	threadUpdatesConnection: ThreadUpdatesConnection | undefined;
	updateUiWithThreadsFromServer: (messenger: MsgHandle) => Promise<void>;
}): AppShellController {
	const {
		appApi,
		getAuthStatus,
		loadGroupingRules,
		loadLabels,
		messengerGetter,
		renderConnectedState,
		renderDisconnectedState,
		renderSetupNeededState,
		setAuthStatus,
		syncThreadsFromGoogle,
		threadUpdatesConnection,
		updateUiWithThreadsFromServer,
	} = options;
	async function bootstrapConnectedApp() {
		renderConnectedState();
		try {
			try {
				await loadGroupingRules();
			} catch (error) {
				messengerGetter().error('Failed to load grouping rules. Continuing with current grouping.');
			}
			await updateUiWithThreadsFromServer(messengerGetter().info('Loading cached threads...'));
			const labelsResult = await loadLabels();
			if (!labelsResult.ok) {
				messengerGetter().error('Failed to load Gmail labels. Continuing with cached mail.');
			}
		} catch (error) {
			messengerGetter().error('Failed to refresh cached threads.');
		}
		threadUpdatesConnection?.connect();
	}

	return {
		async initialize(): Promise<Result<'setup-needed' | 'disconnected' | 'connected'>> {
			const result = await appApi.loadAuthStatus();
			if (!result.ok) {
				renderSetupNeededState('Failed to load authentication status. Please check your connection and try again.');
				return { ok: false, error: result.error };
			}
			const status = result.value;
			setAuthStatus(status);
			if (!status.configured) {
				renderSetupNeededState();
				return {
					ok: true,
					value: 'setup-needed',
				};
			}
			if (!status.connected) {
				renderDisconnectedState();
				return {
					ok: true,
					value: 'disconnected',
				};
			}
			await bootstrapConnectedApp();
			return {
				ok: true,
				value: 'connected',
			};
		},

		async disconnectGmail(): Promise<{ ok: true }> {
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

		async refreshNow(): Promise<{ ok: true }> {
			await syncThreadsFromGoogle(messengerGetter().info('Syncing Gmail...'));
			await updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
			return {
				ok: true,
			};
		},
	} satisfies AppShellController;
}
