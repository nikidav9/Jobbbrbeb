#!/bin/bash
# One-time read-only network inventory for adding JobToo's secondary public IP.
# bootstrap.sh runs this as root; the report deliberately excludes secrets.
set -u

OUT=/var/www/html/network-ip-diagnostic.txt
TMP=/tmp/jt-network-ip-diagnostic.$$

{
  echo "captured_at=$(date -Is)"
  echo
  echo "== ip -4 -brief address =="
  ip -4 -brief address
  echo
  echo "== ip -4 address =="
  ip -4 address show
  echo
  echo "== ip route =="
  ip route show table main
  echo
  echo "== ip rule =="
  ip rule show
  echo
  echo "== netplan get =="
  netplan get 2>&1 || true
  echo
  echo "== netplan files =="
  for file in /etc/netplan/*.yaml; do
    [ -e "$file" ] || continue
    echo "--- $file (mode $(stat -c %a "$file" 2>/dev/null || echo '?'))"
    sed -n '1,240p' "$file"
  done
  echo
  echo "== cloud-init network ownership =="
  cloud-init status --long 2>&1 || true
  if [ -e /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg ]; then
    echo "--- /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg"
    sed -n '1,80p' /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
  else
    echo "network-config disable file: absent"
  fi
  echo
  echo "== listeners 80/443 =="
  ss -tlnp | grep -E ':(80|443)([[:space:]]|$)' || true
  echo
  echo "== nginx local vhost =="
  curl -ksS -o /dev/null -D - --max-time 10 https://127.0.0.1/ -H 'Host: jobtoo.ru' | sed -n '1,12p'
} > "$TMP" 2>&1

mv -f "$TMP" "$OUT"
chmod 644 "$OUT"
