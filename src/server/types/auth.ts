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

export interface GmailMoveThreadDto {
	labelId: string;
}

export interface GmailSendMessageDto {
	threadId: string;
	raw: string;
}

export interface Rfc2822RequestDto {
	threadId: string;
	body: string;
	inReplyTo: string;
	myEmail: string;
}
