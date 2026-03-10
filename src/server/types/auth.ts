export interface GoogleOAuthConfig {
	clientId?: string;
	clientSecret?: string;
	redirectUri?: string;
	accessToken?: string;
	accessTokenExpiresAt?: string;
	refreshToken?: string;
	scope?: string;
	connectedEmailAddress?: string;
}

export interface GoogleAuthStatusDto {
	configured: boolean;
	connected: boolean;
	emailAddress: string | null;
	scopes: string[];
}
