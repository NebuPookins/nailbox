import type { AppConfig } from '../src/server/types/config.js';
import type { GoogleOAuthConfig, GoogleAuthStatusDto } from '../src/server/types/auth.js';

const GOOGLE_ACCOUNTS_BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

export interface GmailApiRequestOptions {
	path: string;
	method?: string;
	query?: Record<string, string | string[] | number | boolean | null | undefined>;
	headers?: Record<string, string>;
	json?: unknown;
}

export interface GmailApiResult {
	/** Parsed response body. Callers should validate or cast this before accessing fields. */
	data: unknown;
	didUpdateCredentials: boolean;
}

interface TokenResponse {
	access_token: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
	token_type?: string;
}

class HttpError extends Error {
	readonly status: number;
	readonly responseBody: unknown;
	code?: string;

	constructor(message: string, status: number, responseBody: unknown) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
		this.responseBody = responseBody;
	}
}

function getGoogleOAuthConfig(config: AppConfig): GoogleOAuthConfig {
	let googleOAuth = config.googleOAuth;
	if (typeof googleOAuth !== 'object' || googleOAuth === null) {
		googleOAuth = {};
		config.googleOAuth = googleOAuth;
	}
	if (!googleOAuth.clientId && typeof config.clientId === 'string') {
		googleOAuth.clientId = config.clientId;
	}
	return googleOAuth;
}

function isGoogleOAuthConfigured(config: AppConfig): boolean {
	const googleOAuth = getGoogleOAuthConfig(config);
	return (['clientId', 'clientSecret', 'redirectUri'] as const).every((fieldName) => {
		return typeof googleOAuth[fieldName] === 'string' && (googleOAuth[fieldName] as string).trim().length > 0;
	});
}

function getGoogleAuthStatus(config: AppConfig): GoogleAuthStatusDto {
	const googleOAuth = getGoogleOAuthConfig(config);
	return {
		configured: isGoogleOAuthConfigured(config),
		connected: typeof googleOAuth.refreshToken === 'string' && googleOAuth.refreshToken.length > 0,
		emailAddress: googleOAuth.connectedEmailAddress ?? null,
		scopes: googleOAuth.scope ? googleOAuth.scope.split(' ') : [],
	};
}

function clearGoogleTokens(config: AppConfig): void {
	const googleOAuth = getGoogleOAuthConfig(config);
	delete googleOAuth.refreshToken;
	delete googleOAuth.accessToken;
	delete googleOAuth.accessTokenExpiresAt;
	delete googleOAuth.scope;
	delete googleOAuth.connectedEmailAddress;
}

function getAuthorizationUrl(config: AppConfig, state: string, prompt?: string): string {
	const googleOAuth = getGoogleOAuthConfig(config);
	const params: Record<string, string> = {
		client_id: googleOAuth.clientId ?? '',
		redirect_uri: googleOAuth.redirectUri ?? '',
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

async function fetchJson(url: string | URL, options: RequestInit): Promise<unknown> {
	const response = await fetch(url, options);
	const responseText = await response.text();
	let parsedBody: unknown = null;
	if (responseText.length > 0) {
		try {
			parsedBody = JSON.parse(responseText);
		} catch {
			parsedBody = responseText;
		}
	}
	if (!response.ok) {
		throw new HttpError(`Request failed with HTTP ${response.status}`, response.status, parsedBody);
	}
	return parsedBody;
}

async function exchangeCodeForTokens(config: AppConfig, code: string): Promise<TokenResponse> {
	const googleOAuth = getGoogleOAuthConfig(config);
	return fetchJson(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			code: code,
			client_id: googleOAuth.clientId ?? '',
			client_secret: googleOAuth.clientSecret ?? '',
			redirect_uri: googleOAuth.redirectUri ?? '',
			grant_type: 'authorization_code',
		}),
	}) as Promise<TokenResponse>;
}

function accessTokenNeedsRefresh(googleOAuth: GoogleOAuthConfig): boolean {
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

async function refreshAccessToken(config: AppConfig): Promise<TokenResponse> {
	const googleOAuth = getGoogleOAuthConfig(config);
	if (typeof googleOAuth.refreshToken !== 'string' || googleOAuth.refreshToken.length === 0) {
		const error = new HttpError('Missing refresh token', 401, null);
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
				client_id: googleOAuth.clientId ?? '',
				client_secret: googleOAuth.clientSecret ?? '',
				refresh_token: googleOAuth.refreshToken,
				grant_type: 'refresh_token',
			}),
		}) as Promise<TokenResponse>;
	} catch (error) {
		if (error instanceof HttpError) {
			const body = error.responseBody;
			if (typeof body === 'object' && body !== null && (body as Record<string, unknown>).error === 'invalid_grant') {
				error.code = 'GOOGLE_REAUTH_REQUIRED';
			}
		}
		throw error;
	}
}

async function ensureValidAccessToken(config: AppConfig): Promise<{accessToken: string; didUpdateCredentials: boolean}> {
	const googleOAuth = getGoogleOAuthConfig(config);
	let didUpdateCredentials = false;
	if (accessTokenNeedsRefresh(googleOAuth)) {
		const refreshedToken = await refreshAccessToken(config);
		googleOAuth.accessToken = refreshedToken.access_token;
		googleOAuth.accessTokenExpiresAt = new Date(Date.now() + ((refreshedToken.expires_in ?? 3600) * 1000)).toISOString();
		if (typeof refreshedToken.refresh_token === 'string' && refreshedToken.refresh_token.length > 0) {
			googleOAuth.refreshToken = refreshedToken.refresh_token;
		}
		if (typeof refreshedToken.scope === 'string' && refreshedToken.scope.length > 0) {
			googleOAuth.scope = refreshedToken.scope;
		}
		didUpdateCredentials = true;
	}
	return {
		accessToken: googleOAuth.accessToken ?? '',
		didUpdateCredentials,
	};
}

async function gmailApiRequest(config: AppConfig, options: GmailApiRequestOptions): Promise<GmailApiResult> {
	const tokenInfo = await ensureValidAccessToken(config);
	const url = new URL(`${GMAIL_API_BASE_URL}${options.path}`);
	if (options.query) {
		for (const [key, value] of Object.entries(options.query)) {
			if (Array.isArray(value)) {
				for (const item of value) {
					url.searchParams.append(key, String(item));
				}
			} else if (value !== undefined && value !== null) {
				url.searchParams.set(key, String(value));
			}
		}
	}
	const response = await fetch(url, {
		method: options.method ?? 'GET',
		headers: {
			'Authorization': `Bearer ${tokenInfo.accessToken}`,
			'Content-Type': 'application/json',
			...options.headers,
		},
		body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
	});
	const responseText = await response.text();
	let parsedBody: unknown = null;
	if (responseText.length > 0) {
		try {
			parsedBody = JSON.parse(responseText);
		} catch {
			parsedBody = responseText;
		}
	}
	if (!response.ok) {
		throw new HttpError(`Gmail API request failed with HTTP ${response.status}`, response.status, parsedBody);
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
