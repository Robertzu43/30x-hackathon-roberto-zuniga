#!/usr/bin/env bash
[ -f .env ] && { set -a; . ./.env; set +a; }  # local laptop: load .env (gitignored); cloud session: env config instead
# Agent Toolkit for AWS: steps 2-6 of
# https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup.md
# Run ONCE in the cloud session (or on your laptop). Roberto completes the browser sign-in.
# Usage: AWS_PROFILE_NAME=<profile> bash scripts/aws-setup.sh
set -u
PROFILE="${AWS_PROFILE_NAME:?set AWS_PROFILE_NAME}"
REGION="us-east-2"            # project Region (new AWS experience): all regional resources go here
TOOLKIT_REGION="us-east-1"    # Agent Toolkit service lives only here

echo "== Step 1: OS"; uname -s
echo "== Prereqs: curl + uv"
command -v curl >/dev/null || { echo "curl missing"; exit 1; }
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
curl -sI -m 10 https://awscli.amazonaws.com >/dev/null || { echo "cannot reach awscli.amazonaws.com; ask an org owner to allow it"; exit 1; }

echo "== Step 2: AWS CLI v2"
aws --version 2>/dev/null || { curl -fsSL 'https://awscli.amazonaws.com/v2/install.sh' | bash; }
grep -q '.local/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
aws --version

echo "== Step 3: login (browser). Headless session: a URL is printed, open it on your phone/laptop."
aws configure set region "$REGION" --profile "$PROFILE"
if [ "$(uname -s)" = "Darwin" ]; then  # laptop: browser login; Linux cloud session: --remote prints a URL for the phone
  aws login --region "$REGION" --profile "$PROFILE"
else
  aws login --region "$REGION" --profile "$PROFILE" --remote
fi

echo "== Step 4: verify"
aws sts get-caller-identity --profile "$PROFILE" || { echo "login did not complete; re-run"; exit 1; }
echo "Credentials valid 12h, renewable 90 days without the browser."

echo "== Step 5: Agent Toolkit (interactive wizard)"
aws configure agent-toolkit --yes --region "$TOOLKIT_REGION" --profile "$PROFILE"

echo "== Step 5b: point aws-mcp at profile $PROFILE in every MCP config the wizard touched"
python3 - "$PROFILE" <<'PY'
import json,sys,os,glob
prof=sys.argv[1]
cands=[os.path.expanduser(p) for p in ["~/.claude.json","~/.claude/settings.json",".mcp.json",".claude/settings.json",".claude/settings.local.json"]]
for p in cands:
    if not os.path.exists(p): continue
    try: d=json.load(open(p))
    except Exception: continue
    srv=d.get("mcpServers",{}).get("aws-mcp")
    if not srv: continue
    env=srv.setdefault("env",{}); cur=env.get("AWS_MCP_PROXY_PROFILES","").split()
    if prof not in cur: env["AWS_MCP_PROXY_PROFILES"]=" ".join(cur+[prof])
    json.dump(d,open(p,"w"),indent=2); print("updated",p)
PY
echo "To add another AWS project later: aws login --profile <name>, append it to AWS_MCP_PROXY_PROFILES, restart Claude Code."

echo "== Step 6: verify toolkit"
aws agent-toolkit list-available-skills --region "$TOOLKIT_REGION" --profile "$PROFILE" | head -40

echo "== Step 7: rules already merged into CLAUDE.md (marked block). Done. Start a NEW session so the skills and MCP server load."
