import path from 'node:path';

import fileio from '../../../helpers/fileio.js';
import type {EmailSummaryDto, SummaryRepository} from '../types/email_summary.js';

const DEFAULT_SUMMARIES_DIRECTORY = 'data/summaries';

function summaryPath(summariesDirectory: string, messageId: string): string {
	return path.join(summariesDirectory, `${messageId}.json`);
}

function isSummary(value: unknown): value is EmailSummaryDto {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const summary = value as Record<string, unknown>;
	return typeof summary.messageId === 'string' && typeof summary.summary === 'string' &&
		typeof summary.createdAt === 'string' && typeof summary.model === 'string';
}

export function createSummaryRepository(dependencies: {
	fileioImpl?: typeof fileio;
	summariesDirectory?: string;
} = {}): SummaryRepository {
	const {fileioImpl = fileio, summariesDirectory = DEFAULT_SUMMARIES_DIRECTORY} = dependencies;
	return {
		async readSummary(messageId) {
			try {
				const summary = await fileioImpl.readJsonFromFile(summaryPath(summariesDirectory, messageId));
				return isSummary(summary) && summary.messageId === messageId ? summary : null;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
				throw error;
			}
		},
		async saveSummary(summary) {
			await fileioImpl.saveJsonToFile(summary, summaryPath(summariesDirectory, summary.messageId));
			return summary;
		},
	};
}
