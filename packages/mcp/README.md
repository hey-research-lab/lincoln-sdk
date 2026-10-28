# @lincolnprotocol/mcp

MCP server that gives an AI agent its own private balance on Robinhood Chain through [Lincoln](https://lincolnprotocol.com). It can hold ETH, dollars and tokenized stocks, and send, swap and withdraw them. Proofs are generated on your machine and a relayer submits them, so the agent's wallet never appears on chain.

```sh
# 1. Create the agent wallet (encrypted with your passphrase)
export LINCOLN_PASSPHRASE='…'
npx @lincolnprotocol/cli init

# 2. Connect your client
claude mcp add lincoln -e LINCOLN_PASSPHRASE="$LINCOLN_PASSPHRASE" -- npx -y @lincolnprotocol/mcp
codex mcp add lincoln --env LINCOLN_PASSPHRASE="$LINCOLN_PASSPHRASE" -- npx -y @lincolnprotocol/mcp
```

Other clients (Claude Desktop, Cursor and others):

```json
{
  "mcpServers": {
    "lincoln": {
      "command": "npx",
      "args": ["-y", "@lincolnprotocol/mcp"],
      "env": { "LINCOLN_PASSPHRASE": "…" }
    }
  }
}
```

Tools: `lincoln_balance`, `lincoln_address`, `lincoln_pools`, `lincoln_policy`, `lincoln_activity`, `lincoln_status`, `lincoln_points`, `lincoln_quote`, and `lincoln_send` / `lincoln_swap` / `lincoln_withdraw` / `lincoln_deposit`, which take a `quoteId`, never raw amounts.

Spends are checked against `~/.lincoln/policy.json` (per-transaction, daily and approval limits). Those limits are enforced by this software, not by the contracts, so keep only what the agent needs in its balance.

Season points are off unless the user sets `"seasonPoints": true` in `policy.json`; the server never changes it. While on, fee-paying spends name the wallet's points ID and the server posts their receipts every minute. The points service publishes points per ID, so those spends become linkable to each other (not to the public wallet). Points are not tokens and not a promise of payout. Rules: https://docs.lincolnprotocol.com/token/points

Docs: https://docs.lincolnprotocol.com/developers/agents · Source: https://github.com/lincoln-protocol/sdk · Terms: https://docs.lincolnprotocol.com/legal/terms
