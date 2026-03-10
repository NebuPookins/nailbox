import util from 'util';

import _ from 'lodash';
import mailcomposer from 'mailcomposer';
import { marked } from 'marked';
import base64url from 'base64url';
import hljs from 'highlight.js';
import posthtml from 'posthtml';
import Optional from 'optional-js';

import threadModel from '../../../models/thread.js';

function renderHighlightedCode(code, lang) {
	const htmlWithClasses = lang ?
		hljs.highlight(code, {language: lang, ignoreIllegals: true}).value :
		hljs.highlightAuto(code).value;
	return posthtml()
		.use((tree) => {
			for (const [key, value] of Object.entries({
				'hljs-comment': 'color:#586e75',
				'hljs-quote': 'color:#586e75',
				'hljs-addition': 'color:#859900',
				'hljs-keyword': 'color:#859900',
				'hljs-selector-tag': 'color:#859900',
				'hljs-doctag': 'color:#2aa198',
				'hljs-literal': 'color:#2aa198',
				'hljs-meta hljs-meta-string': 'color:#2aa198',
				'hljs-number': 'color:#2aa198',
				'hljs-regexp': 'color:#2aa198',
				'hljs-string': 'color:#2aa198',
				'hljs-name': 'color:#268bd2',
				'hljs-section': 'color:#268bd2',
				'hljs-selector-class': 'color:#268bd2',
				'hljs-selector-id': 'color:#268bd2',
				'hljs-title': 'color:#268bd2',
				'hljs-attr': 'color:#b58900',
				'hljs-attribute': 'color:#b58900',
				'hljs-class hljs-title': 'color:#b58900',
				'hljs-template-variable': 'color:#b58900',
				'hljs-type': 'color:#b58900',
				'hljs-variable': 'color:#b58900',
				'hljs-bullet': 'color:#cb4b16',
				'hljs-link': 'color:#cb4b16',
				'hljs-meta': 'color:#cb4b16',
				'hljs-meta hljs-keyword': 'color:#cb4b16',
				'hljs-selector-attr': 'color:#cb4b16',
				'hljs-selector-pseudo': 'color:#cb4b16',
				'hljs-subst': 'color:#cb4b16',
				'hljs-symbol': 'color:#cb4b16',
				'hljs-built_in': 'color:#dc322f',
				'hljs-deletion': 'color:#dc322f',
				'hljs-formula': 'background:#073642',
				'hljs-emphasis': 'font-style:italic',
				'hljs-strong': 'font-weight:700',
			})) {
				tree.match({'attrs': {'class': key}}, (node) => {
					node.attrs.style = value;
					return node;
				});
			}
		})
		.process(htmlWithClasses, {sync: true})
		.html;
}

function markdownToHtml(bodyPlusSignature) {
	return new Promise((resolve, reject) => {
		marked.parse(bodyPlusSignature, {
			gfm: true,
			tables: true,
			breaks: true,
			smartLists: true,
			smartypants: true,
			highlight: renderHighlightedCode,
		}, (error, content) => {
			if (error) {
				reject(error);
				return;
			}
			const contentWithPreBackground = posthtml()
				.use((tree) => {
					tree.match({'tag': 'pre'}, (node) => {
						Object.assign(node, {
							attrs: {
								style: 'background:#002b36; color:#839496',
							},
						});
						return node;
					});
				})
				.process(content, {sync: true})
				.html;
			resolve(contentWithPreBackground);
		});
	});
}

function buildMail({thread, htmlizedMarkdown, bodyPlusSignature, myEmail}) {
	const mostRecentMessage = thread.mostRecentMessageSatisfying(() => true);
	const replyTo = mostRecentMessage.replyTo();
	if (replyTo == null) {
		throw 'TODO: How should we handle the case where we can\'t find a reply to?';
	}
	const threadParticipants = mostRecentMessage.recipients().concat(replyTo);
	const peopleOtherThanYourself = _.uniqBy(
		threadParticipants.filter((person) => person != null && person.email !== myEmail),
		(recipient) => recipient.email
	);
	const toLine = peopleOtherThanYourself.map((person) => util.format('%s <%s>', person.name, person.email));
	const inReplyToId = Optional.ofNullable(mostRecentMessage.header('Message-ID'))
		.map((header) => header.value)
		.orElse(null);
	return mailcomposer({
		from: myEmail,
		to: toLine,
		inReplyTo: inReplyToId,
		subject: thread.subject(),
		text: bodyPlusSignature,
		html: util.format(
			'<!DOCTYPE html><html><head><style type="test/css">blockquote {padding: 10px 20px;margin: 0 0 20px; border-left: 5px solid #eee;}</style></head><body>%s</body></html>',
			htmlizedMarkdown
		),
	});
}

function buildMimeMessage(mail, logger) {
	return new Promise((resolve, reject) => {
		mail.build((error, message) => {
			if (error) {
				logger.error(util.format('Failed to compose mail %j', error));
				reject({
					status: 500,
					message: '',
				});
				return;
			}
			resolve(message);
		});
	});
}

export async function buildRfc2822Message({
	threadId,
	body,
	inReplyTo,
	myEmail,
	logger,
}) {
	const bodyPlusSignature = `${body}\n\n---\nSent using [Nailbox](https://github.com/NebuPookins/nailbox/).`;
	const thread = await threadModel.get(threadId);
	if (!thread.message(inReplyTo)) {
		throw {
			status: 400,
			message: util.format('Could not find message %s in thread %s', inReplyTo, threadId),
		};
	}
	const htmlizedMarkdown = await markdownToHtml(bodyPlusSignature);
	const mostRecentMessage = thread.mostRecentMessageSatisfying(() => true);
	const threadParticipants = mostRecentMessage.recipients().concat(mostRecentMessage.replyTo());
	if (threadParticipants.some((person) => person == null)) {
		logger.warn(`Got null receiver in ${util.inspect(threadParticipants)} from thread ${util.inspect(thread)}`);
	}
	const mail = buildMail({
		thread,
		htmlizedMarkdown,
		bodyPlusSignature,
		myEmail,
	});
	const mimeMessage = await buildMimeMessage(mail, logger);
	return base64url.encode(mimeMessage);
}

export default {
	buildRfc2822Message,
};
