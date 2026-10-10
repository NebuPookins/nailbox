import assert from 'assert';

import {decode} from 'html-entities';

import type {ThreadModelLike, ThreadSummaryFields} from '../types/thread.js';

type ThreadMessage = ReturnType<ThreadModelLike['messages']>[number];

export function summaryFieldsOf(thread: ThreadModelLike, threadId: string): ThreadSummaryFields {
	const id = thread.id();
	const maybeMostRecentSnippetInThread = thread.snippet();
	assert((typeof id) === 'string', `Expected thread.id() to be a string but was ${typeof id} for thread ${threadId}.`);

	const messagesInThread = thread.messages();
	const totalTimeToReadSecondsForThread = messagesInThread.reduce((total, message) => total + message.getReadTimeSeconds(), 0);
	const internalDateOf = (message: ThreadMessage): number => parseInt(message.getInternalDate(), 10);
	const mostRecentMessage = messagesInThread.reduce<ThreadMessage | undefined>(
		(latest, message) => (latest === undefined || internalDateOf(message) > internalDateOf(latest) ? message : latest),
		undefined,
	);

	return {
		type: 'thread',
		threadId: id,
		senders: thread.senders(),
		receivers: thread.recipients(),
		lastUpdated: thread.lastUpdated(),
		subject: thread.subject(),
		snippet: maybeMostRecentSnippetInThread ? decode(maybeMostRecentSnippetInThread) : null,
		messageIds: thread.messageIds(),
		labelIds: thread.labelIds(),
		totalTimeToReadSeconds: totalTimeToReadSecondsForThread,
		recentMessageReadTimeSeconds: mostRecentMessage?.getReadTimeSeconds() ?? 0,
	};
}
