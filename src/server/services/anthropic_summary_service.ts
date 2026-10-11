import type {AnthropicConfig} from '../types/config.js';

interface AnthropicResponse {
	content?: Array<{type?: string; text?: string}>;
	error?: {message?: string};
}

export class SummaryProviderError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

export function buildSummaryPrompt({subject, sender, body}: {subject: string; sender: string; body: string}): string {
	return `Summarize this email concisely for its recipient. If it asks the recipient to do something, begin with "Action: " and state that requested action first. Otherwise begin with "Summary: ". Include important deadlines, amounts, and decisions. Do not invent information.\n\nSubject: ${subject}\nFrom: ${sender}\n\nEmail body:\n${body}`;
}

export async function summarizeWithAnthropic(config: AnthropicConfig, input: {subject: string; sender: string; body: string}, fetchImpl: typeof fetch = fetch): Promise<string> {
	const apiKey = config.apiKey?.trim();
	if (!apiKey) throw new SummaryProviderError('Add an Anthropic API key on your profile before summarizing email.', 503);
	const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: config.model ?? 'claude-haiku-5-5',
			max_tokens: 500,
			messages: [{role: 'user', content: buildSummaryPrompt(input)}],
		}),
	});
	const data = await response.json().catch(() => ({})) as AnthropicResponse;
	if (!response.ok) throw new SummaryProviderError(data.error?.message || `Anthropic request failed (${response.status}).`, 502);
	const summary = data.content?.find((part) => part.type === 'text')?.text?.trim();
	if (!summary) throw new SummaryProviderError('Anthropic returned no summary.', 502);
	return summary;
}
