#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 is required" >&2
  exit 1
fi

PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
id netsentinel-agent >/dev/null 2>&1 || useradd --system --home /var/lib/netsentinel-agent --shell /usr/sbin/nologin netsentinel-agent
install -d -o netsentinel-agent -g netsentinel-agent -m 0750 /var/lib/netsentinel-agent
install -d -o root -g root -m 0755 /opt/netsentinel-agent
cp -R "$PACKAGE_DIR/dist" "$PACKAGE_DIR/node_modules" "$PACKAGE_DIR/package.json" /opt/netsentinel-agent/
install -o root -g root -m 0644 "$PACKAGE_DIR/netsentinel-agent.service" /etc/systemd/system/netsentinel-agent.service

if [ ! -f /etc/netsentinel-agent.env ]; then
  install -o root -g root -m 0600 /dev/null /etc/netsentinel-agent.env
  printf '%s\n' 'NETSENTINEL_SERVER_URL=wss://sentinel.example.com/agent/v1/connect' 'NETSENTINEL_AGENT_ID=replace-me' 'NETSENTINEL_AGENT_TOKEN=replace-me' > /etc/netsentinel-agent.env
fi

systemctl daemon-reload
systemctl enable netsentinel-agent.service
echo "Edit /etc/netsentinel-agent.env, then run: systemctl restart netsentinel-agent"
