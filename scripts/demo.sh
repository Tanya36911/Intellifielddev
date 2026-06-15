#!/usr/bin/env bash
# A foolproof live demo of the security boundary ("who can see what").
# Run from the project folder, with the backend running (docker compose up -d):
#   bash scripts/demo.sh
set -euo pipefail
API=http://localhost:8000

login() {
  curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"demo1234\"}" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"
}

show() {
  local who="$1" email="$2" token
  token=$(login "$email")
  echo "----------------------------------------------------------------"
  echo "$who"
  echo "   ($email)"
  curl -s "$API/nodes" -H "Authorization: Bearer $token" | python3 -c \
"import sys,json;d=json.load(sys.stdin);print('   org tree visible:', d['count'], 'place(s) ->', ', '.join(sorted(n['name'] for n in d['nodes'])) or '(none)')"
  curl -s "$API/skus" -H "Authorization: Bearer $token" | python3 -c \
"import sys,json;d=json.load(sys.stdin);print('   products visible:', d['count'])"
}

echo "================================================================"
echo " INTELLI: who can see what (live, from the real backend)"
echo "================================================================"
show "Dana   - HQ admin of Lumen Beauty"        "dana@lumenbeauty.com"
show "Sarah  - manager of ONE region (Central)" "sarah@lumenbeauty.com"
show "Marcus - field rep (Bay Area stores)"     "marcus@lumenbeauty.com"
show "Avery  - admin of a DIFFERENT company"    "avery@acme.com"
echo "----------------------------------------------------------------"
echo " The point: Sarah and Marcus see only their own slice of Lumen,"
echo " and Avery (another company) sees ZERO of Lumen's data. That is"
echo " what lets many brands safely share one system."
echo "================================================================"
