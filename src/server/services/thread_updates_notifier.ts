import crypto from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function buildAcceptValue(key: string): string {
	return crypto
		.createHash('sha1')
		.update(`${key}${WEBSOCKET_GUID}`)
		.digest('base64');
}

function encodeTextFrame(message: string): Buffer {
	const payload = Buffer.from(message);
	const payloadLength = payload.length;
	if (payloadLength < 126) {
		return Buffer.concat([Buffer.from([0x81, payloadLength]), payload]);
	}
	if (payloadLength < 65536) {
		const header = Buffer.alloc(4);
		header[0] = 0x81;
		header[1] = 126;
		header.writeUInt16BE(payloadLength, 2);
		return Buffer.concat([header, payload]);
	}
	const header = Buffer.alloc(10);
	header[0] = 0x81;
	header[1] = 127;
	header.writeBigUInt64BE(BigInt(payloadLength), 2);
	return Buffer.concat([header, payload]);
}

export function createThreadUpdatesNotifier({
	logger,
}: {
	logger?: {warn(message: string): void};
} = {}) {
	const clients = new Set<Duplex>();

	function removeClient(socket: Duplex): void {
		clients.delete(socket);
	}

	function broadcast(payload: Record<string, unknown>): void {
		const frame = encodeTextFrame(JSON.stringify(payload));
		for (const client of clients) {
			if (client.destroyed || !client.writable) {
				removeClient(client);
				continue;
			}
			try {
				client.write(frame);
			} catch (error) {
				logger?.warn(`Failed to write websocket frame: ${String(error)}`);
				removeClient(client);
				client.destroy();
			}
		}
	}

	function notifyThreadsChanged(reason: string): void {
		broadcast({
			type: 'threads-changed',
			reason,
			sentAt: Date.now(),
		});
	}

	function handleUpgrade(request: IncomingMessage, socket: Duplex): boolean {
		if (request.url !== '/ws/threads') {
			return false;
		}
		const upgradeHeader = request.headers.upgrade;
		const connectionHeader = request.headers.connection;
		const websocketKey = request.headers['sec-websocket-key'];
		if (
			typeof websocketKey !== 'string' ||
			String(upgradeHeader).toLowerCase() !== 'websocket' ||
			!String(connectionHeader).toLowerCase().includes('upgrade')
		) {
			socket.destroy();
			return true;
		}

		const acceptValue = buildAcceptValue(websocketKey);
		socket.write(
			[
				'HTTP/1.1 101 Switching Protocols',
				'Upgrade: websocket',
				'Connection: Upgrade',
				`Sec-WebSocket-Accept: ${acceptValue}`,
				'',
				'',
			].join('\r\n')
		);
		clients.add(socket);
		socket.on('close', () => removeClient(socket));
		socket.on('end', () => removeClient(socket));
		socket.on('error', () => removeClient(socket));
		return true;
	}

	return {
		handleUpgrade,
		notifyThreadsChanged,
	};
}

