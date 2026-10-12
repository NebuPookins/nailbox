import { Notice, renderPage, type GoogleOAuthViewModel } from './page.js';

// The redirect URI the server derives from the request can be wrong behind a
// proxy, so the page shows the one matching the address bar instead.
const SHOW_BROWSER_REDIRECT_URI = "document.getElementById('redirect-uri').textContent = window.location.origin + '/auth/google/callback';";

function SetupPage({ googleOAuth, authStatus, defaultRedirectUri, notice }: GoogleOAuthViewModel) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta httpEquiv="X-UA-Compatible" content="IE=edge" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Nailbox - Setup</title>
				<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css" integrity="sha384-1q8mTJOASx8j1Au+a5WDVnPi2lkFfwwEAa8hDDdjZlpLegxhjVME1fgjWPGmkzs7" crossOrigin="anonymous" />
				<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap-theme.min.css" integrity="sha384-fLW2N01lMqjakBkx3l/M9EahuwpSfeNvV63J5ezn3uZzapT0u7EYsXMjQV+0En5r" crossOrigin="anonymous" />
			</head>
			<body>
				<div className="container">
					<div id="status" className="jumbotron">
						<h1>Nailbox</h1>
						<hr />
						<h2>The world's 2nd best e-mail client</h2>
						<p>
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
								<button className="btn btn-default" type="submit">Save</button>
							</li>
							<li>
								Complete the Google connect flow:
								{authStatus.connected ?
									<a className="btn btn-success" href="/auth/google/start">Reconnect Gmail</a> :
									<a className="btn btn-primary" href="/auth/google/start">Connect Gmail</a>}
							</li>
						</ol>
					</form>
					{authStatus.connected ? (
						<div className="panel panel-success">
							<div className="panel-heading">Connected Account</div>
							<div className="panel-body">
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
						<div className="panel panel-default">
							<div className="panel-heading">Connection Status</div>
							<div className="panel-body">
								<p>Gmail is not connected yet.</p>
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
