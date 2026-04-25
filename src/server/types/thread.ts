export interface PersonDto {
	name: string;
	email?: string;
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
		body?: {data?: string; size?: number};
		parts?: Array<{mimeType?: string; filename?: string; body?: {data?: string; size?: number}; parts?: unknown[]}>;
	};
	calculatedWordCount?: number;
	calculatedTimeToReadSeconds?: number;
	fullBodyWordCount?: number;
}

export interface PersistedThread {
	id: string;
	messages: PersistedMessage[];
}

export interface HideUntilRequestDto {
	type: 'timestamp';
	value: number;
}

export interface WhenIHaveTimeRequestDto {
	type: 'when-i-have-time';
}

export type HideUntilDto = HideUntilRequestDto | WhenIHaveTimeRequestDto;

export interface WordcountUpdateDto {
	wordcount: number;
}

export interface ThreadSummaryDto {
	type: 'thread';
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

export interface BundleSummaryDto {
	type: 'bundle';
	bundleId: string;
	threadIds: string[];
	senders: PersonDto[];
	lastUpdated: number;
	subject: string;
	snippet: string | null;
	visibility: ThreadSummaryDto['visibility'];
	isWhenIHaveTime: boolean;
	threadCount: number;
	memberThreads: ThreadSummaryDto[];
	totalTimeToReadSeconds: number;
	recentMessageReadTimeSeconds: number;
}

export type ThreadRowItem = ThreadSummaryDto | BundleSummaryDto;

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

export interface ThreadGroupDto {
	label: string;
	threads: ThreadSummaryDto[];
	items: ThreadRowItem[];
	sortType: 'mostRecent' | 'shortest';
}

export interface ThreadModelLike {
	_data: PersistedThread;
	id(): string;
	snippet(): string;
	messages(): Array<{
		getBestReadTimeSeconds(): number;
		getInternalDate(): string | number;
	}>;
	senders(): PersonDto[];
	recipients(): PersonDto[];
	lastUpdated(): number;
	subject(): string;
	messageIds(): string[];
	labelIds(): string[];
	message(messageId: string): {
		_data: PersistedMessage;
	} | null;
}

export interface ThreadRepository {
	deleteThread(threadId: string): Promise<boolean>;
	listThreadIds(): Promise<string[]>;
	readThread(threadId: string): Promise<ThreadModelLike>;
	readThreadJson(threadId: string): Promise<Partial<PersistedThread>>;
	saveThreadJson(threadId: string, threadPayload: PersistedThread): Promise<void>;
}
