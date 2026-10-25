# Nailbox

The world's second best e-mail client. (Inspired by Mailbox)

![Screencast from 2016-Feb-08](http://i.imgur.com/SMVtrpD.gif=955x471)

## What makes it so great?

![Screenshot showing "Later" button](http://i.imgur.com/vZyYYP0.png)

Mailbox-style "Show me this e-mail later"

## Can I use this right now?

The software is in an extremely early beta.

* It's not easy to set up.
* It may contain bugs that permanently delete all your e-mails.
* It may contain bugs that permanently delete all the files on your computer.
* It may contain bugs that causes it to forward all your e-mails to everyone on your contact list, airing all your dirty laundry.
* It may contain security flaws allowing anyone on the internet to gain access to your gmail account.

## I didn't read anything in the above section. How do I use it?

Nailbox is a Node.js server with a browser front end. You need Node.js (the
test suite was last run on Node.js 26) and npm, which ships with Node.js.

The steps below use the Vagrant virtual machine included in this repo. If you
already have a Node.js machine, skip to "Install and run" and run the same
commands there.

### Option A: Vagrant virtual machine

* Install [VirtualBox](https://www.virtualbox.org/) and
  [Vagrant](https://www.vagrantup.com/) on your host machine.
* Clone this git repo to your local computer.
* In the repo directory, run `vagrant up`. This creates the guest machine and
  syncs the repo into it at `/home/vagrant/nailbox`.
* Run `vagrant ssh` to open a shell in the guest machine.
* Change into the synced directory with `cd /home/vagrant/nailbox`.
* Install Node.js on the guest machine. The `apt` package is often too old, so
  use [nodejs.org](https://nodejs.org/) or [nvm](https://github.com/nvm-sh/nvm).

### Install and run

* Install the dependencies with `npm install`.
* Build the frontend bundle with `npm run build:frontend`. Rebuild after
  changing anything in `src/frontend`, or use `npm run dev:frontend` to rebuild
  on every change.
* Start the server with `npm start`.
* Open http://localhost:3000 in your web browser on your host machine. The
  first visit opens the setup page, which walks you through connecting Gmail.

The server reads its settings from `data/config.json`. The port defaults to
3000. If you change it, also change the forwarded port in the Vagrantfile so
the host can still reach the server.

### Development

* `npm run dev` restarts the server whenever a server-side file changes.
* `npm test` runs the test suite.
* `npx tsc -p tsconfig.json` type-checks the project.
