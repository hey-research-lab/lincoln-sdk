# @lincolnprotocol/cli

`lincoln`: a private balance on Robinhood Chain from the command line, for people and AI agents. Built on [Lincoln](https://lincolnprotocol.com), a privacy pool for ETH, dollars and tokenized stocks.

```sh
npm i -g @lincolnprotocol/cli
export LINCOLN_PASSPHRASE='…'   # encrypts the agent key; required on mainnet
lincoln init                     # creates ~/.lincoln/mainnet/agent.json and ~/.lincoln/policy.json
lincoln address                  # lincoln3:… address to fund privately from the Lincoln app
lincoln balance --json
lincoln quote swap 100 usdg nvda --json
lincoln execute q_…
lincoln withdraw 0.1 eth 0xabc… --to base
lincoln points --json            # LINCOLN season points (opt-in: "seasonPoints": true in policy.json)
```

Every spend is quote → confirm → execute, checked against `~/.lincoln/policy.json`. `--json` prints machine-readable output for agents.

Season points are off unless the user sets `"seasonPoints": true` in `~/.lincoln/policy.json`. While on, fee-paying spends name the wallet's points ID, which makes them linkable to each other (not to the public wallet) because the points service publishes points per ID. Points are not tokens and not a promise of payout. Rules: https://docs.lincolnprotocol.com/token/points

Docs: https://docs.lincolnprotocol.com/developers/agents · Source: https://github.com/lincoln-protocol/sdk · Terms: https://docs.lincolnprotocol.com/legal/terms
