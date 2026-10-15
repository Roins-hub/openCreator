#!/usr/bin/env bash
# 安装每日备份:补上存储桶的 backups/ 过期规则,立即备份一次,再启用定时器。
set -euo pipefail
cd /opt/mote
sudo bash -c 'set -a; . /etc/mote/storage.env; set +a; MOTE_STORAGE_ROOT=/opt/mote-data node scripts/backup-data.mjs --lifecycle'
sudo cp deploy/mote-backup.service deploy/mote-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start mote-backup.service
sudo systemctl --no-pager --lines=5 status mote-backup.service | tail -5
sudo systemctl enable --now mote-backup.timer
systemctl list-timers --no-pager mote-backup.timer | head -3
sudo bash -c 'set -a; . /etc/mote/storage.env; set +a; node scripts/backup-data.mjs --list'
