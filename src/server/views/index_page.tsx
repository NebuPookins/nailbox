import type { ReactNode } from 'react';

import { renderPage } from './page.js';

function Modal({ id, large = false, children }: { id: string; large?: boolean; children: ReactNode }) {
	return (
		<div id={id} className="modal fade" tabIndex={-1} role="dialog">
			<div className={large ? 'modal-dialog modal-lg' : 'modal-dialog'}>
				<div className="modal-content">{children}</div>
			</div>
		</div>
	);
}

function PickerModal({ id, rootId }: { id: string; rootId: string }) {
	return (
		<Modal id={id}>
			<div className="modal-header">
				<h4 className="modal-title">Subject Line Here</h4>
			</div>
			<div className="modal-body">
				<div id={rootId} />
			</div>
		</Modal>
	);
}

/** The inbox shell; everything inside it is mounted by the client bundle. */
function IndexPage({ mainScriptPath }: { mainScriptPath: string }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta httpEquiv="X-UA-Compatible" content="IE=edge" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Nailbox</title>
				<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.3.6/css/bootstrap.min.css" />
				<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.3.6/css/bootstrap-theme.min.css" />
				<link rel="stylesheet" href="/public/index.css" />
				<link rel="shortcut icon" type="image/png" href="/public/favicon.png" />
			</head>
			<body>
				<div className="container">
					<div id="auth-shell-status-root" />
					<div id="main-container">
						<div id="auth-shell-controls-root" className="pull-right" />
						<button className="btn btn-default" id="settings-btn">
							<span className="glyphicon glyphicon-cog" />
							{' Email Grouping Settings'}
						</button>
						<div id="thread-list-root" />
					</div>
					<div id="thread-viewer" className="modal fade" tabIndex={-1} role="dialog">
						<div className="modal-dialog modal-lg" role="document">
							<div className="modal-content">
								<div id="thread-viewer-root" />
							</div>
						</div>
					</div>
				</div>
				<PickerModal id="later-picker" rootId="later-picker-root" />
				<PickerModal id="label-picker" rootId="label-picker-root" />
				<Modal id="settings-modal" large>
					<div className="modal-header">
						<button type="button" className="close" data-dismiss="modal" aria-label="Close">
							<span aria-hidden="true">&times;</span>
						</button>
						<h4 className="modal-title">Email Grouping Rules</h4>
					</div>
					<div className="modal-body">
						<div id="grouping-rules-root" />
					</div>
					<div className="modal-footer">
						<button type="button" className="btn btn-default" data-dismiss="modal">Cancel</button>
					</div>
				</Modal>
				<Modal id="grouping-rules-debug-modal" large>
					<div id="grouping-rules-debug-root" />
				</Modal>
				<Modal id="sender-rule-modal">
					<div id="sender-rule-root" />
				</Modal>
				<script src={mainScriptPath} />
			</body>
		</html>
	);
}

export function renderIndexPage(mainScriptPath: string): string {
	return renderPage(<IndexPage mainScriptPath={mainScriptPath} />);
}
