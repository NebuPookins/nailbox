import type { GroupingRulesConfig, ThreadGroup } from './thread_grouping.js';
import { z } from 'zod';

interface ApiError extends Error {
	code?: string;
	status: number;
	responseBody: unknown;
}

interface RequestOptions {
	method?: string;
	accept?: string;
	body?: string;
	headers?: Record<string, string>;
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

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

async function readResponseBody(response: Response): Promise<Result<JsonValue>> {
	const contentType = response.headers.get('content-type') || '';
	if (contentType.includes('application/json')) {
		try {
			const value = await response.json();
			return { ok: true, value };
		} catch (error) {
			return { ok: false, error: error as Error };
		}
	}
	try {
		const value = await response.text();
		return { ok: true, value };
	} catch (error) {
		return { ok: false, error: error as Error };
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

const personSchema = z.object({
	name: z.string(),
	email: z.string().optional(),
});

const visibilitySchema = z.enum(['updated', 'visible', 'when-i-have-time', 'hidden', 'stale']);

const threadSummarySchema = z.object({
	type: z.literal('thread').optional(),
	threadId: z.string(),
	senders: z.array(personSchema),
	receivers: z.array(personSchema),
	lastUpdated: z.number(),
	subject: z.string(),
	snippet: z.string().nullable(),
	messageIds: z.array(z.string()),
	labelIds: z.array(z.string()),
	visibility: visibilitySchema,
	totalTimeToReadSeconds: z.number(),
	recentMessageReadTimeSeconds: z.number(),
}).passthrough();

const bundleSummarySchema = z.object({
	type: z.literal('bundle'),
	bundleId: z.string(),
	threadIds: z.array(z.string()),
	senders: z.array(personSchema),
	lastUpdated: z.number(),
	subject: z.string().optional(),
	snippet: z.string().nullable().optional(),
	visibility: visibilitySchema,
	threadCount: z.number(),
	memberThreads: z.array(threadSummarySchema).optional(),
	totalTimeToReadSeconds: z.number(),
	recentMessageReadTimeSeconds: z.number(),
}).passthrough();

const threadRowItemSchema = z.union([threadSummarySchema, bundleSummarySchema]);

const threadGroupSchema = z.object({
	label: z.string(),
	threads: z.array(threadSummarySchema),
	items: z.array(threadRowItemSchema).optional(),
	sortType: z.enum(['mostRecent', 'shortest']).optional(),
}).passthrough();

const groupedThreadsResponseSchema = z.array(threadGroupSchema);

const groupingRulesConfigSchema = z.object({
	rules: z.array(z.object({
		name: z.string(),
		priority: z.number(),
		sortType: z.enum(['mostRecent', 'shortest']),
		conditions: z.array(z.object({
			type: z.enum(['sender_name', 'sender_email', 'subject']),
			value: z.string(),
		})),
	})),
});

const createBundleResponseSchema = z.object({
	bundleId: z.string().optional(),
});

const rfc2822ResponseSchema = z.string();

const attachmentResponseSchema = z.object({
	data: z.string(),
});

const authStatusResponseSchema = z.object({
	configured: z.boolean().optional(),
	connected: z.boolean().optional(),
	emailAddress: z.string().nullable().optional(),
	scopes: z.array(z.string()).optional(),
});

const labelResponseSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	type: z.enum(['system', 'user']).optional(),
	labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional(),
});

const labelsResponseSchema = z.array(labelResponseSchema);

const sendMessageResponseSchema = z.object({
	id: z.string().optional(),
});

const syncThreadsResponseSchema = z.object({
	syncedThreadCount: z.number().optional(),
	results: z.array(z.object({
		status: z.number(),
		threadId: z.string(),
	})).optional(),
});

const threadMessageSchema = z.object({
	deleted: z.boolean(),
	messageId: z.string(),
	from: z.array(personSchema.nullable()),
	to: z.array(personSchema),
	date: z.number(),
	body: z.object({
		original: z.string(),
		sanitized: z.string(),
		plainText: z.string(),
	}),
	wordcount: z.number(),
	timeToReadSeconds: z.number(),
	attachments: z.array(z.object({
		filename: z.string(),
		size: z.number(),
		attachmentId: z.string(),
	})),
});

const threadDataResponseSchema = z.object({
	messages: z.array(threadMessageSchema),
});

type CreateBundleResponse = z.infer<typeof createBundleResponseSchema>;
type Rfc2822Response = z.infer<typeof rfc2822ResponseSchema>;
type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;
type AuthStatusResponse = z.infer<typeof authStatusResponseSchema>;
type LabelsResponse = z.infer<typeof labelsResponseSchema>;
type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
type SyncThreadsResponse = z.infer<typeof syncThreadsResponseSchema>;
export type ThreadDataResponse = z.infer<typeof threadDataResponseSchema>;

async function request(url: string, options: RequestOptions = {}): Promise<Result<JsonValue>> {
	const { accept, ...fetchOptions } = options;
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
	if (response.status === 204) {
		return { ok: true, value: null };
	}
	const bodyResult = await readResponseBody(response);
	if (!bodyResult.ok) {
		return { ok: false, error: bodyResult.error };
	}
	const responseBody: JsonValue = bodyResult.value;
	if (!response.ok) {
		const error = buildApiError(response, responseBody);
		return { ok: false, error };
	}
	return { ok: true, value: responseBody };
}

export function createAppApi() {
	return {
		addLabelToBundle(bundleId: string, labelId: string): Promise<Result<JsonValue>> {
			return request(`/api/bundles/${bundleId}/label`, {
				body: JSON.stringify({labelId}),
				method: 'POST',
			});
		},
		archiveBundle(bundleId: string): Promise<Result<JsonValue>> {
			return request(`/api/bundles/${bundleId}/archive`, {
				method: 'POST',
			});
		},
		archiveThread(threadId: string): Promise<Result<JsonValue>> {
			return request(`/api/threads/${threadId}/archive`, {
				method: 'POST',
			});
		},
		createBundle(threadIds: string[]): Promise<Result<CreateBundleResponse>> {
			return request('/api/bundles', {
				body: JSON.stringify({threadIds}),
				method: 'POST',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = createBundleResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		deleteBundle(bundleId: string): Promise<Result<JsonValue>> {
			return request(`/api/bundles/${bundleId}`, {
				method: 'DELETE',
			});
		},
		updateBundle(bundleId: string, threadIds: string[], mergeBundleIds?: string[]): Promise<Result<JsonValue>> {
			const payload: {threadIds: string[]; mergeBundleIds?: string[]} = {threadIds};
			if (mergeBundleIds && mergeBundleIds.length > 0) {
				payload.mergeBundleIds = mergeBundleIds;
			}
			return request(`/api/bundles/${bundleId}`, {
				body: JSON.stringify(payload),
				method: 'PUT',
			});
		},
		hideBundle(bundleId: string, hideUntil: HideUntilValue): Promise<Result<JsonValue>> {
			return request(`/api/bundles/${bundleId}/hideUntil`, {
				body: JSON.stringify(hideUntil),
				method: 'PUT',
			});
		},
		buildRfc2822(payload: Rfc2822Payload): Promise<Result<Rfc2822Response>> {
			return request('/api/rfc2822', {
				accept: 'text/plain',
				body: JSON.stringify(payload),
				method: 'POST',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = rfc2822ResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		deleteThread(threadId: string): Promise<Result<JsonValue>> {
			return request(`/api/threads/${threadId}/trash`, {
				method: 'POST',
			});
		},
		disconnectGmail(): Promise<Result<JsonValue>> { //TODO: Why do we even have this API?
			return request('/auth/google/disconnect', {
				method: 'POST',
			});
		},
		getAttachment(messageId: string, attachmentId: string): Promise<Result<AttachmentResponse>> {
			return request(`/api/threads/messages/${messageId}/attachments/${attachmentId}`, {
				method: 'GET',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = attachmentResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		getThreadData(threadId: string): Promise<Result<ThreadDataResponse>> {
			return request(`/api/threads/${threadId}/messages`, {
				method: 'GET',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = threadDataResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		hideThread(threadId: string, hideUntil: HideUntilValue): Promise<Result<JsonValue>> {
			return request(`/api/threads/${threadId}/hideUntil`, {
				body: JSON.stringify(hideUntil),
				method: 'PUT',
			});
		},
		loadAuthStatus(): Promise<Result<AuthStatusResponse>> {
			return request('/api/auth/status', {
				method: 'GET',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = authStatusResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		loadGroupedThreads(): Promise<Result<ThreadGroup[]>> {
			return request('/api/threads/grouped', {
				method: 'GET',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = groupedThreadsResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data as ThreadGroup[] };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		loadLabels(): Promise<Result<LabelsResponse>> {
			return request('/api/threads/labels', {
				method: 'GET',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = labelsResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		moveThreadToLabel(threadId: string, labelId: string): Promise<Result<JsonValue>> {
			return request(`/api/threads/${threadId}/move`, {
				body: JSON.stringify({labelId}),
				method: 'POST',
			});
		},
		refreshThread(threadId: string): Promise<Result<JsonValue>> {
			return request(`/api/threads/${threadId}/refresh`, {
				method: 'POST',
			});
		},
		sendMessage(payload: {threadId: string; raw: string}): Promise<Result<SendMessageResponse>> {
			return request('/api/threads/messages/send', {
				body: JSON.stringify(payload),
				method: 'POST',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = sendMessageResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		syncThreadsFromGoogle(): Promise<Result<SyncThreadsResponse>> {
			return request('/api/threads/sync', {
				method: 'POST',
			}).then(result => {
				if (!result.ok) return result;
				const parseResult = syncThreadsResponseSchema.safeParse(result.value);
				if (parseResult.success) {
					return { ok: true, value: parseResult.data };
				} else {
					return { ok: false, error: new Error(parseResult.error.message) };
				}
			});
		},
		updateMessageWordcount(threadId: string, messageId: string, wordcount: number): Promise<Result<JsonValue>> {
			return request(`/api/threads/${threadId}/messages/${messageId}/wordcount`, {
				body: JSON.stringify({wordcount}),
				method: 'POST',
			});
		},
	};
}

export type AppApi = ReturnType<typeof createAppApi>;

/**
 * Creates an API client for managing email grouping rules configuration.
 * Provides methods to load and save the rules that determine how emails are grouped in the UI.
 */
export function createGroupingRulesApi(): {
	/** Loads the current email grouping rules configuration from the server. */
	loadRules(): Promise<Result<GroupingRulesConfig>>;
	/** Saves the provided grouping rules configuration to the server. */
	saveRules(payload: JsonValue): Promise<Result<JsonValue>>;
} {
	return {
		async loadRules(): Promise<Result<GroupingRulesConfig>> {
			const result: Result<JsonValue> = await request('/api/email-grouping-rules', {
				method: 'GET',
			});
			if (!result.ok) return result;
			const parseResult = groupingRulesConfigSchema.safeParse(result.value);
			if (parseResult.success) {
				return { ok: true, value: parseResult.data };
			} else {
				return { ok: false, error: new Error(parseResult.error.message) };
			}
		},
		saveRules(payload: JsonValue): Promise<Result<JsonValue>> {
			return request('/api/email-grouping-rules', {
				body: JSON.stringify(payload),
				method: 'POST',
			});
		},
	};
}
