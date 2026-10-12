import type { ReactNode } from 'react';

import { Head, renderPage } from './page.js';

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

interface IndexPageAssets {
	mainScriptPath: string;
	stylesheetPath: string;
}

/** The inbox shell; everything inside it is mounted by the client bundle. */
function IndexPage({ mainScriptPath, stylesheetPath }: IndexPageAssets) {
	return (
		<html lang="en">
			<Head title="Nailbox" stylesheetPath={stylesheetPath} />
			<body>
				<div className="container">
					<div id="auth-shell-status-root" />
					<div id="main-container">
						<div id="auth-shell-controls-root" className="float-end" />
						<button className="btn btn-outline-secondary" id="settings-btn">
							<i className="bi bi-gear-fill" />
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
						<h4 className="modal-title">Email Grouping Rules</h4>
						<button type="button" className="btn-close" data-dismiss="modal" aria-label="Close" />
					</div>
					<div className="modal-body">
						<div id="grouping-rules-root" />
					</div>
					<div className="modal-footer">
						<button type="button" className="btn btn-outline-secondary" data-dismiss="modal">Cancel</button>
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

export function renderIndexPage(assets: IndexPageAssets): string {
	return renderPage(<IndexPage {...assets} />);
}
