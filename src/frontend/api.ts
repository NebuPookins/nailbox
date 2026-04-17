export interface ApiError extends Error {
	code?: string;
	status: number;
	responseBody: unknown;
}

interface RequestOptions {
	method?: string;
	accept?: string;
	body?: string;
	headers?: Record<string, string>;
	parseAs?: 'void' | 'text';
}

interface ApiDeps {
	onApiError?: (error: ApiError) => void;
}

async function readResponseBody(response: Response): Promise<unknown> {
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

function buildApiError(response: Response, responseBody: unknown): ApiError {
	const body = responseBody as Record<string, unknown>;
	const humanErrorMessage = responseBody && typeof responseBody === 'object'
		? body.humanErrorMessage
		: null;
	const responseMessage = responseBody && typeof responseBody === 'object'
		? body.message
		: null;
	const textBody = typeof responseBody === 'string' ? responseBody : null;
	const error = new Error(
		(humanErrorMessage as string | null) ||
		(responseMessage as string | null) ||
		textBody ||
		response.statusText ||
		`Request failed with status ${response.status}`
	) as ApiError;
	if (responseBody && typeof responseBody === 'object' && typeof body.code === 'string') {
		error.code = body.code;
	}
	error.status = response.status;
	error.responseBody = responseBody;
	return error;
}

async function request(url: string, options: RequestOptions = {}, dependencies: ApiDeps = {}): Promise<unknown> {
	const { onApiError } = dependencies;
	const { accept, parseAs, ...fetchOptions } = options;
	const headers: Record<string, string> = {
		...fetchOptions.headers,
	};
	if (accept) {
		headers.Accept = accept;
	}
	if (fetchOptions.body && !headers['Content-Type']) {
		headers['Content-Type'] = 'application/json';
	}
	const response = await fetch(url, {
		...fetchOptions,
		headers,
	});
	const responseBody = await readResponseBody(response);
	if (!response.ok) {
		const error = buildApiError(response, responseBody);
		onApiError?.(error);
		throw error;
	}
	if (parseAs === 'void' || response.status === 204) {
		return undefined;
	}
	if (parseAs === 'text') {
		return typeof responseBody === 'string' ? responseBody : '';
	}
	return responseBody;
}

export async function fetchJson(url: string, options: RequestOptions = {}): Promise<unknown> {
	return request(url, options);
}

export function createAppApi(dependencies: ApiDeps = {}) {
	return {
		addLabelToBundle(bundleId: string, labelId: string) {
			return request(`/api/bundles/${bundleId}/label`, {
				body: JSON.stringify({labelId}),
				method: 'POST',
			}, dependencies);
		},
		archiveBundle(bundleId: string) {
			return request(`/api/bundles/${bundleId}/archive`, {
				method: 'POST',
			}, dependencies);
		},
		archiveThread(threadId: string) {
			return request(`/api/threads/${threadId}/archive`, {
				method: 'POST',
			}, dependencies);
		},
		createBundle(threadIds: string[]) {
			return request('/api/bundles', {
				body: JSON.stringify({threadIds}),
				method: 'POST',
			}, dependencies);
		},
		deleteBundle(bundleId: string) {
			return request(`/api/bundles/${bundleId}`, {
				method: 'DELETE',
				parseAs: 'void',
			}, dependencies);
		},
		updateBundle(bundleId: string, threadIds: string[], mergeBundleIds?: string[]) {
			const payload: Record<string, unknown> = {threadIds};
			if (mergeBundleIds && mergeBundleIds.length > 0) {
				payload.mergeBundleIds = mergeBundleIds;
			}
			return request(`/api/bundles/${bundleId}`, {
				body: JSON.stringify(payload),
				method: 'PUT',
			}, dependencies);
		},
		hideBundle(bundleId: string, hideUntil: unknown) {
			return request(`/api/bundles/${bundleId}/hideUntil`, {
				body: JSON.stringify(hideUntil),
				method: 'PUT',
			}, dependencies);
		},
		buildRfc2822(payload: Record<string, unknown>) {
			return request('/api/rfc2822', {
				accept: 'text/plain',
				body: JSON.stringify(payload),
				method: 'POST',
				parseAs: 'text',
			}, dependencies);
		},
		deleteThread(threadId: string) {
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
		getAttachment(messageId: string, attachmentId: string) {
			return request(`/api/threads/messages/${messageId}/attachments/${attachmentId}`, {
				method: 'GET',
			}, dependencies);
		},
		getThreadData(threadId: string) {
			return request(`/api/threads/${threadId}/messages`, {
				method: 'GET',
			}, dependencies);
		},
		hideThread(threadId: string, hideUntil: unknown) {
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
		moveThreadToLabel(threadId: string, labelId: string) {
			return request(`/api/threads/${threadId}/move`, {
				body: JSON.stringify({labelId}),
				method: 'POST',
			}, dependencies);
		},
		refreshThread(threadId: string) {
			return request(`/api/threads/${threadId}/refresh`, {
				method: 'POST',
			}, dependencies);
		},
		sendMessage(payload: { threadId: string; raw: string }) {
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
		updateMessageWordcount(threadId: string, messageId: string, wordcount: number) {
			return request(`/api/threads/${threadId}/messages/${messageId}/wordcount`, {
				body: JSON.stringify({wordcount}),
				method: 'POST',
				parseAs: 'void',
			}, dependencies);
		},
	};
}

export function createGroupingRulesApi(dependencies: ApiDeps = {}) {
	return {
		loadRules() {
			return request('/api/email-grouping-rules', {
				method: 'GET',
			}, dependencies);
		},
		saveRules(payload: unknown) {
			return request('/api/email-grouping-rules', {
				body: JSON.stringify(payload),
				method: 'POST',
			}, dependencies);
		},
	};
}
