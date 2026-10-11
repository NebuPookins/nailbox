export interface EmailSummaryDto {
	messageId: string;
	summary: string;
	createdAt: string;
	model: string;
}

export interface SummaryRepository {
	readSummary(messageId: string): Promise<EmailSummaryDto | null>;
	saveSummary(summary: EmailSummaryDto): Promise<EmailSummaryDto>;
}
