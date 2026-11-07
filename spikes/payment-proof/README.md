# Run the P1 wallet experiment

This isolated page tests two distinct payer accounts approving one immutable Devnet USDC payment. P1 remains incomplete until two real prompts and a finalized seller payment are recorded in [the evidence file](../../docs/evidence/payment-proof.md).

## Inspect a wallet before preparing a payment

Use Node `25.9.0` and npm. Run these commands from this directory.

```sh
npm ci --ignore-scripts
npm run check
npm run proof -- serve --port 4317
```

Open `http://127.0.0.1:4317` in the selected Chrome profile. The initial page needs no payer addresses, configuration file, or payment attempt. It lists registered Wallet Standard wallets. **Connect wallet** displays the selected public account, chains, features, and legacy sign-only support. It requests no transaction signature.

Use the current profile sequentially with two distinct payer accounts, or open each invitation in an independent profile. Record the arrangement actually tested. Wallet Standard discovery and connection do not establish transaction-signing compatibility. This spike has no automatic injected-provider fallback and never calls sign-and-send.

## Prepare the fixed payment

1. Prepare two distinct Devnet payer wallets and a separate seller wallet in their wallets. Fund both payer token accounts with test USDC and the organizer with test SOL. Create all required ordinary Token Program token accounts beforehand. Keep every wallet key and recovery phrase outside this experiment.
2. Copy the following public plan to `.private/payment.config.json`. Replace every placeholder with a public address. The sample pays four test USDC in two equal contributions.

```json
{
  "network": "devnet",
  "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "decimals": 6,
  "tokenProgram": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "sellerWallet": "<SELLER_WALLET>",
  "sellerTokenAccount": "<SELLER_USDC_ACCOUNT>",
  "feePayer": "<PAYER_ZERO_WALLET>",
  "total": "4000000",
  "contributions": [
    { "slot": 0, "wallet": "<PAYER_ZERO_WALLET>", "sourceTokenAccount": "<PAYER_ZERO_USDC_ACCOUNT>", "units": "2000000" },
    { "slot": 1, "wallet": "<PAYER_ONE_WALLET>", "sourceTokenAccount": "<PAYER_ONE_USDC_ACCOUNT>", "units": "2000000" }
  ]
}
```

3. Set `SOLANA_RPC_URL` privately if using a provider. The default is the public Devnet endpoint. No RPC URL enters browser assets, invitations, or public reports.
4. Connect both intended accounts before preparing. A fresh blockhash has a short lifetime. Run the following command once setup is ready.

```sh
npm run proof -- prepare --config .private/payment.config.json --port 4317
```

Preparation checks the Devnet genesis, the fixed Circle mint, token-account owners and states, balances, and the actual message fee estimate. It rejects delegated, native, close-authority, frozen, and extension token accounts. The message format supports direct signatures by the two expected payer authorities. Equal shares use integer units. Slot zero receives an odd remainder and pays the SOL fee.

The command stores one frozen message and disposable local role tokens in `.private/proof.sqlite`. It exports private invitations to `.private/proof.sqlite.invitations.json`. The SQLite file is authoritative. Repeating the same preparation re-exports its existing tokens and message. A different plan fails. An interruption before invitation export does not require a new payment.

The state directory requires mode `0700`. SQLite and invitation files use mode `0600`. These local capabilities are spike-only authorization, not production wallet authentication. Never share or commit the private directory.

## Approve and submit

1. Open payer zero's private invitation. The page removes the URL fragment and retains that invitation in this tab's session storage. Check the displayed plan against the reviewed public configuration.
2. Connect the expected account. Select **Approve my contribution**. The browser validates the full message before one sign-only prompt. The coordinator independently verifies the returned Ed25519 signature.
3. Verify that submit remains disabled with one approval. Select **Check first-signature refusal**. Only an explicit RPC signature-verification error counts as refusal. An unrelated simulation failure is inconclusive. Simulation never broadcasts.
4. Open payer one's invitation in the same profile after switching to the second distinct account, or in its independent profile. Connect that account and approve separately. Compare both displayed message hashes.
5. Return to payer zero's invitation. Select **Check this transaction** to reload its durable state. **Submit this transaction once** becomes available only when both valid signatures are stored.
6. Submit once, then check the same transaction until a finalized receipt or a clearly unresolved outcome appears.

Each wallet receives the original unsigned transaction, never the other payer's signature. An account event invalidates in-flight results, including switching away and back. Only wallet-reported code `4001` is classified as rejection. Other provider failures do not claim a user decline.

The coordinator persists complete signed bytes and their derivable transaction reference before claiming dispatch. It invokes the application send operation at most once. Repeated submission and process restarts reconcile that reference. A crash after dispatch claim and before the send can leave an unsent experiment unresolved. This bounded P1 behavior deliberately does not implement P4 recovery leases or rebroadcast.

No action replaces a message, refreshes its blockhash, or reuses approvals for a different payment. Expiry without finalized evidence remains unresolved. A decline preserves issued authorizations. A receipt requires finalized status, exact signed-transaction identity, exact payer and seller token deltas, and the organizer's actual fee delta.

## Restart and export public evidence

Restart the same serve command against the same state file. To use a different path, pass `--state <private-directory>/proof.sqlite` consistently to prepare, serve, and report.

```sh
npm run proof -- report --out .private/public-report.json
```

Inspect that public report before sharing it. Its explicit projection excludes raw signatures, signable and signed transaction bytes, role tokens, and RPC credentials. It includes only public payment details, hashes, approval timestamps, diagnostics, status, and any verified receipt. Record browser and extension versions separately. `walletStandardVersion` describes the interface, not the installed extension version.

Local tests use clearly synthetic ephemeral keys. They establish transaction, persistence, and boundary behavior. They do not establish real browser-wallet acceptance, live balance changes, or Postgres recovery.
