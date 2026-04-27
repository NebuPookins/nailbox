import type {GroupingCondition, GroupingRule, GroupingRulesConfig} from '../types/grouping_rules.js';
import type {AppConfig, GoogleOAuthSetupDto} from '../types/config.js';
import type {GoogleOAuthConfig, GmailMoveThreadDto, GmailSendMessageDto, Rfc2822RequestDto} from '../types/auth.js';
import type {
	PersistedMessage,
	PersistedThread,
	PersonDto,
	HideUntilDto,
	ThreadSummaryDto,
	ThreadMessageDto,
	WordcountUpdateDto,
} from '../types/thread.js';

function makeValidationError(message: string): Error & {code: string} {
	const error = new Error(message) as Error & {code: string};
	error.code = 'INVALID_CONTRACT';
	return error;
}

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw makeValidationError(`${name} must be an object`);
	}
}

function assertArray(value: unknown, name: string): asserts value is unknown[] {
	if (!Array.isArray(value)) {
		throw makeValidationError(`${name} must be an array`);
	}
}

function assertString(value: unknown, name: string): asserts value is string {
	if (typeof value !== 'string') {
		throw makeValidationError(`${name} must be a string, but was ${typeof value} ${JSON.stringify(value)}`);
	}
}

function assertStringArray(value: unknown, name: string): asserts value is string[] {
	assertArray(value, name);
	value.forEach((item, index) => assertString(item, `${name}[${index}]`));
}

function assertOptionalString(value: unknown, name: string): asserts value is string | null | undefined {
	if (value !== undefined && value !== null && typeof value !== 'string') {
		throw makeValidationError(`${name} must be a string when provided`);
	}
}

function assertNumber(value: unknown, name: string): asserts value is number {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		throw makeValidationError(`${name} must be a number`);
	}
}

function assertOneOf<const T>(value: unknown, allowedValues: readonly T[], name: string): asserts value is T {
	if (!(allowedValues as unknown[]).includes(value)) {
		throw makeValidationError(`${name} is invalid`);
	}
}

function normalizeGroupingCondition(condition: unknown, index: number): GroupingCondition {
	assertObject(condition, `rules[${index}] condition`);
	const condType = condition['type'];
	const condValue = condition['value'];
	assertString(condType, `rules[${index}] condition.type`);
	assertString(condValue, `rules[${index}] condition.value`);
	assertOneOf(condType, ['sender_name', 'sender_email', 'subject'] as const, `rules[${index}] condition.type`);
	return {
		type: condType,
		value: condValue,
	};
}

function normalizeGroupingRule(rule: unknown, index: number): GroupingRule {
	assertObject(rule, `rules[${index}]`);
	const name = rule['name'];
	const conditions = rule['conditions'];
	assertString(name, `rules[${index}].name`);
	assertArray(conditions, `rules[${index}].conditions`);
	const priority = rule['priority'] === undefined ? 50 : Number(rule['priority']);
	if (Number.isNaN(priority)) {
		throw makeValidationError(`rules[${index}].priority must be numeric`);
	}
	const sortType: 'shortest' | 'mostRecent' = rule['sortType'] === 'shortest' ? 'shortest' : 'mostRecent';
	return {
		name,
		priority,
		sortType,
		conditions: conditions.map((condition) => normalizeGroupingCondition(condition, index)),
	};
}

export function normalizeGroupingRulesConfig(value: unknown): GroupingRulesConfig {
	if (value === undefined || value === null) {
		return {rules: []};
	}
	assertObject(value, 'emailGroupingRules');
	const rawRules = value['rules'] === undefined ? [] : value['rules'];
	assertArray(rawRules, 'emailGroupingRules.rules');
	return {
		rules: rawRules.map((rule, index) => normalizeGroupingRule(rule, index)),
	};
}

function normalizeGoogleOAuthConfig(value: unknown): GoogleOAuthConfig {
	if (value === undefined || value === null) {
		return {};
	}
	assertObject(value, 'googleOAuth');
	const fields = {
		clientId: value['clientId'],
		clientSecret: value['clientSecret'],
		redirectUri: value['redirectUri'],
		accessToken: value['accessToken'],
		accessTokenExpiresAt: value['accessTokenExpiresAt'],
		refreshToken: value['refreshToken'],
		scope: value['scope'],
		connectedEmailAddress: value['connectedEmailAddress'],
	} as const;
	for (const [key, val] of Object.entries(fields)) {
		assertOptionalString(val, `googleOAuth.${key}`);
	}
	const result: GoogleOAuthConfig = {};
	for (const [key, val] of Object.entries(fields) as [keyof GoogleOAuthConfig, unknown][]) {
		if (val !== undefined && val !== null) {
			(result as Record<string, unknown>)[key] = val;
		}
	}
	return result;
}

export function normalizeAppConfig(value: unknown): AppConfig {
	if (value === undefined || value === null) {
		return {
			googleOAuth: {},
			emailGroupingRules: {rules: []},
		};
	}
	assertObject(value, 'config');
	const rawPort = value['port'];
	if (rawPort !== undefined) {
		assertNumber(rawPort, 'config.port');
	}
	const clientId = value['clientId'];
	assertOptionalString(clientId, 'config.clientId');
	const result: AppConfig = {
		googleOAuth: normalizeGoogleOAuthConfig(value['googleOAuth']),
		emailGroupingRules: normalizeGroupingRulesConfig(value['emailGroupingRules']),
	};
	if (rawPort !== undefined) {
		result.port = rawPort as number;
	}
	if (clientId !== undefined && clientId !== null) {
		result.clientId = clientId;
	}
	return result;
}

export function normalizeGoogleOAuthSetupDto(value: unknown, defaultRedirectUri: unknown): GoogleOAuthSetupDto {
	assertObject(value, 'googleOAuthSetup');
	const clientId = typeof value['clientId'] === 'string' ? value['clientId'].trim() : '';
	const clientSecret = typeof value['clientSecret'] === 'string' ? value['clientSecret'].trim() : '';
	const fallbackRedirectUri = typeof defaultRedirectUri === 'string' ? defaultRedirectUri : '';
	const redirectUri = typeof value['redirectUri'] === 'string'
		? value['redirectUri'].trim()
		: fallbackRedirectUri.trim();
	if (clientId.length === 0) {
		throw makeValidationError('googleOAuthSetup.clientId is required');
	}
	if (clientSecret.length === 0) {
		throw makeValidationError('googleOAuthSetup.clientSecret is required');
	}
	if (redirectUri.length === 0) {
		throw makeValidationError('googleOAuthSetup.redirectUri is required');
	}
	return {
		clientId,
		clientSecret,
		redirectUri,
	};
}

function normalizePersistedMessage(message: unknown, index: number): PersistedMessage {
	assertObject(message, `thread.messages[${index}]`);
	assertString(message['id'], `thread.messages[${index}].id`);
	if (message['threadId'] !== undefined) {
		assertOptionalString(message['threadId'], `thread.messages[${index}].threadId`);
	}
	assertArray(message['labelIds'], `thread.messages[${index}].labelIds`);
	if (!(typeof message['internalDate'] === 'string' || typeof message['internalDate'] === 'number')) {
		throw makeValidationError(`thread.messages[${index}].internalDate must be a string or number`);
	}
	const payload = message['payload'];
	assertObject(payload, `thread.messages[${index}].payload`);
	assertArray(payload['headers'], `thread.messages[${index}].payload.headers`);
	return message as unknown as PersistedMessage;
}

export function validatePersistedThread(value: unknown): PersistedThread {
	assertObject(value, 'thread');
	assertString(value['id'], 'thread.id');
	const messages = value['messages'];
	assertArray(messages, 'thread.messages');
	messages.forEach((message, index) => normalizePersistedMessage(message, index));
	return value as unknown as PersistedThread;
}

export function validateThreadPayload(value: unknown): PersistedThread {
	return validatePersistedThread(value);
}

function normalizePerson(value: unknown, name: string): PersonDto {
	assertObject(value, name);
	const personName = value['name'];
	const personEmail = value['email'];
	assertString(personName, `${name}.name`);
	if (personEmail !== undefined) {
		assertString(personEmail, `${name}.email`);
	}
	return {
		name: personName,
		email: personEmail as string | undefined,
	};
}

export function normalizeThreadSummaryDto(value: unknown): ThreadSummaryDto {
	assertObject(value, 'threadSummary');
	const threadId = value['threadId'];
	assertString(threadId, 'threadSummary.threadId');
	const senders = value['senders'];
	assertArray(senders, 'threadSummary.senders');
	const receivers = value['receivers'];
	assertArray(receivers, 'threadSummary.receivers');
	const lastUpdated = value['lastUpdated'];
	assertNumber(lastUpdated, 'threadSummary.lastUpdated');
	const subject = value['subject'];
	assertString(subject, 'threadSummary.subject');
	const snippet = value['snippet'];
	if (snippet !== null) {
		assertString(snippet, 'threadSummary.snippet');
	}
	const messageIds = value['messageIds'];
	assertStringArray(messageIds, 'threadSummary.messageIds');
	const labelIds = value['labelIds'];
	assertStringArray(labelIds, 'threadSummary.labelIds');
	const visibility = value['visibility'];
	assertString(visibility, 'threadSummary.visibility');
	assertOneOf(visibility, ['updated', 'visible', 'when-i-have-time', 'hidden', 'stale'] as const, 'threadSummary.visibility');
	const isWhenIHaveTime = value['isWhenIHaveTime'];
	if (typeof isWhenIHaveTime !== 'boolean') {
		throw makeValidationError('threadSummary.isWhenIHaveTime must be a boolean');
	}
	const totalTimeToReadSeconds = value['totalTimeToReadSeconds'];
	assertNumber(totalTimeToReadSeconds, 'threadSummary.totalTimeToReadSeconds');
	const recentMessageReadTimeSeconds = value['recentMessageReadTimeSeconds'];
	assertNumber(recentMessageReadTimeSeconds, 'threadSummary.recentMessageReadTimeSeconds');
	return {
		type: 'thread' as const,
		threadId,
		senders: senders.map((sender, index) => normalizePerson(sender, `threadSummary.senders[${index}]`)),
		receivers: receivers.map((receiver, index) => normalizePerson(receiver, `threadSummary.receivers[${index}]`)),
		lastUpdated,
		subject,
		snippet,
		messageIds: [...messageIds],
		labelIds: [...labelIds],
		visibility,
		isWhenIHaveTime,
		totalTimeToReadSeconds,
		recentMessageReadTimeSeconds,
	};
}

export function normalizeThreadMessageDto(value: unknown): ThreadMessageDto {
	assertObject(value, 'threadMessage');
	const deleted = value['deleted'];
	if (typeof deleted !== 'boolean') {
		throw makeValidationError('threadMessage.deleted must be a boolean');
	}
	const messageId = value['messageId'];
	assertString(messageId, 'threadMessage.messageId');
	const from = value['from'];
	assertArray(from, 'threadMessage.from');
	const to = value['to'];
	assertArray(to, 'threadMessage.to');
	const date = value['date'];
	assertNumber(date, 'threadMessage.date');
	const body = value['body'];
	assertObject(body, 'threadMessage.body');
	const bodyOriginal = body['original'];
	assertString(bodyOriginal, 'threadMessage.body.original');
	const bodySanitized = body['sanitized'];
	assertString(bodySanitized, 'threadMessage.body.sanitized');
	const bodyPlainText = body['plainText'];
	assertString(bodyPlainText, 'threadMessage.body.plainText');
	const wordcount = value['wordcount'];
	assertNumber(wordcount, 'threadMessage.wordcount');
	const timeToReadSeconds = value['timeToReadSeconds'];
	assertNumber(timeToReadSeconds, 'threadMessage.timeToReadSeconds');
	const attachments = value['attachments'];
	assertArray(attachments, 'threadMessage.attachments');
	return {
		deleted,
		messageId,
		from: from.map((person, index) => {
			if (person === null) {
				return null;
			}
			return normalizePerson(person, `threadMessage.from[${index}]`);
		}),
		to: to.map((person, index) => normalizePerson(person, `threadMessage.to[${index}]`)),
		date,
		body: {
			original: bodyOriginal,
			sanitized: bodySanitized,
			plainText: bodyPlainText,
		},
		wordcount,
		timeToReadSeconds,
		attachments: attachments.map((attachment, index) => {
			assertObject(attachment, `threadMessage.attachments[${index}]`);
			const filename = attachment['filename'];
			const size = attachment['size'];
			const attachmentId = attachment['attachmentId'];
			assertString(filename, `threadMessage.attachments[${index}].filename`);
			assertNumber(size, `threadMessage.attachments[${index}].size`);
			assertString(attachmentId, `threadMessage.attachments[${index}].attachmentId`);
			return {
				filename,
				size,
				attachmentId,
			};
		}),
	};
}

export function normalizeHideUntilDto(value: unknown): HideUntilDto {
	assertObject(value, 'hideUntil');
	const type = value['type'];
	assertString(type, 'hideUntil.type');
	switch (type) {
		case 'timestamp': {
			const timestamp = Number(value['value']);
			if (Number.isNaN(timestamp)) {
				throw makeValidationError('hideUntil.value must be numeric for timestamp hideUntil');
			}
			return {
				type: 'timestamp',
				value: timestamp,
			};
		}
		case 'when-i-have-time':
			return {type: 'when-i-have-time'};
		default:
			throw makeValidationError('hideUntil.type is invalid');
	}
}

export function normalizeWordcountUpdateDto(value: unknown): WordcountUpdateDto {
	assertObject(value, 'wordcountUpdate');
	const wordcount = Number(value['wordcount']);
	if (Number.isNaN(wordcount)) {
		throw makeValidationError('wordcountUpdate.wordcount must be numeric');
	}
	return {wordcount};
}

export function normalizeGmailMoveThreadDto(value: unknown): GmailMoveThreadDto {
	assertObject(value, 'gmailMoveThread');
	const labelId = value['labelId'];
	assertString(labelId, 'gmailMoveThread.labelId');
	if (labelId.length === 0) {
		throw makeValidationError('gmailMoveThread.labelId is required');
	}
	return {
		labelId,
	};
}

export function normalizeGmailSendMessageDto(value: unknown): GmailSendMessageDto {
	assertObject(value, 'gmailSendMessage');
	const threadId = value['threadId'];
	const raw = value['raw'];
	assertString(threadId, 'gmailSendMessage.threadId');
	assertString(raw, 'gmailSendMessage.raw');
	if (threadId.length === 0) {
		throw makeValidationError('gmailSendMessage.threadId is required');
	}
	if (raw.length === 0) {
		throw makeValidationError('gmailSendMessage.raw is required');
	}
	return {
		threadId,
		raw,
	};
}

export function normalizeRfc2822RequestDto(value: unknown): Rfc2822RequestDto {
	assertObject(value, 'rfc2822Request');
	const threadId = value['threadId'];
	const body = value['body'];
	const inReplyTo = value['inReplyTo'];
	const myEmail = value['myEmail'];
	assertString(threadId, 'rfc2822Request.threadId');
	assertString(body, 'rfc2822Request.body');
	assertString(inReplyTo, 'rfc2822Request.inReplyTo');
	assertString(myEmail, 'rfc2822Request.myEmail');
	const normalized = {
		threadId,
		body,
		inReplyTo,
		myEmail,
	};
	Object.entries(normalized).forEach(([key, fieldValue]) => {
		if (fieldValue.length === 0) {
			throw makeValidationError(`rfc2822Request.${key} is required`);
		}
	});
	return normalized;
}

export {makeValidationError};
