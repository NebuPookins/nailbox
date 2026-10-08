export interface PersonDto {
	name: string;
	email?: string;
}

/** Whether Gmail vouched that a message really came from its From address's domain. */
export type SenderVerification = 'verified' | 'unverified';

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
	calculatedTimeToReadSeconds?: number;
}

export interface PersistedThread {
	id: string;
	historyId?: string;
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
	senderVerification: SenderVerification;
	to: PersonDto[];
	date: number;
	body: {
		original: string;
		html: string;
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
		getReadTimeSeconds(): number;
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
	readHistoryId(threadId: string): Promise<string | undefined>;
	readThread(threadId: string): Promise<ThreadModelLike>;
	readThreadJson(threadId: string): Promise<Partial<PersistedThread>>;
	/**
	 * Caches threadPayload unless it equals the cached copy, serialized with
	 * every other write to that thread. Resolves to whether it was saved.
	 */
	saveThreadJson(threadId: string, threadPayload: PersistedThread): Promise<boolean>;
}
