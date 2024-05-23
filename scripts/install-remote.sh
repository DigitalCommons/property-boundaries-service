#!/usr/bin/env bash

# Run this script locally, to ssh onto a remote server and run the install.sh script, to
# install the app for the first time.

# General usage:
# 
#       bash install-remote.sh [-u <app user>] [-b <branch, default main)>] [<ssh login <user>@<hostname>]
# 
# Example usage, to login to root user on dev-2 (for which we have ssh access), and install the app 
# for the aubergine user:
# 
#       bash install-remote.sh -u aubergine -b development root@dev-2.digitalcommons.coop

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

if [ -z "$app_user" ] || [ -z "$login_user_hostname" ]; then
        echo 'Missing -u <app user> argument' >&2
        exit 1
fi

if [ -n "$*" ]; then
    printf "Unknown parameters: $*\n"
    exit -1
fi

# Echo command with arguments expanded
set -x

# Copy the install.sh script to the remote server
scp scripts/install.sh $login_user_hostname:~$app_user/install.sh

# Run the script
ssh $login_user_hostname "su -l $app_user -c 'bash install.sh $branch'"

# Cleanup
ssh $login_user_hostname "rm ~$app_user/install.sh"
