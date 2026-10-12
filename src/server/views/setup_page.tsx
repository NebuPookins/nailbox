import { Head, Notice, renderPage, type GoogleOAuthViewModel } from './page.js';

// The redirect URI the server derives from the request can be wrong behind a
// proxy, so the page shows the one matching the address bar instead.
const SHOW_BROWSER_REDIRECT_URI = "document.getElementById('redirect-uri').textContent = window.location.origin + '/auth/google/callback';";

function SetupPage({ stylesheetPath, googleOAuth, authStatus, defaultRedirectUri, notice }: GoogleOAuthViewModel) {
	return (
		<html lang="en">
			<Head title="Nailbox - Setup" stylesheetPath={stylesheetPath} />
			<body>
				<div className="container">
					<div id="status" className="jumbotron mt-4">
						<h1 className="display-4">Nailbox</h1>
						<hr />
						<h2>The world's 2nd best e-mail client</h2>
						<p className="lead">
							Nailbox is inspired by the world's best e-mail client,
							{' '}<a href="https://www.mailboxapp.com/">Mailbox</a>.
						</p>
					</div>
					<div className="alert alert-danger" role="alert">
						Nailbox is pre-Beta software and is <strong><s>probably</s> definitely full of bugs</strong>.
					</div>
					<Notice notice={notice} />
					<h1>What's the worst that could happen?</h1>
					<ul>
						<li>There's a bug in the program and it ends up deleting all your mail permanently.</li>
						<li>There's a bug in the program and it starts forwarding all your e-mails to everyone on your contact list.</li>
						<li>There's a bug in the program and it overwrites all the files on your computer with animated cat gifs.</li>
						<li>The program isn't as secure as gmail itself and now everybody in the world can read your e-mails by hacking in via the backdoor created by this program.</li>
						<li>A funny little man might take away your first-born son unless you can guess his name.</li>
					</ul>
					<h1>I still want to try it out anyway!</h1>
					<p>Configure a Google OAuth Web Application credential so Nailbox can refresh Gmail tokens server-side.</p>
					<form method="POST" action="/setup">
						<ol>
							<li>
								Head over to
								{' '}<a href="https://console.developers.google.com/">https://console.developers.google.com/</a>{' '}
								and create or open a project for Nailbox.
							</li>
							<li>Go to the "Credentials" panel and create an "OAuth client ID".</li>
							<li>Select "Web application" as the application type.</li>
							<li>If there is an "Authorized JavaScript origin", remove it.</li>
							<li>
								Add this exact redirect URI under "Authorized redirect URIs":
								{' '}<code id="redirect-uri">{defaultRedirectUri}</code>
							</li>
							<li>
								Copy the Client ID here:
								<input className="form-control" name="clientId" placeholder="ClientID-blah-blah-blah.apps.googleusercontent.com" defaultValue={googleOAuth.clientId ?? ''} />
							</li>
							<li>
								Copy the Client Secret here:
								<input className="form-control" name="clientSecret" placeholder="GOCSPX-..." defaultValue={googleOAuth.clientSecret ?? ''} />
							</li>
							<li>
								Confirm or override the redirect URI here:
								<input className="form-control" name="redirectUri" placeholder={defaultRedirectUri} defaultValue={googleOAuth.redirectUri || defaultRedirectUri} />
							</li>
							<li>Save the configuration in the Google console.</li>
							<li>Wait 5 minutes for the updates to propagate.</li>
							<li>
								Click this button to save the configuration here.
								<button className="btn btn-outline-secondary ms-1" type="submit">Save</button>
							</li>
							<li>
								Complete the Google connect flow:
								{authStatus.connected ?
									<a className="btn btn-success ms-1" href="/auth/google/start">Reconnect Gmail</a> :
									<a className="btn btn-primary ms-1" href="/auth/google/start">Connect Gmail</a>}
							</li>
						</ol>
					</form>
					{authStatus.connected ? (
						<div className="card border-success mb-3">
							<div className="card-header bg-success-subtle text-success-emphasis">Connected Account</div>
							<div className="card-body">
								<p>
									<strong>Gmail Account:</strong>
									{' '}{authStatus.emailAddress || 'Connected'}
								</p>
								<form method="POST" action="/auth/google/disconnect">
									<button className="btn btn-warning" type="submit">Disconnect Gmail</button>
								</form>
							</div>
						</div>
					) : (
						<div className="card mb-3">
							<div className="card-header">Connection Status</div>
							<div className="card-body">
								<p className="mb-0">Gmail is not connected yet.</p>
							</div>
						</div>
					)}
					<p>Return to the <a href="/">main page</a> after Gmail is connected.</p>
					<h2>Why's it called Nailbox?</h2>
					<p>Nobody knows for sure. There are several origin myths:</p>
					<ul>
						<li>Second place comes after first place, and N comes after M.</li>
						<li>Nailbox is implemented in Node.js, so take the letter N from Node.js and shove it in front of Mailbox to get Nailbox.</li>
						<li>Nailbox was implemented by Nebu, so take the letter N from Nebu and shove it in front of Mailbox to get Nailbox.</li>
					</ul>
					<p>
						Legend also has it that there was an Rails implementation called
						"Railbox" or "Railsbox" or something like that, but was abandoned
						because the name wasn't as catchy and OAuth was significantly harder
						to get right in Ruby.
					</p>
				</div>
				<script dangerouslySetInnerHTML={{ __html: SHOW_BROWSER_REDIRECT_URI }} />
			</body>
		</html>
	);
}

export function renderSetupPage(viewModel: GoogleOAuthViewModel): string {
	return renderPage(<SetupPage {...viewModel} />);
}
