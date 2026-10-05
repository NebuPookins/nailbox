import type { GoogleOAuthConfig } from './auth.js';
import type { GroupingRulesConfig } from './grouping_rules.js';

export const RENDER_MODES = ['original', 'reader', 'plain'] as const;

/** How a message body is shown: as sent, as a distraction-free article, or as plain text. */
export type RenderMode = typeof RENDER_MODES[number];

/** The preferred render mode per sender, keyed by lower-cased email address. */
export type SenderRenderModes = Readonly<Record<string, RenderMode>>;

/** The key a sender's render mode is stored under, shared by client and server so they agree. */
export function senderKeyFor(email: string): string {
	return email.trim().toLowerCase();
}

/** Lower-cased sender addresses whose remote images load without asking (when Gmail verifies the sender). */
export type TrustedImageSenders = ReadonlyArray<string>;

export interface TrustedImageSenderDto {
	senderEmail: string;
}

export interface SenderRenderModeDto {
	senderEmail: string;
	mode: RenderMode;
}

export interface AppConfig {
	port?: number;
	clientId?: string;
	googleOAuth?: GoogleOAuthConfig;
	emailGroupingRules?: GroupingRulesConfig;
	senderRenderModes?: SenderRenderModes;
	trustedImageSenders?: TrustedImageSenders;
}

export interface GoogleOAuthSetupDto {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export interface ConfigRepository {
	readConfig(): Promise<AppConfig>;
	saveConfig(config: AppConfig): Promise<AppConfig>;
}
