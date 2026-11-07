const messages = {
  CONFIG_INVALID: 'Configuration is invalid. Use a public Devnet plan and a valid private server RPC URL.',
  RPC_UNAVAILABLE: 'Devnet RPC is unavailable. Check connectivity and the configured provider.',
  WRONG_NETWORK: 'The RPC genesis does not match Solana Devnet.',
  MINT_INVALID: 'The configured Devnet USDC mint has an unsupported owner, layout, or decimal count.',
  TOKEN_ACCOUNT_MISSING: 'A required prepared token account is missing.',
  TOKEN_ACCOUNT_INVALID: 'A token account has an unexpected owner, mint, state, delegation, or layout.',
  INSUFFICIENT_USDC: 'A payer has insufficient Devnet USDC for its exact contribution.',
  INSUFFICIENT_SOL: 'The organizer needs enough Devnet SOL for the estimated transaction fee.',
  FEE_UNAVAILABLE: 'The RPC could not estimate the fixed message fee. Its blockhash may have expired.',
  IMMUTABLE_CONFLICT: 'This state file already contains a different immutable payment plan.',
  MESSAGE_EXPIRED: 'The staged message expired. This experiment cannot collect approvals or create a replacement.',
} as const;
export class ProofFailure extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); }
}
