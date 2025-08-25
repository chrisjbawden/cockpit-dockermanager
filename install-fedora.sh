#!/bin/bash
# cockpit-dockermanager-install.sh
# Quick installer for Fedora/RHEL systems

set -e

echo "🐳 Installing cockpit-dockermanager for Fedora..."

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "Don't run this script as root. It will ask for sudo when needed."
   exit 1
fi

# Install zstd if needed (required for extraction)
if ! command -v zstd &> /dev/null; then
    echo "Installing zstd..."
    sudo dnf install -y zstd >/dev/null 2>&1 || {
        echo "Failed to install zstd"
        exit 1
    }
fi

# Install binutils if needed (required for ar command)
if ! command -v ar &> /dev/null; then
    echo "Installing binutils..."
    sudo dnf install -y binutils >/dev/null 2>&1 || {
        echo "Failed to install binutils"
        exit 1
    }
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Download and extract
echo "Downloading dockermanager..."
curl -sL -o dockermanager.deb https://github.com/chrisjbawden/cockpit-dockermanager/releases/download/latest/dockermanager.deb || {
    echo "Failed to download"
    exit 1
}

echo "Extracting..."
ar x dockermanager.deb
tar xf data.tar.zst

# Install
echo "Installing..."
sudo cp -r usr/share/cockpit/dockermanager /usr/share/cockpit/
sudo chown -R root:root /usr/share/cockpit/dockermanager
sudo chmod -R 644 /usr/share/cockpit/dockermanager
sudo find /usr/share/cockpit/dockermanager -type d -exec chmod 755 {} \;

# Restart cockpit
echo "Restarting cockpit..."
sudo systemctl restart cockpit

# Cleanup
cd /
rm -rf "$TEMP_DIR"

echo "Done."
