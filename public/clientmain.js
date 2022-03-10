$(function() {
	'use strict';

	if (!console) {
		console = {};
	}
	if (!console.log) {
		console.log = function() {};
	}
	var messengerGetter = (function() {
		var mockMessenger = {
			info: function() {
				return mockMessenger;
			},
			update: function() {
				return mockMessenger;
			},
			error: function() {
				return mockMessenger;
			}
		};
		return function() {
			if (typeof Messenger === 'undefined') {
				return mockMessenger;
			} else {
				return Messenger();
			}
		}
	})();

	var promisedClientId = Q.Promise(function(resolve, reject) {
		$.get({
			url: '/api/clientId'
		}).done(function(clientId, textStatus, jqXHR) {
			resolve(clientId);
		}).fail(function(jqXHR, textStatus, errorThrown) {
			reject(textStatus);
		});
	});
	var $main = $('#main');

	var handlebarsTemplates = {};
	handlebarsTemplates.group = Handlebars.compile($('#handlebar-group').html());
	handlebarsTemplates.thread = Handlebars.compile($('#handlebar-thread').html());
	handlebarsTemplates.message = Handlebars.compile($('#handlebar-message').html());
	handlebarsTemplates.deletedMessages = Handlebars.compile($('#handlebar-deleted-messages').html());
	handlebarsTemplates.labelSelection = Handlebars.compile($('#handlebar-label-selection').html());
	Handlebars.registerHelper('nMore', function(total, amountToSubtract) {
		if (typeof amountToSubtract !== 'number') {
			amountToSubtract = 1;
		}
		return total - amountToSubtract;
	});
	Handlebars.registerHelper('filesize', function(bytes) {
		if (typeof filesize === 'function') {
			return filesize(bytes);
		} else {
			/*
			 * the filesize function is supposed to be loaded via a CDN, but there has
			 * been issues in the past where the CDN forgets to renew their SSL
			 * certificate or something like that, causing the javascript to fail to
			 * load, which causes the function to not be defined. Here's a "dumb"
			 * fallback implementation.
			 */
			return bytes + " bytes";
		}
	});

	Handlebars.registerHelper("prettyTimestamp", function(timestamp) {
		var now = moment();
		var momentToFormat = moment(timestamp);
		if (momentToFormat.isSame(now, 'day')) {
			return momentToFormat.format('h:mm A');
		} else if (momentToFormat.isSame(now, 'week')) {
			return momentToFormat.format('ddd h:mm A');
		} else if (momentToFormat.isSame(now, 'year')) {
			return momentToFormat.format('MMM Do');
		} else {
			return momentToFormat.format('YYYY-MMM-DD');
		}
	});

	Handlebars.registerHelper('pluralize', function(number, singular, plural) {
		return number === 1 ? singular : plural;
	});

	Handlebars.registerHelper('labelIdToName', function(labelId) {
		/*
		 * If the promise isn't ready yet, just immediately return an empty string.
		 * We want to show the e-mails right away, even if it means we don't know
		 * the labels yet.
		 */
		var promiseSnapshot = promisedLabels.inspect();
		if (promiseSnapshot.state === 'fulfilled') {
			var labelObj = promiseSnapshot.value.find(function(label) { return label.id === labelId; });
			if (labelObj === undefined) {
				return '';
			}
			/*
			 * For whatever reason, the system labels that begin with "CATEGORY_"
			 * (e.g. "CATEGORY_SOCIAL") don't have a pleasant display name.
			 */
			var match = /^CATEGORY_([A-Z]+)$/.exec(labelObj.id);
			if (labelObj.type === 'system' && match !== null) {
				return match[1].charAt(0).toUpperCase() + match[1].substr(1).toLowerCase();
			}
			return promiseSnapshot.value.find(function(label) { return label.id === labelId; }).name;
		} else {
			return '';
		}
	});

	String.prototype.hashCode = function() {
		var hash = 0, i, chr, len;
		if (this.length === 0) return hash;
		for (i = 0, len = this.length; i < len; i++) {
			chr   = this.charCodeAt(i);
			hash  = ((hash << 5) - hash) + chr;
			hash |= 0; // Convert to 32bit integer
		}
		return hash;
	};

	/**
	 * Waits for the global variable `gapi`, representing the Google API, to
	 * finish loading.
	 */
	function waitForGapiToLoad(updateMessenger) {
		return Q.Promise(function(resolve, reject) {
			function _waitForGapiToLoad() {
				updateMessenger.update({
					type: 'info',
					message: "Waiting for Google API to load..."
				});
				if (gapi && gapi.client) {
					updateMessenger.update({
						type: 'success',
						message: "Google API to loaded!"
					});
					resolve(gapi);
				} else {
					gapi.load('client', _waitForGapiToLoad);
				}
			}
			_waitForGapiToLoad();
		});
	}

	function saveThreadFromGmailToServer(fnAuthorizationGetter, threadId) {
		if (!threadId) {
			debugger;
			throw "foo";
		}
		return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.readonly').then(function(gapi) {
			return Q.promise(function(resolve, reject) {
				gapi.client.gmail.users.threads.get({
					userId: 'me',
					id: threadId
				}).execute(function(resp) {
					if (resp.result) {
						$.post(
							'/api/threads',
							resp.result
						).done(resolve).fail(function(jqXHR, textStatus, errorThrown) {
							messengerGetter().error("Failed to save thread " + threadId);
							console.log("Failed to save thread", resp, jqXHR, textStatus, errorThrown);
							reject(jqXHR, textStatus, errorThrown);
						});
					} else {
						switch (resp.code) {
							case 404:
								/*
								 * Thread no longer exists on gmail, so let's delete it from
								 * our locale cache too.
								 */
								/*
								 * TODO: Am I doing the promises correctly here?
								 */
								var updateMessenger = messengerGetter().info("Deleting thread "+threadId+" because it's no longer on gmail...");
								reject(deleteOnLocalCache(threadId, updateMessenger));
								return;
							default:
								messengerGetter().error("Failed to save thread " + threadId + " due to HTTP " + resp.code);
								reject(resp);
						}
					}
				});
			});
		});
	}

	function saveLabelledThreadsFromGmailToServer(fnAuthorizationGetter, labelIds, updateMessenger) {
		return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.readonly').then(function(gapi) {
			return Q.Promise(function(resolve, reject) {
				updateMessenger.update({
					type: 'info',
					message: "Downloading list of threads from Gmail..."
				});
				gapi.client.gmail.users.threads.list({
					'userId': 'me',
					'labelIds': labelIds
				}).execute(resolve); //TODO: Handle errors
			}).then(function(resp) {
				updateMessenger.update({
					type: 'info',
					message: "Downloading "+resp.threads.length+" threads from Gmail..."
				});
				return resp.threads.map(function(item) {
					return saveThreadFromGmailToServer(fnAuthorizationGetter, item.id);
				});
			}).then(function(arrOfPromises) {
				return Q.allSettled(arrOfPromises);
			});
		});
	}

	function saveThreadsFromGmailToServer(fnAuthorizationGetter, updateMessenger) {
		var inboxMessages = saveLabelledThreadsFromGmailToServer(fnAuthorizationGetter, ['INBOX'], updateMessenger)
		var trashedMessages = saveLabelledThreadsFromGmailToServer(fnAuthorizationGetter, ['TRASH'], updateMessenger)
		return Q.allSettled([inboxMessages, trashedMessages]);
	}

	function updateUiWithThreadsFromServer(fnAuthorizationGetter, updateMessenger) {
		updateMessenger.update({
			type: 'info',
			message: "Downloading threads from local cache..."
		});
		$.get({
			url: '/api/threads/grouped',
			dataType: 'json'
		}).done(function(groupsOfThreads, textStatus, jqXHR) {
			$('#status').hide();
			$main.text('');
			groupsOfThreads.forEach(function(group) {
				var $group = $(handlebarsTemplates.group(group));
				$main.append($group);
				group.threads.forEach(function refreshIfNeeded(thread) {
					if (thread.needsRefreshing) {
						console.log("Refreshing ", thread);
						saveThreadFromGmailToServer(fnAuthorizationGetter, thread.threadId);
					}
				});
				group.threads.forEach(function(thread) {
					thread.mainDisplayedLabelIds = thread.labelIds.filter(function(labelId) {
						switch (labelId) {
							/*
							 * Every e-mail we display is in the INBOX.
							 */
							case 'INBOX': return false;
							/*
							 * Controversial design choice: We think inbox zero is facilitated
							 * if we get rid of the distracting concept of a read e-mail vs an
							 * unread e-mail.
							 */
							case 'UNREAD': return false;
							case 'SENT': return false;
							case 'TRASH': return false;
							default: return true;
						}
					});
					var $thread = $(handlebarsTemplates.thread(thread));
					$thread.data('labelIds', thread.labelIds);
					$main.append($thread);
				});
			});
			updateMessenger.update({
				type: 'success',
				message: "GUI updated with threads from server..."
			});
		});
	}

	/**
	 * An fnAuthorizationGetter is a function which, if you pass it a string (e.g. 'https://www.googleapis.com/auth/gmail.readonly'),
	 * will as a side effect ensure we have authorization for the operation represented by that string.
	 *
	 * @return Returns a promise that will only resolve once the authorization is granted. As a convenience, the value the
	 * promise resolves to will be the same gapi object that was passed in, as callers probably want to immediately call
	 * some operation on gapi once we know we have authorization to do so.
	 */
	function getAuthorizationGetter(gapi, clientId) { //TODO: Accept an updateMessenger
		/*
		 * alreadyPromisedScopes is a map from strings representing scopes to Promises<POJO>. For now, the POJO just
		 * contains a single field "expiresAt" specifying at what point in time the auth token we've got will expire. It's
		 * basically a cache, but also is intended so that if 10 "threads" all want the same scope, they can all "block" on
		 * the same promise.
		 */
		var alreadyPromisedScopes = {};
		return function(scope) {
			/*
			 * * If we've never requested this scope before, we need to request authorization.
			 * * If we've requested the scope, and the promise is rejected, we need to re-request authorization.
			 * * If we've requested the scope, and the promise is pending, then we can just wait.
			 * * If we've requested the scope, and the promise is fulfilled, we need to check if the auth expired. If so, then
			 *   we need to re-request. Otherwise, we don't need to re-request.
			 */
			var needToRequestAuthorization = true;
			if (alreadyPromisedScopes[scope]) {
				if (alreadyPromisedScopes[scope].isFulfilled()) {
					var inspectedPromise = alreadyPromisedScopes[scope].inspect();
					if (inspectedPromise.value.expiresAt.isAfter(/*now*/)) {
						needToRequestAuthorization = false;
					}
				} else if (alreadyPromisedScopes[scope].isPending()) {
					needToRequestAuthorization = false;
				}
			}
			console.log("needToRequestAuthorization", needToRequestAuthorization);
			if (needToRequestAuthorization) {
				/*
				 * If we need to request, then immediately put a promise into our cache so that it's sharable.
				 */
				alreadyPromisedScopes[scope] = Q.Promise(function(resolve, reject) {
					console.log("initializing google token client for scope", scope);
					var googleTokenClient = google.accounts.oauth2.initTokenClient({
						client_id: clientId,
						scope: scope,
						callback: (authResult) => {
							if (authResult.error) {
								console.log("Failed to get token for scope", scope, authResult);
								reject(authResult);
							} else {
								console.log("Got token for scope", scope, authResult, "loading gmail.");
								gapi.client.load('gmail', 'v1', function() {
									resolve({
										expiresAt: moment().add(authResult.expires_in, 'seconds')
									});
								});
							}
						},
					});
					console.log("Requesting access token for scope", scope);
					googleTokenClient.requestAccessToken();
				});
			}
			/*
			 * Our callers don't care about our {expiry: 'whatever'} POJO; they just want an instance of gapi to work with.
			 * So write a transform that blocks on the promise, and then just returns the gapi.
			 */
			return alreadyPromisedScopes[scope].then(function() {return gapi;})
		};
	}

	var promisedFnAuthorizationGetter = Q.all([
		waitForGapiToLoad(messengerGetter().info("Loading Google API...")), promisedClientId
	]).spread(function(gapi, clientId) {
		return getAuthorizationGetter(gapi, clientId);
	});

	(function() {
		var fnScheduledUpdate = function() {
			promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
				updateUiWithThreadsFromServer(fnAuthorizationGetter, messengerGetter().info("Refreshing threads from cache..."));
				setTimeout(fnScheduledUpdate, moment.duration(5, 'minutes').as('milliseconds'));
			});
		};
		fnScheduledUpdate();
	}());

	var promisedMyEmail = promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
		return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.readonly');
	}).then(function(gapi) {
		return Q.Promise(function(resolve, reject) {
			gapi.client.gmail.users.getProfile({userId: 'me'})
				.execute(function(resp) {
					if (resp.emailAddress) {
						resolve(resp.emailAddress);
					} else {
						reject(resp);
					}
				});
		});
	});

	var promisedLabels = promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
		return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.readonly');
	}).then(function(gapi) {
		return Q.Promise(function(resolve, reject) {
			var updateMessenger = messengerGetter().info("Downloading labels from GMail...");
			gapi.client.gmail.users.labels.list({
				userId: 'me'
			}).execute(function(resp) {
				if (_.isArray(resp.labels)) {
					updateMessenger.update({
						type: 'success',
						message: "Successfully downloaded labels from GMail."
					});
					resolve(_.sortBy(resp.labels, function(label) {
						/*
						 * Show all the system labels before the user labels, then sort
						 * within each category by name.
						 */
						return (label.type === 'system' ? 'A' : 'B') + label.name.toLowerCase();
					}));
				} else {
					updateMessenger.update({
						type: 'error',
						message: "Failed to download labels from GMail."
					});
					reject(resp);
				}
			});
		});
	});

	(function() {
		var fnScheduledUpdate = () => {
			var updateMessenger = messengerGetter().info("Downloading new threads from gmail...");
			promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
				return saveThreadsFromGmailToServer(fnAuthorizationGetter, updateMessenger).then(function() {
					return fnAuthorizationGetter;
				});
			}).then(function(fnAuthorizationGetter) {
				updateUiWithThreadsFromServer(fnAuthorizationGetter, updateMessenger);
			}).then(function() {
				updateMessenger.update({
					type: 'success',
					message: "Successfully downloaded new threads from gmail."
				});
				setTimeout(fnScheduledUpdate, moment.duration(30, 'minutes').as('milliseconds'));
			}).done();
		};
		fnScheduledUpdate();
	})();
	

	function deleteThreadFromUI(threadId) {
		var $uiElemToDelete = $main.find('.thread[data-thread-id="'+threadId+'"]');
		$uiElemToDelete.hide(400, function () {
			$uiElemToDelete.remove();
		});
	}

	function deleteOnLocalCache(threadId, updateMessenger) {
		updateMessenger.update({
			type: 'info',
			message: "Deleting thread "+threadId+" from local cache..."
		});
		return Q.Promise(function(resolve, reject) {
			$.ajax({
				url: '/api/threads/' + threadId,
				type: 'DELETE'
			}).done(resolve).fail(reject);
		});
	}

	function deleteThread(threadId, updateMessenger) {
		updateMessenger.update({
			type: 'info',
			message: "Requesting delete permissions from Google API..."
		});
		return promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.modify');
		}).then(function trashOnGmail(gapi) {
			return Q.Promise(function(resolve, reject) {
				updateMessenger.update({
					type: 'info',
					message: "Calling Gmail API thread.trash("+threadId+")"
				});
				gapi.client.gmail.users.threads.trash({
					userId: 'me',
					id: threadId
				}).execute(function (resp) {
					if (resp.id == threadId) {
						resolve(resolve); //Successfully deleted from gmail.
					} else {
						//delete not successful.
						switch(resp.code) {
							case 403:
								updateMessenger.update({
									type: 'error',
									message: "Insufficient permissions to delete thread."
								});
								//TODO: Insufficient permissions.
								break;
							case 404:
								//Message apparently already deleted on Google.
								resolve(resolve);
								break;
							default:
								updateMessenger.update({
									type: 'error',
									message: "Failed to delete thread from gmail (HTTP code "+resp.code+")."
								});
								break;
						}
						reject(resp);
					}
				});
			});
		}).then(function() {
			return deleteOnLocalCache(threadId, updateMessenger);
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	function archiveThread(threadId, updateMessenger) {
		return promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.modify');
		}).then(function trashOnGmail(gapi) {
			return Q.Promise(function(resolve, reject) {
				updateMessenger.update({
					type: 'info',
					message: "Calling Gmail API threads.modify (archiving) on "+threadId+"."
				});
				gapi.client.gmail.users.threads.modify({
					userId: 'me',
					id: threadId,
					removeLabelIds: ['INBOX']
				}).execute(function (resp) {
					if (resp.id === threadId) {
						resolve(resolve);
					} else {
						//delete not successful.
						if (resp.code === 403) {
							updateMessenger.update({
								type: 'error',
								message: "Insufficient permissions to archive thread on gmail."
							});
						} else {
							updateMessenger.update({
								type: 'error',
								message: "Failed to archive thread."
							});
						}
						reject(resp);
					}
				});
			});
		}).then(function() {
			return deleteOnLocalCache(threadId, updateMessenger);
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	function moveThreadToLabel(threadId, labelId, updateMessenger) {
		//TODO: Share code with archiveThread
		return promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.modify');
		}).then(function(gapi) {
			return Q.Promise(function(resolve, reject) {
				updateMessenger.update({
					type: 'info',
					message: "Calling Gmail API threads.modify (moving to label) on "+threadId+"."
				});
				gapi.client.gmail.users.threads.modify({
					userId: 'me',
					id: threadId,
					removeLabelIds: ['INBOX','UNREAD'],
					addLabelIds: [labelId]
				}).execute(function (resp) {
					/*
					 * Don't know why but sometimes the ids are strings (but all numeric)
					 * and sometimes they're ints. Hence the need to use == instead of ===
					 */
					if (resp.id == threadId) {
						resolve(resolve); //Successfully deleted from gmail.
					} else {
						//delete not successful.
						if (resp.code === 403) {
							updateMessenger.update({
								type: 'error',
								message: "Insufficient permissions to move thread to label."
							});
						} else {
							debugger;
							updateMessenger.update({
								type: 'error',
								message: "Failed to move thread "+threadId+" to label."
							});
						}
						reject(resp);
					}
				});
			});
		}).then(function() {
			return deleteOnLocalCache(threadId, updateMessenger);
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	var $threadViewer = $('#thread-viewer');


	$main.on('click', 'button.delete', function(eventObject) {
		var btnDelete = eventObject.currentTarget;
		var $divThread = $(btnDelete).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		var updateMessenger = messengerGetter().info("Deleting thread "+threadId+"...");
		deleteThread(threadId, updateMessenger).then(function() {
			updateMessenger.update({
				type: 'success',
				message: "Successfully deleted message " + threadId
			});
		}).done();
		return false;
	});
	$threadViewer.find('button.reply-all').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		var updateMessenger = messengerGetter().info("Sending reply to thread "+threadId+"...");
		if (!threadId) {
			updateMessenger.update({
				type: 'error',
				message: "Tried to reply to thread from threadViewer, but there was no threadId."
			});
			return;
		}
		var promisedEncodedEmail = promisedMyEmail.then(function(myEmail) {
			return Q.Promise(function(resolve, reject) {
				updateMessenger.update({
					type: 'info',
					message: "POST-ing to get RFC2822 content..."
				});
				$.post('/api/rfc2822', {
					myEmail: myEmail,
					threadId: threadId,
					body: $threadViewer.find('.reply textarea').val(),
					inReplyTo: $threadViewer.find('.threads .message:last').data('messageId')
				}).done(resolve).fail(reject);
			});
		});
		promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.modify');
		}).then(function(gapi) {
			return promisedEncodedEmail.then(function(base64EncodedEmail) {
				return Q.Promise(function(resolve, reject) {
					updateMessenger.update({
						type: 'info',
						message: "Sending e-mail to gmail..."
					});
					gapi.client.gmail.users.messages.send({
						userId: 'me',
						uploadType: 'media',
						threadId: threadId,
						raw: base64EncodedEmail
					}).execute(function(resp) {
						if (resp.id) {
							updateMessenger.update({
								type: 'success',
								message: "Successfully sent message with id "+ resp.id +"."
							});
							resolve(resp);
						} else {
							updateMessenger.update({
								type: 'error',
								message: "Failed to send message: " + resp.message
							});
							console.log("Failed to send message:", resp);
							debugger;
							reject(resp);
						}
					});
				});
			});
		}).then(function() {
			$threadViewer.find('.reply textarea').val('');
			$threadViewer.modal('hide');
		}).done();
	});
	function b64toBlob(b64Data) {
		var sliceSize = 512;
		var byteCharacters = atob(b64Data);
		var byteArrays = [];
		for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
			var slice = byteCharacters.slice(offset, offset + sliceSize);
			var byteNumbers = new Array(slice.length);
			for (var i = 0; i < slice.length; i++) {
				byteNumbers[i] = slice.charCodeAt(i);
			}
			var byteArray = new Uint8Array(byteNumbers);
			byteArrays.push(byteArray);
		}
		var blob = new Blob(byteArrays);
		return blob;
	}
	$threadViewer.on('click', 'button.dl-attachment', function(eventObj) {
		var $clickedButton = $(eventObj.target);
		var attachmentId = $clickedButton.data('attachment-id');
		var attachmentName = $clickedButton.data('attachment-name');
		var $message = $clickedButton.parents('.message');
		var messageId = $message.data('message-id');
		var updateMessenger = messengerGetter().info("Download attachment from "+messageId+".");
		promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.readonly');
		}).then(function(gapi) {
			return Q.Promise(function(resolve, reject) {
				gapi.client.gmail.users.messages.attachments.get({
					id: attachmentId,
					messageId: messageId,
					userId: 'me'
				}).execute(function(resp) {
						if (resp.data) {
							resolve(resp.data);
						} else {
							reject(resp);
						}
					});
			});
		}).then(function(base64UrlAttachment) {
			var base64Version = base64UrlAttachment.replace(/[-_]/g, function(char) {
				if (char === '-') {
					return '+';
				}
				if (char === '_') {
					return '/';
				}
				throw "Don't know how to transform " + char;
			});
			var blob = b64toBlob(base64Version);
			saveAs(blob, attachmentName);
		});
	});
	$threadViewer.find('button.delete').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		var updateMessenger = messengerGetter().info("Deleting thread "+threadId+"...");
		if (threadId) {
			deleteThread(threadId, updateMessenger).then(function() {
				updateMessenger.update({
					type: 'success',
					message: "Successfully deleted message " + threadId
				});
				$threadViewer.modal('hide');
			}).done();
		} else {
			updateMessenger.update({
				type: 'error',
				message: "Tried to delete from threadViewer, but there's no thread id."
			});
		}
		return false;
	});
	$threadViewer.on('keydown', function(event) {
		/*
		 * If the textarea (where the user types their reply) has focus, then don't
		 * process any key events.
		 */
		if ($threadViewer.find('textarea').is(":focus")) {
			return;
		}
		var threadId = $threadViewer.data('threadId');
		switch (event.key) {
			case 'Delete':
				var updateMessenger = messengerGetter().info("Deleting thread "+threadId+"...");
				deleteThread(threadId, updateMessenger).then(function() {
					updateMessenger.update({
						type: 'success',
						message: "Successfully deleted message " + threadId
					});
					$threadViewer.modal('hide');
				}).done();
				break;
			default:
				//Do nothing
		}
	});
	$main.on('click', 'a.view-on-gmail', function(eventObject) {
		//Prevent bubbling, but otherwise do nothing since it's a link.
		eventObject.stopPropagation();
		return true;
	});
	$threadViewer.find('button.view-on-gmail').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			window.open('https://mail.google.com/mail/u/0/#inbox/' + threadId,'_blank');
		} else {
			messengerGetter().error("Tried to view-on-gmail from threadViewer, but there's no thread id.");
		}
		return false;
	});
	$main.on('click', 'button.archive-thread', function(eventObject) {
		var btnDelete = eventObject.currentTarget;
		var $divThread = $(btnDelete).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		var updateMessenger = messengerGetter().info("Archiving thread "+threadId+"...");
		archiveThread(threadId, updateMessenger).then(function() {
			updateMessenger.update({
				type: 'success',
				message: "Successfully archived thread "+threadId+"."
			});
		}).done();
		return false;
	});
	$threadViewer.find('button.archive-thread').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		var updateMessenger = messengerGetter().info("Archiving thread "+threadId+"...");
		if (threadId) {
			archiveThread(threadId, updateMessenger).then(function() {
				$threadViewer.modal('hide');
				updateMessenger.update({
					type: 'success',
					message: "Successfully archived thread "+threadId+"."
				});
			}).done();
		} else {
			updateMessenger.update({
				type: 'error',
				message: "Tried to archive from threadViewer, but there's no thread id."
			});
		}
		return false;
	});
	var $labelPicker = $('#label-picker');
	var $laterPicker = $('#later-picker');
	function mainClickerShowPicker($mainBtnClicked, $picker) {
		var $divThread = $mainBtnClicked.parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		$picker.find('.modal-title').text($divThread.find('.subject').text());
		$picker.data('threadId', threadId);
		$picker.modal('show');
		return false;
	}
	function switchFromThreadViewerToPicker($picker) {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			$threadViewer.modal('hide');
			$picker.find('.modal-title').text($threadViewer.find('.modal-title').text());
			$picker.data('threadId', threadId);
			$picker.modal('show');
		} else {
			messengerGetter().error("Tried to switch from threadViewer to $picker, but there's no thread id.");
			console.log("Tried to switch from threadViewer to ", $picker, ", but there's no thread id.");
		}
		return false;
	}
	var promisedThatLabelsOnLabelPickerArePopulated = promisedLabels.then(function(labels) {
		var $labelList = $labelPicker.find('ul.label-list');
		$labelList.empty();
		labels
			.filter(function(label) {
				return label.labelListVisibility !== 'labelHide';
			}).filter(function(label) {
				/*
				 * According to https://developers.google.com/gmail/api/guides/labels
				 * SENT and DRAFT cannot be manually applied.
				 */
				return label.id !== 'SENT' && label.id !== 'DRAFT';
			}).filter(function(label) {
				/*
				 * This command is more about moving to a folder than labelling.
				 * Remove the labels where it doesn't make sense to "move" into.
				 */
				return label.id !== 'INBOX' &&
					label.id !== 'IMPORTANT' &&
					label.id !== 'STARRED' &&
					label.id !== 'TRASH' &&
					label.id !== 'UNREAD';
			}).forEach(function(label) {
				$labelList.append(handlebarsTemplates.labelSelection({
					id: label.id,
					isSystem: label.type === 'system',
					hue: (label.name.hashCode() % 360)
				}));
			});
	});
	$main.on('click', 'button.label-thread', function(eventObject) {
		promisedThatLabelsOnLabelPickerArePopulated.then(function() {
			mainClickerShowPicker($(eventObject.currentTarget), $labelPicker);
		}).done();
		return false;
	});
	$threadViewer.find('button.label-thread').on('click', function() {
		promisedThatLabelsOnLabelPickerArePopulated.then(function() {
		}).then(function() {
			return switchFromThreadViewerToPicker($labelPicker);
		}).done();
		return false;
	});
	
	$main.on('click', 'button.later', function(eventObject) {
		return mainClickerShowPicker($(eventObject.currentTarget), $laterPicker);
	});
	$threadViewer.find('button.later').on('click', function() {
		return switchFromThreadViewerToPicker($laterPicker);
	});
	$laterPicker.on('click', '.button', function(eventObject) {
		var threadId = $laterPicker.data('threadId');
		var updateMessenger = messengerGetter().info("Hiding thread " + threadId + ".");
		if (!threadId) {
			updateMessenger.update({
				type: 'error',
				message: "Tried to hide thread from laterPicker, but no threadId found."
			});
			return;
		}
		var btnClicked = eventObject.currentTarget;
		var todaysEvening = moment().hour(18).startOf('hour');
		var tomorrowsEvening = moment(todaysEvening).add(1, 'day');
		var hideUntil;
		switch ($(btnClicked).data('value')) {
			case 'hours':
				hideUntil = {
					type: 'timestamp',
					value: moment().add(3, 'hours').valueOf()
				};
				break;
			case 'evening':
				if (moment().add(3, 'hours').isBefore(todaysEvening)) {
					hideUntil = {
						type: 'timestamp',
						value: todaysEvening.valueOf()
					};
				} else {
					hideUntil = {
						type: 'timestamp',
						value: tomorrowsEvening.valueOf()
					};
				}
				break;
			case 'tomorrow':
				hideUntil = {
					type: 'timestamp',
					value: moment().hour(7).startOf('hour').add(1, 'day').valueOf()
				};
				break;
			case 'weekend':
				var weekend = moment().day(6).hour(7).startOf('hour');
				if (weekend.isBefore(moment())) {
					weekend.add(1, 'week');
				}
				hideUntil = {
					type: 'timestamp',
					value: weekend.valueOf()
				};
				break;
			case 'monday':
				var monday = moment().day(1).hour(7).startOf('hour');
				if (monday.isBefore(moment())) {
					monday.add(1, 'week');
				}
				hideUntil = {
					type: 'timestamp',
					value: monday.valueOf()
				};
				break;
			case 'month':
				hideUntil = {
					type: 'timestamp',
					value: moment().add(1, 'month').hour(7).startOf('hour').valueOf()
				};
				break;
			case 'someday':
				hideUntil = {
					type: 'timestamp',
					value: moment().add(6, 'month').hour(7).startOf('hour').valueOf()
				};
				break;
			case 'when-i-have-time':
				hideUntil = {
					type: 'when-i-have-time'
				};
				break;
			//case 'custom': //TODO
			default:
				updateMessenger.update({
					type: 'error',
					message: "Forgot to implement " + $(btnClicked).data('value')
				});
				return;
		}
		updateMessenger.update({
			type: 'info',
			message: "Hiding thread " + threadId + " until " + JSON.stringify(hideUntil) + "."
		});
		$.ajax({
			url: '/api/threads/' + threadId + '/hideUntil',
			data: hideUntil,
			method: 'PUT'
		}).done(function() {
			updateMessenger.update({
				type: 'success',
				message: "Successfully hid thread " + threadId + " until " + JSON.stringify(hideUntil) + "."
			});
			$laterPicker.modal('hide');
			deleteThreadFromUI(threadId);
		}).fail(function() {
			updateMessenger.update({
				type: 'error',
				message: "Failed to hide threads."
			});
			console.log("Failure while setting threads.", arguments);
			debugger;
		});
		return false;
	});
	$labelPicker.on('click', 'button', function(eventObject) {
		var threadId = $labelPicker.data('threadId');
		var updateMessenger = messengerGetter().info("Moving thread "+threadId+" to label...");
		if (!threadId) {
			updateMessenger.update({
				type: 'error',
				message: "Tried to assign label thread from labelPicker, but no threadId found."
			});
			return;
		}
		var labelId = $(eventObject.currentTarget).data('label-id');
		moveThreadToLabel(threadId, labelId, updateMessenger).then(function() {
			$labelPicker.modal('hide');
			updateMessenger.update({
				type: 'success',
				message: "Successfully moved thread "+threadId+" to label."
			});
		}).done();
	});
	
	$main.on('click', 'div.thread', function(eventObject) {
		var $threadDiv = $(eventObject.currentTarget);
		var threadId = $threadDiv.data('threadId');
		var $threads = $threadViewer.find('.threads');
		$threadViewer.data('threadId', threadId);
		$threadViewer.find('.modal-title').text($threadDiv.find('.subject').text());
		$threadViewer.find('.senders').text($threadDiv.find('.senders').attr('title') || '');
		$threadViewer.find('.receivers').text($threadDiv.find('.receivers').attr('title') || '');
		$threads.text($threadDiv.find('.snippet').text());
		$threadViewer.find('.loading-img').show();
		$threadViewer.modal('show');
		var updateMessenger = messengerGetter().info("Downloading thread data for "+threadId +"...");
		function getThreadData(attemptNumber) {
			return Q.Promise(function(resolve, reject) {
				$.get('/api/threads/' + threadId +'/messages').done(function(threadData, textStatus, jqXHR) {
					resolve(threadData);
				}).fail(function(jqXHR, textStatus, errorThrown) {
					console.log('Error getting thread data', arguments);
					if (attemptNumber < 60) {
						updateMessenger.update({
							type: 'info',
							message: "Failed to get thread data, retrying..."
						});
						console.log('Retrying getThreadData');
						resolve(getThreadData(attemptNumber + 1));
					} else {
						updateMessenger.update({
							type: 'error',
							message: "Failed to get thread data after too many retries."
						});
						reject('Failed after too many retries');
					}
				});
			});
		}
		getThreadData(0)
			.then(function(threadData) {
				if ($threadViewer.data('threadId') !== threadId) {
					//The user closed the modal and opened a new thread; this ajax result is stale.
					updateMessenger.update({
						type: 'info',
						message: "Detected that user no longer cares about "+threadId+"; discarding thread data."
					});
					return;
				}
				$threadViewer.find('.loading-img').hide();
				$threads.empty();
				var nonDeletedMessages = threadData.messages.filter(function(message) {
					return !message.deleted;
				});
				if (threadData.messages.length > nonDeletedMessages.length) {
					$threads.append(handlebarsTemplates.deletedMessages({
						num: threadData.messages.length - nonDeletedMessages.length,
						threadId: threadId
					}));
				}
				nonDeletedMessages.forEach(function(message) {
					$threads.append(handlebarsTemplates.message(message));
				});
				updateMessenger.update({
					type: 'success',
					message: "Successfully downloaded thread data for "+threadId+"."
				});
			}).done();
	});
	
});
