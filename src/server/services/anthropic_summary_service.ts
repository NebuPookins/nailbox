import type {AnthropicConfig} from '../types/config.js';

interface AnthropicResponse {
	model?: string;
	content?: Array<{type?: string; text?: string}>;
	stop_reason?: string | null;
	stop_details?: {category?: string | null; explanation?: string | null} | null;
	usage?: {output_tokens?: number};
	error?: {message?: string};
}

function describeEmptyResponse(data: AnthropicResponse): string {
	const blockTypes = (data.content ?? []).map((part) => part.type ?? 'unknown');
	const details = [
		`stop_reason=${data.stop_reason ?? 'none'}`,
		data.stop_details?.category ? `category=${data.stop_details.category}` : undefined,
		data.stop_details?.explanation ? `explanation=${data.stop_details.explanation}` : undefined,
		`content blocks=[${blockTypes.join(', ')}]`,
		data.usage?.output_tokens !== undefined ? `output_tokens=${data.usage.output_tokens}` : undefined,
		data.model ? `model=${data.model}` : undefined,
	].filter((detail): detail is string => detail !== undefined);
	return `Anthropic returned no summary (${details.join('; ')}).`;
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
			max_tokens: 4000,
			output_config: {effort: 'low'},
			messages: [{role: 'user', content: buildSummaryPrompt(input)}],
		}),
	});
	const data = await response.json().catch(() => ({})) as AnthropicResponse;
	if (!response.ok) throw new SummaryProviderError(data.error?.message || `Anthropic request failed (${response.status}).`, 502);
	const summary = data.content?.find((part) => part.type === 'text')?.text?.trim();
	if (!summary) throw new SummaryProviderError(describeEmptyResponse(data), 502);
	return summary;
}
