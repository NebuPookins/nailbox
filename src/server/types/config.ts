import type { GoogleOAuthConfig } from './auth';
import type { GroupingRulesConfig } from './grouping_rules';

export interface AppConfig {
	port?: number;
	clientId?: string;
	googleOAuth?: GoogleOAuthConfig;
	emailGroupingRules?: GroupingRulesConfig;
}
