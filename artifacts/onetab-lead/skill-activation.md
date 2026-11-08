# Skill activation

Playbook: Figure It Out, from the host pstack install.

pstack skill path: `/home/ubuntu/.cursor/plugins/cache/cursor-public/9717366/ae5650febf4320793844c12c4adaa937f417f8da/skills/poteto-mode/SKILL.md`

Figure It Out path: `/home/ubuntu/.cursor/plugins/cache/cursor-public/9717366/ae5650febf4320793844c12c4adaa937f417f8da/skills/figure-it-out/SKILL.md`

Routed skills read from that same plugin tree: show-me-your-work, no-comments. deslop was not in the plugin tree. The official body was read from `https://raw.githubusercontent.com/cursor/plugins/main/cursor-team-kit/skills/deslop/SKILL.md`, sha256 `2f7b7def74af7ed11f5b44b4d32f0f91fca8c5d1f92bf2171e8d12fd33a0f810`.

Solana skill: official `solana-foundation/solana-dev-skill` file `skills/solana-dev/SKILL.md`, on-disk copy `/tmp/solana-dev-skill/SKILL.md`, sha256 `a0b75a296d408f2b88bf45b6633b4944f5ed00cde2bbb080c7f74b695d35d93a`. Published revision recorded for that copy: commit `c9da2624cc6baca5c8c2123ea50d92ef19f1c917`, blob `475e064169d6a96f588b3426c9344b245f16024e`. Applied guidance is legacy messages, store the signature before submit, finalized confirmation, SPL Token TransferChecked, and devnet only. `maxSupportedTransactionVersion` stays 0 because `src/lib/payments/payment-core.ts` builds legacy messages and `src/server/payments/rpc.ts` still requests version 0. No targeted decoder change was made.

Card: P4 resolution expiry, with the P3 runtime composition required to call it. Branch `cursor/p4-resolution-expiry-ee39` from main `68333265c423d3da33245acca98766fb59bc3604`.

Verification intended: Payments unit tests, `npm run check` on Node `v24.22.1` at `/home/ubuntu/.nvm/versions/node/v24.22.1/bin/node`, and a disposable local PostgreSQL 16 plus PostgREST 16.5 run. P5 and P6 hosted wallet acceptance stays NOT RUN.

The owner required Grok only. Cross-family trail review was not run. Comment review used grok-4.7 and found no comments to delete.
