export function startGmailPoller({
	intervalMs,
	logger,
	notifyThreadsChanged,
	pollGmail,
	scheduleInterval = setInterval,
}: {
	intervalMs: number;
	logger?: {error(message: string): void; info(message: string): void};
	notifyThreadsChanged(reason: string): void;
	pollGmail(): Promise<{changedThreadIds?: string[] | null} | null>;
	scheduleInterval?: typeof setInterval;
}) {
	let pollInFlight = false;

	async function runPoll(reason: string): Promise<void> {
		if (pollInFlight) {
			return;
		}
		pollInFlight = true;
		try {
			const result = await pollGmail();
			const changedThreadIds = Array.isArray(result?.changedThreadIds) ? result.changedThreadIds : [];
			if (changedThreadIds.length > 0) {
				logger?.info(`Gmail poll detected ${changedThreadIds.length} changed thread(s).`);
				notifyThreadsChanged(reason);
			}
		} catch (error) {
			logger?.error(`Background Gmail poll failed: ${String(error)}`);
		} finally {
			pollInFlight = false;
		}
	}

	void runPoll('gmail-poll');
	const timer = scheduleInterval(() => {
		void runPoll('gmail-poll');
	}, intervalMs);

	return {
		stop() {
			clearInterval(timer);
		},
	};
}

