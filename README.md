# Nailbox

The world's second best e-mail client. (Inspired by Mailbox)

![Screencast from 2016-Feb-08](http://i.imgur.com/SMVtrpD.gif =955x471)

## Can I use this right now?

The software is in an extremely early beta.

* It's not easy to set up.
* It may contain bugs that permanently delete all your e-mails.
* It may contain bugs that permanently delete all the files on your computer.
* It may contain bugs that causes it to forward all your e-mails to everyone on your contact list, airing all your dirty laundry.
* It may contain security flaws allowing anyone on the internet to gain access to your gmail account.

## I didn't read anything in the above section. How do I use it?

* Install vagrant on your host machine https://www.vagrantup.com/
* Clone this repo to your local computer.
* By default, the Nailbox VM will listens to port 3000. If you want to change
  that port to another value, edit the Vagrantfile.
* Go into the directory where the vagrant file is, and run `vagrant up` on your
  host machine. This will create a virtual machine aka your "guest machine".
* SSH into the newly created guest machine by running `vagrant ssh`
* Install nodejs on your guest machine by running:
  * `curl -sL https://deb.nodesource.com/setup_5.x | sudo -E bash -`
  * `sudo apt-get install -y nodejs`
  * If your host machine is running Windows, disable symlinks in npm by running `npm config set bin-links false` in your guest machine.
* Change into the nailbox directory by running `cd /home/vagrant/nailbox` on your guest machine.
* Install all of Nailbox's dependencies by running `npm install` on your guest machine.
* Start the server by running `node main.js` on your guest machine.
* Open http://localhost:3000 in your webbrowser on your host machine (or
  whatever port you chose if you changed the setting in the vagrant file).
