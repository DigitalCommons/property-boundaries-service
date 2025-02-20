#!/usr/bin/env bash

# Run this script locally, to ssh onto a remote server and run the install.sh script, to
# install the app for the first time. It also sets up a reverse proxy so the app is available at
# https://<domain>/api

# General usage:
# 
#       bash scripts/install-remote.sh [-u <app user>] [-b <branch, default main)>] [-d <domain>] [<ssh login user>@<hostname>]
# 
# Example usage, to login to root user on dev-2 (for which we have ssh access), and install the app 
# for the aubergine user:
# 
#       bash scripts/install-remote.sh -u aubergine -b development -d propertyboundaries.landexplorer.coop root@dev-2.digitalcommons.coop

set -e

branch=main

# Parse options
while getopts "u:b:" OPTION
do
    case $OPTION in
        u)
	    app_user="$OPTARG"
            ;;
        b)
	    branch="$OPTARG"
            ;;
        d)
	    domain="$OPTARG"
            ;;
         ?)
         printf "invalid option '$OPTION', stopping\n" >&2
         exit 1
         ;;
    esac
done

# remove the options from the argument list
shift $((OPTIND-1))

# Get positional argument
login_user_hostname=$1

# remove the positional argument
shift 1

if [ -z "$app_user" ] ; then
    echo 'Missing -u <app user> argument' >&2
    exit 1
elif [[ -z "$login_user_hostname" ]]; then
    echo 'Missing <ssh login user>@<hostname> argument' >&2
    exit 1
elif [[ -z "$domain" ]]; then
    echo 'Missing -d <domain> argument' >&2
    exit 1
fi

if [ -n "$*" ]; then
    printf "Unknown parameters: $*\n"
    exit -1
fi

# Echo command with arguments expanded
set -x

# Copy the install.sh file to the remote server
scp scripts/install.sh $login_user_hostname:~$app_user/install.sh

# Before running the script, we need to start the user's DBUS session in order for the install
# script to be able to set up the systemd service. We do that be invoking the machinectl shell (and
# /bin/true just does nothing). This requires sudo privileges, so if the login user is not root,
# you need to grant them permission to run machinectl using PolKit rules.
ssh $login_user_hostname "machinectl shell $app_user@ /bin/true"

# Run the script
ssh $login_user_hostname "su -l $app_user -c 'bash install.sh $branch'"

# Cleanup install.sh file
ssh $login_user_hostname "rm ~$app_user/install.sh"

# Set up reverse proxy
# Note this requires the login user to have root or www-data permissions
ssh $login_user_hostname "rm -f /var/www/vhosts/$domain/custom.conf"
echo -e "ProxyPass /api http://localhost:4000\nProxyPassReverse /api http://localhost:4000" | ssh $login_user_hostname -T "cat > /var/www/vhosts/$domain/custom.conf"
