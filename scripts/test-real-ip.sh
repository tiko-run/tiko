#!/bin/sh
# Checks the nginx lines that frontend/real-ip.envsh writes, and that it refuses bad values.
set -u
script=$(dirname "$0")/../frontend/real-ip.envsh
out=$(mktemp)
trap 'rm -f "$out"' EXIT
failed=0

expect() {
  if [ "$1" != "$2" ]; then
    printf 'FAIL %s\n--- want\n%s\n--- got\n%s\n' "$3" "$2" "$1"
    failed=1
  fi
}

REAL_IP_CONF=$out sh "$script"
expect "$(cat "$out")" "set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
set_real_ip_from 192.168.0.0/16;
set_real_ip_from 127.0.0.0/8;
set_real_ip_from fc00::/7;
set_real_ip_from ::1;
real_ip_header X-Forwarded-For;
real_ip_recursive on;" "defaults"

REAL_IP_CONF=$out TIKO_TRUSTED_PROXIES='0.0.0.0/0,::/0' TIKO_CLIENT_IP_HEADER=CF-Connecting-IP sh "$script"
expect "$(cat "$out")" "set_real_ip_from 0.0.0.0/0;
set_real_ip_from ::/0;
real_ip_header CF-Connecting-IP;
real_ip_recursive on;" "set values"

for bad in '10.0.0.0/8; include /etc/passwd' '10.0.0.0/8,evil' 'a b' '*' '999.999.999.999/99' \
  '10.0.0.0/33' '256.0.0.1' '::/129' '10.0.0.0/8,' ',10.0.0.0/8' '10.0.0.0/8,,::1' ','; do
  if REAL_IP_CONF=$out TIKO_TRUSTED_PROXIES=$bad sh "$script" 2>/dev/null; then
    echo "FAIL accepted proxies: $bad"
    failed=1
  fi
done
for bad in 'X-Real-IP;' 'X Real' ''; do
  [ -z "$bad" ] && continue
  if REAL_IP_CONF=$out TIKO_CLIENT_IP_HEADER=$bad sh "$script" 2>/dev/null; then
    echo "FAIL accepted header: $bad"
    failed=1
  fi
done

[ "$failed" = 0 ] && echo "real-ip: ok"
exit "$failed"
