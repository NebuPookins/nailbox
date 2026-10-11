import test from 'node:test';
import assert from 'node:assert/strict';

import {buildSummaryPrompt, summarizeWithAnthropic} from '../src/server/services/anthropic_summary_service.js';

test('summary prompt asks for requested actions before the rest of the summary', () => {
	const prompt = buildSummaryPrompt({
		subject: 'Invoice due',
		sender: 'Vendor <vendor@example.com>',
		body: 'Please pay the attached invoice by Friday.',
	});

	assert.match(prompt, /begin with "Action: "/);
	assert.match(prompt, /Subject: Invoice due/);
	assert.match(prompt, /From: Vendor <vendor@example.com>/);
	assert.match(prompt, /Please pay the attached invoice by Friday/);
});

test('summarizeWithAnthropic sends the selected model and returns text content', async () => {
	let request = null;
	const summary = await summarizeWithAnthropic({apiKey: 'secret', model: 'claude-sonnet-5-5'}, {
		subject: 'Subject', sender: 'Alice', body: 'Body',
	}, async (url, options) => {
		request = {url, options};
		return new Response(JSON.stringify({content: [{type: 'text', text: 'Action: Pay it.'}]}), {status: 200});
	});

	assert.equal(summary, 'Action: Pay it.');
	assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
	assert.equal(request.options.headers['x-api-key'], 'secret');
	assert.equal(JSON.parse(request.options.body).model, 'claude-sonnet-5-5');
});
