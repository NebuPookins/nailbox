import type { PersonDto } from '../server/types/thread.js';

type Visibility = 'updated' | 'visible' | 'when-i-have-time' | 'stale' | 'hidden';
export type SortType = 'mostRecent' | 'shortest';
export type ConditionType = 'sender_name' | 'sender_email' | 'subject';

export const CONDITION_TYPE_CONTAINS_LABELS: Record<ConditionType, string> = {
	sender_name: 'Sender name contains',
	sender_email: 'Sender email contains',
	subject: 'Subject contains',
};

interface Person {
	name: string;
	email: string;
}

export interface ThreadSummary {
	type?: 'thread';
	threadId: string;
	senders: Person[];
	receivers: Person[];
	lastUpdated: number;
	subject: string;
	snippet: string | null;
	messageIds: string[];
	labelIds: string[];
	visibility: Visibility;
	totalTimeToReadSeconds: number;
	recentMessageReadTimeSeconds: number;
}

export interface BundleSummary {
	type: 'bundle';
	bundleId: string;
	threadIds: string[];
	senders: Person[];
	lastUpdated: number;
	subject?: string;
	snippet?: string | null;
	visibility: Visibility;
	threadCount: number;
	memberThreads?: ThreadSummary[];
	totalTimeToReadSeconds: number;
	recentMessageReadTimeSeconds: number;
}

export type ThreadRowItem = ThreadSummary | BundleSummary;

/** What the thread list hands to the thread viewer when a row is opened. */
export interface ThreadOpenPayload {
	threadId: string;
	subject: string;
	snippet: string;
	senders: PersonDto[];
	receivers: PersonDto[];
}

export interface ThreadGroup {
	label: string;
	items: ThreadRowItem[];
	sortType?: SortType;
}

export interface GroupingCondition {
	type: ConditionType;
	value: string;
}

export interface GroupingRule {
	name: string;
	priority: number;
	sortType: SortType;
	conditions: GroupingCondition[];
}

export interface GroupingRulesConfig {
	rules: GroupingRule[];
}
