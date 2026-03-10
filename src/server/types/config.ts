import type { GoogleOAuthConfig } from './auth';
import type { GroupingRulesConfig } from './grouping_rules';

export interface AppConfig {
	port?: number;
	clientId?: string;
	googleOAuth?: GoogleOAuthConfig;
	emailGroupingRules?: GroupingRulesConfig;
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
