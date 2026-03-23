// @ts-nocheck
const GOOGLE_ACCOUNTS_BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

function getGoogleOAuthConfig(config) {
	if (!config.googleOAuth || typeof config.googleOAuth !== 'object') {
		config.googleOAuth = {};
	}
	if (!config.googleOAuth.clientId && typeof config.clientId === 'string') {
		config.googleOAuth.clientId = config.clientId;
	}
	return config.googleOAuth;
}

function isGoogleOAuthConfigured(config) {
	const googleOAuth = getGoogleOAuthConfig(config);
	return ['clientId', 'clientSecret', 'redirectUri'].every((fieldName) => {
		return typeof googleOAuth[fieldName] === 'string' && googleOAuth[fieldName].trim().length > 0;
	});
}

function getGoogleAuthStatus(config) {
	const googleOAuth = getGoogleOAuthConfig(config);
	return {
		configured: isGoogleOAuthConfigured(config),
		connected: typeof googleOAuth.refreshToken === 'string' && googleOAuth.refreshToken.length > 0,
		emailAddress: googleOAuth.connectedEmailAddress || null,
		scopes: googleOAuth.scope ? googleOAuth.scope.split(' ') : [],
	};
}

function clearGoogleTokens(config) {
	const googleOAuth = getGoogleOAuthConfig(config);
	delete googleOAuth.refreshToken;
	delete googleOAuth.accessToken;
	delete googleOAuth.accessTokenExpiresAt;
	delete googleOAuth.scope;
	delete googleOAuth.connectedEmailAddress;
}

function getAuthorizationUrl(config, state, prompt = 'consent') {
	const googleOAuth = getGoogleOAuthConfig(config);
	const params = {
		client_id: googleOAuth.clientId,
		redirect_uri: googleOAuth.redirectUri,
		response_type: 'code',
		scope: GOOGLE_SCOPE,
		access_type: 'offline',
		include_granted_scopes: 'true',
		state: state,
	};
	if (typeof prompt === 'string' && prompt.length > 0) {
		params.prompt = prompt;
	}
	const url = new URL(GOOGLE_ACCOUNTS_BASE_URL);
	url.search = new URLSearchParams(params).toString();
	return url.toString();
}

async function fetchJson(url, options) {
	const response = await fetch(url, options);
	const responseText = await response.text();
	let parsedBody = null;
	if (responseText.length > 0) {
		try {
			parsedBody = JSON.parse(responseText);
		} catch (err) {
			parsedBody = responseText;
		}
	}
	if (!response.ok) {
		const error = new Error(`Request failed with HTTP ${response.status}`);
		error.status = response.status;
		error.responseBody = parsedBody;
		throw error;
	}
	return parsedBody;
}

async function exchangeCodeForTokens(config, code) {
	const googleOAuth = getGoogleOAuthConfig(config);
	return fetchJson(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			code: code,
			client_id: googleOAuth.clientId,
			client_secret: googleOAuth.clientSecret,
			redirect_uri: googleOAuth.redirectUri,
			grant_type: 'authorization_code',
		}),
	});
}

function accessTokenNeedsRefresh(googleOAuth) {
	if (typeof googleOAuth.accessToken !== 'string' || googleOAuth.accessToken.length === 0) {
		return true;
	}
	if (typeof googleOAuth.accessTokenExpiresAt !== 'string') {
		return true;
	}
	const expiresAt = Date.parse(googleOAuth.accessTokenExpiresAt);
	if (Number.isNaN(expiresAt)) {
		return true;
	}
	return Date.now() >= expiresAt - (60 * 1000);
}

async function refreshAccessToken(config) {
	const googleOAuth = getGoogleOAuthConfig(config);
	if (typeof googleOAuth.refreshToken !== 'string' || googleOAuth.refreshToken.length === 0) {
		const error = new Error('Missing refresh token');
		error.code = 'GOOGLE_REAUTH_REQUIRED';
		throw error;
	}
	try {
		return await fetchJson(GOOGLE_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: googleOAuth.clientId,
				client_secret: googleOAuth.clientSecret,
				refresh_token: googleOAuth.refreshToken,
				grant_type: 'refresh_token',
			}),
		});
	} catch (error) {
		if (error.responseBody && error.responseBody.error === 'invalid_grant') {
			error.code = 'GOOGLE_REAUTH_REQUIRED';
		}
		throw error;
	}
}

async function ensureValidAccessToken(config) {
	const googleOAuth = getGoogleOAuthConfig(config);
	let didUpdateCredentials = false;
	if (accessTokenNeedsRefresh(googleOAuth)) {
		const refreshedToken = await refreshAccessToken(config);
		googleOAuth.accessToken = refreshedToken.access_token;
		googleOAuth.accessTokenExpiresAt = new Date(Date.now() + ((refreshedToken.expires_in || 3600) * 1000)).toISOString();
		if (typeof refreshedToken.refresh_token === 'string' && refreshedToken.refresh_token.length > 0) {
			googleOAuth.refreshToken = refreshedToken.refresh_token;
		}
		if (typeof refreshedToken.scope === 'string' && refreshedToken.scope.length > 0) {
			googleOAuth.scope = refreshedToken.scope;
		}
		didUpdateCredentials = true;
	}
	return {
		accessToken: googleOAuth.accessToken,
		didUpdateCredentials: didUpdateCredentials,
	};
}

async function gmailApiRequest(config, options) {
	const tokenInfo = await ensureValidAccessToken(config);
	const url = new URL(`${GMAIL_API_BASE_URL}${options.path}`);
	if (options.query) {
		Object.keys(options.query).forEach((key) => {
			const value = options.query[key];
			if (Array.isArray(value)) {
				value.forEach((item) => url.searchParams.append(key, item));
			} else if (value !== undefined && value !== null) {
				url.searchParams.set(key, value);
			}
		});
	}
	const response = await fetch(url, {
		method: options.method || 'GET',
		headers: Object.assign({
			'Authorization': `Bearer ${tokenInfo.accessToken}`,
			'Content-Type': 'application/json',
		}, options.headers || {}),
		body: options.json ? JSON.stringify(options.json) : undefined,
	});
	const responseText = await response.text();
	let parsedBody = null;
	if (responseText.length > 0) {
		try {
			parsedBody = JSON.parse(responseText);
		} catch (err) {
			parsedBody = responseText;
		}
	}
	if (!response.ok) {
		const error = new Error(`Gmail API request failed with HTTP ${response.status}`);
		error.status = response.status;
		error.responseBody = parsedBody;
		throw error;
	}
	return {
		data: parsedBody,
		didUpdateCredentials: tokenInfo.didUpdateCredentials,
	};
}

export {
	GOOGLE_SCOPE,
	clearGoogleTokens,
	ensureValidAccessToken,
	exchangeCodeForTokens,
	getAuthorizationUrl,
	getGoogleAuthStatus,
	getGoogleOAuthConfig,
	gmailApiRequest,
	isGoogleOAuthConfigured,
};
