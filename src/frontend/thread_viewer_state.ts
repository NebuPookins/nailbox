export function createThreadViewerState() {
	var currentThreadId: string | null = null;
	var currentSubject = '';

	return {
		clear(): void {
			currentThreadId = null;
			currentSubject = '';
		},

		getSubject(): string {
			return currentSubject;
		},

		getThreadId(): string | null {
			return currentThreadId;
		},

		setSubject(subject?: string): void {
			currentSubject = subject || '';
		},

		setThreadId(threadId?: string | null): void {
			currentThreadId = threadId || null;
		},
	};
}
