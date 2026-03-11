export function createThreadViewerState() {
	var currentThreadId = null;
	var currentSubject = '';

	return {
		clear() {
			currentThreadId = null;
			currentSubject = '';
		},

		getSubject() {
			return currentSubject;
		},

		getThreadId() {
			return currentThreadId;
		},

		setSubject(subject) {
			currentSubject = subject || '';
		},

		setThreadId(threadId) {
			currentThreadId = threadId || null;
		},
	};
}
