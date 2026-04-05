export function createThreadUpdatesSocket({
	onThreadsChanged,
	reportError,
	webSocketFactory = (url: string) => new WebSocket(url),
}: {
	onThreadsChanged(): void;
	reportError?(error: unknown): void;
	webSocketFactory?: (url: string) => WebSocket;
}) {
	let socket: WebSocket | null = null;
	let reconnectDelayMs = 1000;
	let reconnectTimerId: number | null = null;
	let wasManuallyClosed = false;

	function clearReconnectTimer(): void {
		if (reconnectTimerId != null) {
			window.clearTimeout(reconnectTimerId);
			reconnectTimerId = null;
		}
	}

	function scheduleReconnect(): void {
		if (wasManuallyClosed || reconnectTimerId != null) {
			return;
		}
		reconnectTimerId = window.setTimeout(() => {
			reconnectTimerId = null;
			connect();
		}, reconnectDelayMs);
		reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
	}

	function buildUrl(): string {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${protocol}//${window.location.host}/ws/threads`;
	}

	function connect(): void {
		clearReconnectTimer();
		if (socket && (
			socket.readyState === WebSocket.OPEN ||
			socket.readyState === WebSocket.CONNECTING
		)) {
			return;
		}
		wasManuallyClosed = false;
		socket = webSocketFactory(buildUrl());
		socket.addEventListener('open', () => {
			reconnectDelayMs = 1000;
		});
		socket.addEventListener('message', (event) => {
			try {
				const payload = JSON.parse(String(event.data));
				if (payload && payload.type === 'threads-changed') {
					onThreadsChanged();
				}
			} catch (error) {
				reportError?.(error);
			}
		});
		socket.addEventListener('close', () => {
			socket = null;
			scheduleReconnect();
		});
		socket.addEventListener('error', (error) => {
			reportError?.(error);
		});
	}

	function disconnect(): void {
		wasManuallyClosed = true;
		clearReconnectTimer();
		if (socket) {
			socket.close();
			socket = null;
		}
	}

	return {
		connect,
		disconnect,
	};
}

