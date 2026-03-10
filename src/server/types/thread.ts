export interface PersonDto {
	name: string;
	email: string;
}

export interface PersistedMessage {
	id: string;
	threadId?: string;
	labelIds: string[];
	internalDate: string | number;
	snippet?: string;
	payload: {
		headers: Array<{name: string; value: string}>;
		mimeType?: string;
		body?: Record<string, unknown>;
		parts?: unknown[];
	};
	calculatedWordCount?: number;
	calculatedTimeToReadSeconds?: number;
	fullBodyWordCount?: number;
}

export interface PersistedThread {
	id: string;
	messages: PersistedMessage[];
}

export interface ThreadSummaryDto {
	threadId: string;
	senders: PersonDto[];
	receivers: PersonDto[];
	lastUpdated: number;
	subject: string;
	snippet: string | null;
	messageIds: string[];
	labelIds: string[];
	visibility: 'updated' | 'visible' | 'when-i-have-time' | 'hidden' | 'stale';
	isWhenIHaveTime: boolean;
	needsRefreshing: boolean;
	totalTimeToReadSeconds: number;
	recentMessageReadTimeSeconds: number;
}

export interface ThreadMessageDto {
	deleted: boolean;
	messageId: string;
	from: Array<PersonDto | null>;
	to: PersonDto[];
	date: number;
	body: {
		original: string;
		sanitized: string;
		plainText: string;
	};
	wordcount: number;
	timeToReadSeconds: number;
	attachments: Array<{
		filename: string;
		size: number;
		attachmentId: string;
	}>;
}
