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

* Install vagrant on your host machine https://www.vagrantup.com/
* Clone this git repo to your local computer.
* By default, the Nailbox VM will listens to port 3000. If you want to change
  that port to another value, edit the Vagrantfile.
* Go into the directory where the vagrant file is, and run `vagrant up` on your
  host machine. This will create a virtual machine aka your "guest machine".
* SSH into the newly created guest machine by running `vagrant ssh`
* Install nodejs on your guest machine by running:
  * `curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -`
  * `sudo apt-get install -y nodejs`
* Install yarn (an alternative to npm that works better in VirtualBox because
  it handles symlinks differently) by running:
  * `curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -`
  * `echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list`
  * `sudo apt-get update && sudo apt-get install -y yarn`
* Change into the nailbox directory by running `cd /home/vagrant/nailbox` on
  your guest machine.
* Install all of Nailbox's dependencies by running `yarn install`
  (or `yarn install --no-bin-links` if your host OS is Windows or otherwise has
  problems with symlinks) on your guest machine.
* Start the server by running `node main.js` on your guest machine.
* Open http://localhost:3000 in your webbrowser on your host machine (or
  whatever port you chose if you changed the setting in the vagrant file).
