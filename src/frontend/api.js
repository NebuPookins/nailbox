async function readResponseBody(response) {
	const contentType = response.headers.get('content-type') || '';
	if (contentType.includes('application/json')) {
		try {
			return await response.json();
		} catch (error) {
			return null;
		}
	}
	try {
		return await response.text();
	} catch (error) {
		return null;
	}
}

function buildApiError(response, responseBody) {
	const humanErrorMessage = responseBody && typeof responseBody === 'object'
		? responseBody.humanErrorMessage
		: null;
	const responseMessage = responseBody && typeof responseBody === 'object'
		? responseBody.message
		: null;
	const textBody = typeof responseBody === 'string' ? responseBody : null;
	const error = new Error(
		humanErrorMessage ||
		responseMessage ||
		textBody ||
		response.statusText ||
		`Request failed with status ${response.status}`
	);
	if (responseBody && typeof responseBody === 'object' && typeof responseBody.code === 'string') {
		error.code = responseBody.code;
	}
	error.status = response.status;
	error.responseBody = responseBody;
	return error;
}

async function request(url, options = {}, dependencies = {}) {
	const { onApiError } = dependencies;
	const headers = {
		...options.headers,
	};
	if (options.accept) {
		headers.Accept = options.accept;
	}
	if (options.body && !headers['Content-Type']) {
		headers['Content-Type'] = 'application/json';
	}
	const response = await fetch(url, {
		...options,
		headers,
	});
	const responseBody = await readResponseBody(response);
	if (!response.ok) {
		const error = buildApiError(response, responseBody);
		onApiError?.(error);
		throw error;
	}
	if (options.parseAs === 'void' || response.status === 204) {
		return undefined;
	}
	if (options.parseAs === 'text') {
		return typeof responseBody === 'string' ? responseBody : '';
	}
	return responseBody;
}

export async function fetchJson(url, options = {}) {
	return request(url, options);
}

export function createAppApi(dependencies = {}) {
	return {
		archiveThread(threadId) {
			return request(`/api/threads/${threadId}/archive`, {
				method: 'POST',
			}, dependencies);
		},
		buildRfc2822(payload) {
			return request('/api/rfc2822', {
				accept: 'text/plain',
				body: JSON.stringify(payload),
				method: 'POST',
				parseAs: 'text',
			}, dependencies);
		},
		deleteThread(threadId) {
			return request(`/api/threads/${threadId}/trash`, {
				method: 'POST',
			}, dependencies);
		},
		disconnectGmail() {
			return request('/auth/google/disconnect', {
				method: 'POST',
				parseAs: 'void',
			}, dependencies);
		},
		getAttachment(messageId, attachmentId) {
			return request(`/api/threads/messages/${messageId}/attachments/${attachmentId}`, {
				method: 'GET',
			}, dependencies);
		},
		getThreadData(threadId) {
			return request(`/api/threads/${threadId}/messages`, {
				method: 'GET',
			}, dependencies);
		},
		hideThread(threadId, hideUntil) {
			return request(`/api/threads/${threadId}/hideUntil`, {
				body: JSON.stringify(hideUntil),
				method: 'PUT',
			}, dependencies);
		},
		loadAuthStatus() {
			return request('/api/auth/status', {
				method: 'GET',
			}, dependencies);
		},
		loadGroupedThreads() {
			return request('/api/threads/grouped', {
				method: 'GET',
			}, dependencies);
		},
		loadLabels() {
			return request('/api/threads/labels', {
				method: 'GET',
			}, dependencies);
		},
		moveThreadToLabel(threadId, labelId) {
			return request(`/api/threads/${threadId}/move`, {
				body: JSON.stringify({labelId}),
				method: 'POST',
			}, dependencies);
		},
		refreshThread(threadId) {
			return request(`/api/threads/${threadId}/refresh`, {
				method: 'POST',
			}, dependencies);
		},
		sendMessage(payload) {
			return request('/api/threads/messages/send', {
				body: JSON.stringify(payload),
				method: 'POST',
			}, dependencies);
		},
		syncThreadsFromGoogle() {
			return request('/api/threads/sync', {
				method: 'POST',
			}, dependencies);
		},
		updateMessageWordcount(threadId, messageId, wordcount) {
			return request(`/api/threads/${threadId}/messages/${messageId}/wordcount`, {
				body: JSON.stringify({wordcount}),
				method: 'POST',
				parseAs: 'void',
			}, dependencies);
		},
	};
}

export function createGroupingRulesApi(dependencies = {}) {
	return {
		loadRules() {
			return request('/api/email-grouping-rules', {
				method: 'GET',
			}, dependencies);
		},
		saveRules(payload) {
			return request('/api/email-grouping-rules', {
				body: JSON.stringify(payload),
				method: 'POST',
			}, dependencies);
		},
	};
}
