const messages = {
  CONFIG_INVALID: 'Configuration is invalid. Use a public Devnet plan and a valid private server RPC URL.',
  RPC_UNAVAILABLE: 'Devnet RPC is unavailable. Check connectivity and the configured provider.',
  IMMUTABLE_CONFLICT: 'This state file already contains a different immutable payment plan.',
  MESSAGE_EXPIRED: 'The staged message expired. This experiment cannot collect approvals or create a replacement.',
} as const;
export class ProofFailure extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); }
}
