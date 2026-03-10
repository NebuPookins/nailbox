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

export { makeValidationError };
