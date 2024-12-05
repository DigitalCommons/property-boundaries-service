#!/usr/bin/env bash

# You probably don't want to run this script directly. The install-remote.sh script copies this file
# to the required server and runs it there to install the app for the first time.
#
# Note that before running this script, the user's DBUS session must have already been started using
# 'machinectl shell' so that the bus socket file exists.

set -e

# Ensure that asdf is initialised and in the PATH
. /opt/asdf/asdf.sh
. /opt/asdf/completions/asdf.bash

# Generate a new SSH key for the deploy key if it doesn't already exist
if [ ! -f ~/.ssh/id_rsa.pub ]; then
    ssh-keygen -t rsa -b 4096 -C "$USER@$HOSTNAME" -q -N ""
fi

cat << EOF
For the rest of this script to work, the following public key must be added as a deploy key with read-only access to the property-boundaries-service Github repository:

$(cat ~/.ssh/id_rsa.pub)

Add the deplopy key here:
https://github.com/DigitalCommons/property-boundaries-service/settings/keys
EOF

cd ~
ssh-keyscan -t rsa github.com >> ~/.ssh/known_hosts
git -C property-boundaries-service pull || git clone git@github.com:DigitalCommons/property-boundaries-service.git
cd property-boundaries-service

# If branch was inputted as argument, check it out
if [ ! -z "$1" ]; then
    git checkout $1
fi

# Install Node and PM2
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf install nodejs 20.8.1
asdf global nodejs 20.8.1
npm install pm2 -g

loginctl enable-linger $USER

# Set up systemd service so PM2 starts on system reboot
mkdir -p ~/.config/systemd/user/
# Remove any old config
rm -f ~/.config/systemd/user/pm2.service

cat > ~/.config/systemd/user/pm2.service << EOF
[Unit]
Description=PM2 process manager for %u
Documentation=https://pm2.keymetrics.io/
After=network.target

[Service]
Type=forking
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:%h/.asdf/installs/nodejs/20.8.1/bin:/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
Environment=PM2_HOME=%h/.pm2
Environment=ASDF_DIR=/opt/asdf
PIDFile=%h/.pm2/pm2.pid
Restart=on-failure

ExecStart=bash -c '. $ASDF_DIR/asdf.sh && npx pm2 resurrect'
ExecReload=bash -c '. $ASDF_DIR/asdf.sh && npx pm2 reload all'
ExecStop=bash -c '. $ASDF_DIR/asdf.sh && npx pm2 kill'

[Install]
WantedBy=default.target
EOF

export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UID/bus"
systemctl --user enable pm2
systemctl --user start pm2

echo "The app has been successfully installed. Set the environment variables in .env and then deploy with scripts/deploy.sh."
