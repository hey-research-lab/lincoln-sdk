# @lincolnprotocol/sdk

TypeScript SDK (Node 20+) for [Lincoln](https://lincolnprotocol.com), a privacy pool on Robinhood Chain. It gives an agent or app a private balance of ETH, dollars and tokenized stocks. Zero-knowledge proofs are generated locally and a relayer submits them.

```ts
import { Lincoln } from '@lincolnprotocol/sdk';

const agent = await Lincoln.open();              // reads ~/.lincoln, unlocks with LINCOLN_PASSPHRASE
console.log(await agent.balances());
const q = await agent.quoteSwap({ from: 'usdg', to: 'nvda', amount: '100' });
const r = await agent.execute(q.id);             // { txHash, jobId, explorer, message }
```

Season points are opt-in (`"seasonPoints": true` in `~/.lincoln/policy.json`, set by the user): `agent.points()` shows the points ID and standing, `agent.collectPoints()` posts pending receipts. See the [repo README](https://github.com/lincoln-protocol/sdk#season-points-opt-in) for the privacy trade-off. Points are not tokens and not a promise of payout.

Pool profiles, swap routes and circuit pins ship with the package, so a relay can't redirect funds. Create the wallet with `npx @lincolnprotocol/cli init`.

Docs: https://docs.lincolnprotocol.com/developers/agents · Source: https://github.com/lincoln-protocol/sdk · Terms: https://docs.lincolnprotocol.com/legal/terms
