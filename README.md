<!-- Banner -->
<p align="center">
  <img src=".github/banner.svg" alt="arbitrum-usdg-examples" width="100%">
</p>

<!-- Badges -->
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-22.13+-339933.svg?style=flat-square" alt="Node 22.13+"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6.svg?style=flat-square" alt="TypeScript"></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-16-000000.svg?style=flat-square" alt="Next.js 16"></a>
  <a href="https://viem.sh/"><img src="https://img.shields.io/badge/viem-2.x-1B1B1F.svg?style=flat-square" alt="viem 2"></a>
  <a href="https://arbitrum.io/products/usdg-on-arbitrum"><img src="https://img.shields.io/badge/USDG-Arbitrum%20One-12AAFF.svg?style=flat-square" alt="USDG on Arbitrum One"></a>
  <a href="#contributing"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome"></a>
</p>

<!-- One-liner + nav -->
<p align="center">
  <strong>Runnable examples for building with USDG, the Global Dollar issued by Paxos, on Arbitrum One.</strong>
  <br>
  <a href="https://arbitrum.io/products/usdg-on-arbitrum">USDG on Arbitrum</a> · <a href="#quick-start">Quick Start</a> · <a href="https://github.com/hummusonrails/arbitrum-usdg-examples/issues">Report a Bug</a>
</p>

> [!IMPORTANT]
> These are demonstration apps and unaudited example code. Use them to learn the integration patterns, not to manage real funds as they are.

## What it does

- **Shows** the four ways a business can put USDG to work on Arbitrum, one runnable example per path.
- **Runs** every example locally with one command, on a fork of Arbitrum One and a local stand in for the Paxos API, so you need no accounts or funds to explore.
- **Connects** to the Paxos sandbox and Arbitrum Sepolia when you are ready to try the real APIs.
- **Uses** the real USDG contract on Arbitrum and the documented Paxos v2 API, with a typed client generated from the Paxos OpenAPI spec.
- **Proves** each flow end to end with tests that drive the running app, the chain, and the Paxos stand in together.

## Examples

| Path | What you build | Status |
|:-----|:---------------|:-------|
| [Sample business treasury](examples/sample-business-treasury) | A simulated treasury app for a fictional company: mint USD into USDG, redeem USDG back to the bank, keep a wallet inside a balance band, and reconcile every Paxos record against Arbitrum | Available |
| Embedded Earn | Offer an earn experience by registering customer wallets into payout groups and claiming rewards on a schedule, plus signed batch payouts | Coming soon |
| Perp DEX margin | Accept USDG as margin in a vault registered for rewards through the propose and accept flow | Coming soon |
| Spot DEX quote asset | Use USDG as a quote asset in pools, route rewards to liquidity providers, and move USDG cross chain with LayerZero | Coming soon |

## Quick Start

```bash
git clone https://github.com/hummusonrails/arbitrum-usdg-examples.git
cd arbitrum-usdg-examples
pnpm install
pnpm --filter sample-business-treasury dev:mock
```

Open the address it prints (http://127.0.0.1:3000). Mock mode starts a fresh fork of Arbitrum One, a local Paxos stand in, the setup step, and the dashboard. A short tour walks you through each action the first time.

## Stack

| Layer | Tool | Notes |
|:------|:-----|:------|
| Chain | Arbitrum One, Arbitrum Sepolia | USDG `0x004B506865409877C9fA29bfb1ebA929984B9bbC` on Arbitrum One |
| Stablecoin platform | Paxos v2 API | Orchestrations, deposit addresses, events, and webhooks |
| App | Next.js 16, React 19, Tailwind 4 | Pages and server routes in one app |
| Chain client | viem 2 | Reads, signed transfers, and log decoding |
| Storage | SQLite (`node:sqlite`) | Built into Node, no extra service |
| Local chain | Foundry Anvil | Forks Arbitrum One for mock mode and tests |

<details>
<summary><strong>Prerequisites</strong></summary>

- [Node.js](https://nodejs.org/) 22.13 or newer
- [pnpm](https://pnpm.io/installation) 10
- [Foundry](https://book.getfoundry.sh/getting-started/installation) for `anvil`
- For sandbox mode: a [Paxos sandbox account](https://dashboard.sandbox.paxos.com) and test ETH on Arbitrum Sepolia

</details>

## Project structure

```text
arbitrum-usdg-examples/
├── packages/
│   ├── usdg/              USDG addresses, ABI, exact amount helpers, wallet health
│   └── paxos-client/      Typed Paxos v2 client generated from the OpenAPI spec
└── examples/
    └── sample-business-treasury/
        ├── app/           Next.js app, treasury server logic, setup scripts
        ├── mock-paxos/    Local Paxos stand in that moves real USDG on a fork
        └── e2e/           End to end tests for the whole stack
```

## Testing

```bash
pnpm --filter sample-business-treasury-e2e test
```

The suite builds the app, starts a fresh fork of Arbitrum One with the Paxos stand in, and drives mints, redeems, the auto mint rule, restarts, and failure handling through the app's API while checking balances on chain.

## Learn more

- [USDG on Arbitrum](https://arbitrum.io/products/usdg-on-arbitrum)
- [USDG developer guide from Paxos](https://docs.paxos.com/guides/stablecoin/usdg)
- [Paxos orchestrations](https://docs.paxos.com/guides/developer/orchestrations/mint)
- [USDG vaults with DRIP incentives](https://arbitrumdrip.com/opportunities)

USDG is issued by Paxos on behalf of the Global Dollar Network. The USDG on Arbitrum ecosystem program is offered by the Arbitrum Foundation to eligible businesses under a separate agreement. Holding USDG does not earn rewards.

## Contributing

Found a bug or want to add an example? [Open an issue](https://github.com/hummusonrails/arbitrum-usdg-examples/issues) or send a pull request.

## License

[MIT](LICENSE)
