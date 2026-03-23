import util from 'util';

import _ from 'lodash';
import mailcomposer from 'mailcomposer';
import { marked } from 'marked';
import base64url from 'base64url';
import hljs from 'highlight.js';
import posthtml from 'posthtml';
import Optional from 'optional-js';

/**
 * @param {string} code
 * @param {string} lang
 */
function renderHighlightedCode(code, lang) {
	const htmlWithClasses = lang ?
		hljs.highlight(code, {language: lang, ignoreIllegals: true}).value :
		hljs.highlightAuto(code).value;
	return posthtml()
		.use((/** @type {any} */ tree) => {
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
				tree.match({'attrs': {'class': key}}, (/** @type {any} */ node) => {
					node.attrs.style = value;
					return node;
				});
			}
		})
		.process(htmlWithClasses, {sync: true})
		.html;
}

/**
 * @param {string} bodyPlusSignature
 */
async function markdownToHtml(bodyPlusSignature) {
	const content = marked.parse(bodyPlusSignature, {
		gfm: true,
		tables: true,
		breaks: true,
		smartLists: true,
		smartypants: true,
		highlight: renderHighlightedCode,
	});
	return posthtml()
		.use((/** @type {any} */ tree) => {
			tree.match({'tag': 'pre'}, (/** @type {any} */ node) => {
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
}

/**
 * @param {string} emailAddress
 */
function normalizeEmailAddress(emailAddress) {
	return typeof emailAddress === 'string' ? emailAddress.trim().toLowerCase() : '';
}

/**
 * @param {{ thread: any, replyMessage: any, myEmail: string }} params
 */
function collectReplyRecipients({thread, replyMessage, myEmail}) {
	const normalizedMyEmail = normalizeEmailAddress(myEmail);
	return _.uniqBy(
		thread.senders()
			.concat(thread.recipients(), replyMessage.replyTo())
			.filter((/** @type {any} */ person) => person != null && normalizeEmailAddress(person.email).length > 0)
			.filter((/** @type {any} */ person) => normalizeEmailAddress(person.email) !== normalizedMyEmail),
		(/** @type {any} */ person) => normalizeEmailAddress(person.email)
	);
}

/**
 * @param {{ thread: any, htmlizedMarkdown: string, bodyPlusSignature: string, myEmail: string, replyMessage: any }} params
 */
function buildMail({thread, htmlizedMarkdown, bodyPlusSignature, myEmail, replyMessage}) {
	const recipients = collectReplyRecipients({
		thread,
		replyMessage,
		myEmail,
	});
	if (recipients.length === 0) {
		throw {
			status: 400,
			message: 'Could not determine recipients for reply.',
		};
	}
	const toLine = recipients.map((/** @type {any} */ person) => util.format('%s <%s>', person.name, person.email));
	const inReplyToId = Optional.ofNullable(replyMessage.header('Message-ID'))
		.map((/** @type {any} */ header) => header.value)
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

/**
 * @param {any} mail
 * @param {any} logger
 */
async function buildMimeMessage(mail, logger) {
	try {
		return await util.promisify(mail.build.bind(mail))();
	} catch (error) {
		logger.error(util.format('Failed to compose mail %j', error));
		throw {
			status: 500,
			message: '',
		};
	}
}

/**
 * @param {{ threadRepository?: any }} [dependencies]
 */
export function createRfc2822Service(dependencies = {}) {
	const repository = dependencies.threadRepository;

	/**
	 * @param {{ threadId: string, body: string, inReplyTo: string, myEmail: string, logger: any }} params
	 */
	async function buildRfc2822Message({
		threadId,
		body,
		inReplyTo,
		myEmail,
		logger,
	}) {
		const bodyPlusSignature = `${body}\n\n---\nSent using [Nailbox](https://github.com/NebuPookins/nailbox/).`;
		const thread = await repository.readThread(threadId);
		const replyMessage = thread.message(inReplyTo);
		if (!replyMessage) {
			throw {
				status: 400,
				message: util.format('Could not find message %s in thread %s', inReplyTo, threadId),
			};
		}
		const htmlizedMarkdown = await markdownToHtml(bodyPlusSignature);
		const threadParticipants = thread.senders().concat(thread.recipients(), replyMessage.replyTo());
		if (threadParticipants.some((/** @type {any} */ person) => person == null)) {
			logger.warn(`Got null receiver in ${util.inspect(threadParticipants)} from thread ${util.inspect(thread)}`);
		}
		const mail = buildMail({
			thread,
			htmlizedMarkdown,
			bodyPlusSignature,
			myEmail,
			replyMessage,
		});
		const mimeMessage = await buildMimeMessage(mail, logger);
		return (/** @type {any} */ (base64url)).encode(mimeMessage);
	}

	return {
		buildRfc2822Message,
	};
}
