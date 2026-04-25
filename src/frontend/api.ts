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

export interface HideUntilValue {
	type: 'timestamp' | 'when-i-have-time';
	/** Unix timestamp in milliseconds; only present when type is 'timestamp'. */
	value?: number;
}

export interface Rfc2822Payload {
	myEmail: string;
	threadId: string;
	body?: string;
	inReplyTo?: string | null;
}

export interface LabelResponse {
	/** Gmail label ID. System labels use ALL_CAPS (e.g. 'INBOX'); user labels use 'Label_XXXXXXX'. */
	id: string;
	/** Human-readable display name shown in the Gmail sidebar. */
	name?: string;
	/** 'system' for built-in Gmail labels (INBOX, SENT, etc.); 'user' for user-created labels. */
	type?: 'system' | 'user';
	/** Controls sidebar visibility: show always, show only when unread, or hide. */
	labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
}

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

async function readResponseBody(response: Response): Promise<JsonValue> {
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

async function request<T>(url: string, options: RequestOptions = {}, dependencies: ApiDeps = {}): Promise<T> {
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
		return undefined as T;
	}
	if (parseAs === 'text') {
		return (typeof responseBody === 'string' ? responseBody : '') as T;
	}
	return responseBody as T;
}

export async function fetchJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
	return request<T>(url, options);
}

export function createAppApi(dependencies: ApiDeps = {}) {
	return {
		addLabelToBundle(bundleId: string, labelId: string): Promise<void> {
			return request<void>(`/api/bundles/${bundleId}/label`, {
				body: JSON.stringify({labelId}),
				method: 'POST',
			}, dependencies);
		},
		archiveBundle(bundleId: string): Promise<void> {
			return request<void>(`/api/bundles/${bundleId}/archive`, {
				method: 'POST',
			}, dependencies);
		},
		archiveThread(threadId: string): Promise<void> {
			return request<void>(`/api/threads/${threadId}/archive`, {
				method: 'POST',
			}, dependencies);
		},
		createBundle(threadIds: string[]): Promise<{bundleId?: string}> {
			return request<{bundleId?: string}>('/api/bundles', {
				body: JSON.stringify({threadIds}),
				method: 'POST',
			}, dependencies);
		},
		deleteBundle(bundleId: string): Promise<void> {
			return request<void>(`/api/bundles/${bundleId}`, {
				method: 'DELETE',
				parseAs: 'void',
			}, dependencies);
		},
		updateBundle(bundleId: string, threadIds: string[], mergeBundleIds?: string[]): Promise<void> {
			const payload: {threadIds: string[]; mergeBundleIds?: string[]} = {threadIds};
			if (mergeBundleIds && mergeBundleIds.length > 0) {
				payload.mergeBundleIds = mergeBundleIds;
			}
			return request<void>(`/api/bundles/${bundleId}`, {
				body: JSON.stringify(payload),
				method: 'PUT',
			}, dependencies);
		},
		hideBundle(bundleId: string, hideUntil: HideUntilValue): Promise<void> {
			return request<void>(`/api/bundles/${bundleId}/hideUntil`, {
				body: JSON.stringify(hideUntil),
				method: 'PUT',
			}, dependencies);
		},
		buildRfc2822(payload: Rfc2822Payload): Promise<string> {
			return request<string>('/api/rfc2822', {
				accept: 'text/plain',
				body: JSON.stringify(payload),
				method: 'POST',
				parseAs: 'text',
			}, dependencies);
		},
		deleteThread(threadId: string): Promise<void> {
			return request<void>(`/api/threads/${threadId}/trash`, {
				method: 'POST',
			}, dependencies);
		},
		disconnectGmail(): Promise<void> {
			return request<void>('/auth/google/disconnect', {
				method: 'POST',
				parseAs: 'void',
			}, dependencies);
		},
		getAttachment(messageId: string, attachmentId: string): Promise<{data: string}> {
			return request<{data: string}>(`/api/threads/messages/${messageId}/attachments/${attachmentId}`, {
				method: 'GET',
			}, dependencies);
		},
		getThreadData(threadId: string): Promise<unknown> {
			return request<unknown>(`/api/threads/${threadId}/messages`, {
				method: 'GET',
			}, dependencies);
		},
		hideThread(threadId: string, hideUntil: HideUntilValue): Promise<void> {
			return request<void>(`/api/threads/${threadId}/hideUntil`, {
				body: JSON.stringify(hideUntil),
				method: 'PUT',
			}, dependencies);
		},
		loadAuthStatus(): Promise<{configured?: boolean; connected?: boolean; emailAddress?: string | null; scopes?: string[]}> {
			return request<{configured?: boolean; connected?: boolean; emailAddress?: string | null; scopes?: string[]}>('/api/auth/status', {
				method: 'GET',
			}, dependencies);
		},
		loadGroupedThreads(): Promise<unknown> {
			return request<unknown>('/api/threads/grouped', {
				method: 'GET',
			}, dependencies);
		},
		loadLabels(): Promise<LabelResponse[]> {
			return request<LabelResponse[]>('/api/threads/labels', {
				method: 'GET',
			}, dependencies);
		},
		moveThreadToLabel(threadId: string, labelId: string): Promise<void> {
			return request<void>(`/api/threads/${threadId}/move`, {
				body: JSON.stringify({labelId}),
				method: 'POST',
			}, dependencies);
		},
		refreshThread(threadId: string): Promise<void> {
			return request<void>(`/api/threads/${threadId}/refresh`, {
				method: 'POST',
			}, dependencies);
		},
		sendMessage(payload: {threadId: string; raw: string}): Promise<{id?: string}> {
			return request<{id?: string}>('/api/threads/messages/send', {
				body: JSON.stringify(payload),
				method: 'POST',
			}, dependencies);
		},
		syncThreadsFromGoogle(): Promise<{syncedThreadCount?: number; results?: Array<{status: number; threadId: string}>}> {
			return request<{syncedThreadCount?: number; results?: Array<{status: number; threadId: string}>}>('/api/threads/sync', {
				method: 'POST',
			}, dependencies);
		},
		updateMessageWordcount(threadId: string, messageId: string, wordcount: number): Promise<void> {
			return request<void>(`/api/threads/${threadId}/messages/${messageId}/wordcount`, {
				body: JSON.stringify({wordcount}),
				method: 'POST',
				parseAs: 'void',
			}, dependencies);
		},
	};
}

export function createGroupingRulesApi(dependencies: ApiDeps = {}) {
	return {
		loadRules(): Promise<{rules: unknown[]}> {
			return request<{rules: unknown[]}>('/api/email-grouping-rules', {
				method: 'GET',
			}, dependencies);
		},
		saveRules(payload: unknown): Promise<void> {
			return request<void>('/api/email-grouping-rules', {
				body: JSON.stringify(payload),
				method: 'POST',
			}, dependencies);
		},
	};
}
