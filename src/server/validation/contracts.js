function makeValidationError(message) {
	const error = new Error(message);
	error.code = 'INVALID_CONTRACT';
	return error;
}

function assertObject(value, name) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw makeValidationError(`${name} must be an object`);
	}
}

function assertArray(value, name) {
	if (!Array.isArray(value)) {
		throw makeValidationError(`${name} must be an array`);
	}
}

function assertString(value, name) {
	if (typeof value !== 'string') {
		throw makeValidationError(`${name} must be a string`);
	}
}

function assertOptionalString(value, name) {
	if (value !== undefined && value !== null && typeof value !== 'string') {
		throw makeValidationError(`${name} must be a string when provided`);
	}
}

function assertNumber(value, name) {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		throw makeValidationError(`${name} must be a number`);
	}
}

function assertOneOf(value, allowedValues, name) {
	if (!allowedValues.includes(value)) {
		throw makeValidationError(`${name} is invalid`);
	}
}

function normalizeGroupingCondition(condition, index) {
	assertObject(condition, `rules[${index}] condition`);
	assertString(condition.type, `rules[${index}] condition.type`);
	assertString(condition.value, `rules[${index}] condition.value`);
	if (!['sender_name', 'sender_email', 'subject'].includes(condition.type)) {
		throw makeValidationError(`rules[${index}] condition.type is invalid`);
	}
	return {
		type: condition.type,
		value: condition.value,
	};
}

function normalizeGroupingRule(rule, index) {
	assertObject(rule, `rules[${index}]`);
	assertString(rule.name, `rules[${index}].name`);
	assertArray(rule.conditions, `rules[${index}].conditions`);
	const priority = rule.priority === undefined ? 50 : Number(rule.priority);
	if (Number.isNaN(priority)) {
		throw makeValidationError(`rules[${index}].priority must be numeric`);
	}
	const sortType = rule.sortType === 'shortest' ? 'shortest' : 'mostRecent';
	return {
		name: rule.name,
		priority,
		sortType,
		conditions: rule.conditions.map((condition) => normalizeGroupingCondition(condition, index)),
	};
}

export function normalizeGroupingRulesConfig(value) {
	if (value === undefined || value === null) {
		return {rules: []};
	}
	assertObject(value, 'emailGroupingRules');
	const rawRules = value.rules === undefined ? [] : value.rules;
	assertArray(rawRules, 'emailGroupingRules.rules');
	return {
		rules: rawRules.map((rule, index) => normalizeGroupingRule(rule, index)),
	};
}

function normalizeGoogleOAuthConfig(value) {
	if (value === undefined || value === null) {
		return {};
	}
	assertObject(value, 'googleOAuth');
	const normalized = {...value};
	assertOptionalString(normalized.clientId, 'googleOAuth.clientId');
	assertOptionalString(normalized.clientSecret, 'googleOAuth.clientSecret');
	assertOptionalString(normalized.redirectUri, 'googleOAuth.redirectUri');
	assertOptionalString(normalized.accessToken, 'googleOAuth.accessToken');
	assertOptionalString(normalized.accessTokenExpiresAt, 'googleOAuth.accessTokenExpiresAt');
	assertOptionalString(normalized.refreshToken, 'googleOAuth.refreshToken');
	assertOptionalString(normalized.scope, 'googleOAuth.scope');
	assertOptionalString(normalized.connectedEmailAddress, 'googleOAuth.connectedEmailAddress');
	return normalized;
}

export function normalizeAppConfig(value) {
	if (value === undefined || value === null) {
		return {
			googleOAuth: {},
			emailGroupingRules: {rules: []},
		};
	}
	assertObject(value, 'config');
	const normalized = {...value};
	if (normalized.port !== undefined) {
		assertNumber(normalized.port, 'config.port');
	}
	assertOptionalString(normalized.clientId, 'config.clientId');
	normalized.googleOAuth = normalizeGoogleOAuthConfig(normalized.googleOAuth);
	normalized.emailGroupingRules = normalizeGroupingRulesConfig(normalized.emailGroupingRules);
	return normalized;
}

export function normalizeGoogleOAuthSetupDto(value, defaultRedirectUri) {
	assertObject(value, 'googleOAuthSetup');
	const clientId = typeof value.clientId === 'string' ? value.clientId.trim() : '';
	const clientSecret = typeof value.clientSecret === 'string' ? value.clientSecret.trim() : '';
	const fallbackRedirectUri = typeof defaultRedirectUri === 'string' ? defaultRedirectUri : '';
	const redirectUri = typeof value.redirectUri === 'string'
		? value.redirectUri.trim()
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

function normalizePersistedMessage(message, index) {
	assertObject(message, `thread.messages[${index}]`);
	assertString(message.id, `thread.messages[${index}].id`);
	if (message.threadId !== undefined) {
		assertOptionalString(message.threadId, `thread.messages[${index}].threadId`);
	}
	assertArray(message.labelIds, `thread.messages[${index}].labelIds`);
	if (!(typeof message.internalDate === 'string' || typeof message.internalDate === 'number')) {
		throw makeValidationError(`thread.messages[${index}].internalDate must be a string or number`);
	}
	assertObject(message.payload, `thread.messages[${index}].payload`);
	assertArray(message.payload.headers, `thread.messages[${index}].payload.headers`);
	return message;
}

export function validatePersistedThread(value) {
	assertObject(value, 'thread');
	assertString(value.id, 'thread.id');
	assertArray(value.messages, 'thread.messages');
	value.messages.forEach((message, index) => normalizePersistedMessage(message, index));
	return value;
}

export function validateThreadPayload(value) {
	return validatePersistedThread(value);
}

function normalizePerson(value, name) {
	assertObject(value, name);
	assertString(value.name, `${name}.name`);
	assertString(value.email, `${name}.email`);
	return {
		name: value.name,
		email: value.email,
	};
}

export function normalizeThreadSummaryDto(value) {
	assertObject(value, 'threadSummary');
	assertString(value.threadId, 'threadSummary.threadId');
	assertArray(value.senders, 'threadSummary.senders');
	assertArray(value.receivers, 'threadSummary.receivers');
	assertNumber(value.lastUpdated, 'threadSummary.lastUpdated');
	assertString(value.subject, 'threadSummary.subject');
	if (value.snippet !== null) {
		assertString(value.snippet, 'threadSummary.snippet');
	}
	assertArray(value.messageIds, 'threadSummary.messageIds');
	value.messageIds.forEach((messageId, index) => assertString(messageId, `threadSummary.messageIds[${index}]`));
	assertArray(value.labelIds, 'threadSummary.labelIds');
	value.labelIds.forEach((labelId, index) => assertString(labelId, `threadSummary.labelIds[${index}]`));
	assertString(value.visibility, 'threadSummary.visibility');
	assertOneOf(value.visibility, ['updated', 'visible', 'when-i-have-time', 'hidden', 'stale'], 'threadSummary.visibility');
	if (typeof value.isWhenIHaveTime !== 'boolean') {
		throw makeValidationError('threadSummary.isWhenIHaveTime must be a boolean');
	}
	if (typeof value.needsRefreshing !== 'boolean') {
		throw makeValidationError('threadSummary.needsRefreshing must be a boolean');
	}
	assertNumber(value.totalTimeToReadSeconds, 'threadSummary.totalTimeToReadSeconds');
	assertNumber(value.recentMessageReadTimeSeconds, 'threadSummary.recentMessageReadTimeSeconds');
	return {
		threadId: value.threadId,
		senders: value.senders.map((sender, index) => normalizePerson(sender, `threadSummary.senders[${index}]`)),
		receivers: value.receivers.map((receiver, index) => normalizePerson(receiver, `threadSummary.receivers[${index}]`)),
		lastUpdated: value.lastUpdated,
		subject: value.subject,
		snippet: value.snippet,
		messageIds: [...value.messageIds],
		labelIds: [...value.labelIds],
		visibility: value.visibility,
		isWhenIHaveTime: value.isWhenIHaveTime,
		needsRefreshing: value.needsRefreshing,
		totalTimeToReadSeconds: value.totalTimeToReadSeconds,
		recentMessageReadTimeSeconds: value.recentMessageReadTimeSeconds,
	};
}

export function normalizeThreadMessageDto(value) {
	assertObject(value, 'threadMessage');
	if (typeof value.deleted !== 'boolean') {
		throw makeValidationError('threadMessage.deleted must be a boolean');
	}
	assertString(value.messageId, 'threadMessage.messageId');
	assertArray(value.from, 'threadMessage.from');
	assertArray(value.to, 'threadMessage.to');
	assertNumber(value.date, 'threadMessage.date');
	assertObject(value.body, 'threadMessage.body');
	assertString(value.body.original, 'threadMessage.body.original');
	assertString(value.body.sanitized, 'threadMessage.body.sanitized');
	assertString(value.body.plainText, 'threadMessage.body.plainText');
	assertNumber(value.wordcount, 'threadMessage.wordcount');
	assertNumber(value.timeToReadSeconds, 'threadMessage.timeToReadSeconds');
	assertArray(value.attachments, 'threadMessage.attachments');
	return {
		deleted: value.deleted,
		messageId: value.messageId,
		from: value.from.map((person, index) => {
			if (person === null) {
				return null;
			}
			return normalizePerson(person, `threadMessage.from[${index}]`);
		}),
		to: value.to.map((person, index) => normalizePerson(person, `threadMessage.to[${index}]`)),
		date: value.date,
		body: {
			original: value.body.original,
			sanitized: value.body.sanitized,
			plainText: value.body.plainText,
		},
		wordcount: value.wordcount,
		timeToReadSeconds: value.timeToReadSeconds,
		attachments: value.attachments.map((attachment, index) => {
			assertObject(attachment, `threadMessage.attachments[${index}]`);
			assertString(attachment.filename, `threadMessage.attachments[${index}].filename`);
			assertNumber(attachment.size, `threadMessage.attachments[${index}].size`);
			assertString(attachment.attachmentId, `threadMessage.attachments[${index}].attachmentId`);
			return {
				filename: attachment.filename,
				size: attachment.size,
				attachmentId: attachment.attachmentId,
			};
		}),
	};
}

export function normalizeHideUntilDto(value) {
	assertObject(value, 'hideUntil');
	assertString(value.type, 'hideUntil.type');
	switch (value.type) {
		case 'timestamp': {
			const timestamp = Number(value.value);
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

export function normalizeWordcountUpdateDto(value) {
	assertObject(value, 'wordcountUpdate');
	const wordcount = Number(value.wordcount);
	if (Number.isNaN(wordcount)) {
		throw makeValidationError('wordcountUpdate.wordcount must be numeric');
	}
	return {wordcount};
}

export function normalizeGmailMoveThreadDto(value) {
	assertObject(value, 'gmailMoveThread');
	assertString(value.labelId, 'gmailMoveThread.labelId');
	if (value.labelId.length === 0) {
		throw makeValidationError('gmailMoveThread.labelId is required');
	}
	return {
		labelId: value.labelId,
	};
}

export function normalizeGmailSendMessageDto(value) {
	assertObject(value, 'gmailSendMessage');
	assertString(value.threadId, 'gmailSendMessage.threadId');
	assertString(value.raw, 'gmailSendMessage.raw');
	if (value.threadId.length === 0) {
		throw makeValidationError('gmailSendMessage.threadId is required');
	}
	if (value.raw.length === 0) {
		throw makeValidationError('gmailSendMessage.raw is required');
	}
	return {
		threadId: value.threadId,
		raw: value.raw,
	};
}

export function normalizeRfc2822RequestDto(value) {
	assertObject(value, 'rfc2822Request');
	assertString(value.threadId, 'rfc2822Request.threadId');
	assertString(value.body, 'rfc2822Request.body');
	assertString(value.inReplyTo, 'rfc2822Request.inReplyTo');
	assertString(value.myEmail, 'rfc2822Request.myEmail');
	const normalized = {
		threadId: value.threadId,
		body: value.body,
		inReplyTo: value.inReplyTo,
		myEmail: value.myEmail,
	};
	Object.entries(normalized).forEach(([key, fieldValue]) => {
		if (fieldValue.length === 0) {
			throw makeValidationError(`rfc2822Request.${key} is required`);
		}
	});
	return normalized;
}

export { makeValidationError };
