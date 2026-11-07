import { getWallets } from '@wallet-standard/app';
import { z } from 'zod';
import { planSchema, slotSchema } from './payment.js';
import { WalletRejected, WalletSession } from './wallet.js';
import './style.css';

const inviteSchema = z.strictObject({
  id: z.uuid(), slot: slotSchema, capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  plan: planSchema, planHash: z.string().regex(/^[a-f0-9]{64}$/), messageHash: z.string().regex(/^[a-f0-9]{64}$/),
});
function element<T extends HTMLElement>(id: string, kind: { new(): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof kind)) throw new Error('Missing page element');
  return value;
}
const walletSelect = element('wallets', HTMLSelectElement);
const disconnect = element('disconnect', HTMLButtonElement);
const approve = element('approve', HTMLButtonElement);
const submit = element('submit', HTMLButtonElement);
const simulate = element('simulate', HTMLButtonElement);
const refresh = element('refresh', HTMLButtonElement);
const message = element('message', HTMLParagraphElement);
const inventory = element('inventory', HTMLPreElement);
const payment = element('payment', HTMLPreElement);
const invitationKey = 'onetab-p1-invitation';
function captureInvitation(params: URLSearchParams) {
  if (!params.has('invite')) return;
  history.replaceState(null, '', location.pathname);
  sessionStorage.removeItem(invitationKey);
  sessionStorage.setItem(invitationKey, params.get('invite') ?? '');
}
captureInvitation(new URLSearchParams(location.hash.slice(1)));
let invite: z.infer<typeof inviteSchema> | null = null;
let invalidInvitation = false;
try {
  const stored = sessionStorage.getItem(invitationKey);
  invite = stored === null ? null : inviteSchema.parse(JSON.parse(stored));
} catch {
  sessionStorage.removeItem(invitationKey);
  invalidInvitation = true;
}
const navigation = new AbortController();
let activeOperations = 0;
let disconnecting = false;
let state: unknown = null;
const wallets = getWallets();
const session = new WalletSession(() => render());
window.addEventListener('hashchange', () => {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has('invite')) return;
  navigation.abort();
  session.clear();
  captureInvitation(params);
  location.reload();
});

async function api(path: string, method: 'GET' | 'POST' = 'GET', body: unknown = {}): Promise<unknown> {
  navigation.signal.throwIfAborted();
  const response = await fetch(`/api/${path}`, { method, cache: 'no-store', signal: navigation.signal,
    headers: { ...(invite ? { authorization: `Bearer ${invite.capability}` } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('Request rejected. Check account, message lifetime, and current state.');
  const value: unknown = await response.json();
  navigation.signal.throwIfAborted();
  return value;
}
const viewSchema = z.object({
  kind: z.literal('experiment'), id: z.string(), messageHash: z.string(), planHash: z.string(), state: z.string(),
  approvedSlots: z.array(z.object({ slot: slotSchema })),
});
function render() {
  const busy = activeOperations > 0 || navigation.signal.aborted;
  const info = session.inventory();
  inventory.textContent = JSON.stringify(info ?? { availableWallets: wallets.get().map(wallet => ({
    name: wallet.name, walletStandardVersion: wallet.version, chains: [...wallet.chains], features: Object.keys(wallet.features),
  })), browser: navigator.userAgent }, null, 2);
  payment.textContent = JSON.stringify(state ?? { kind: 'unprepared' }, null, 2);
  const parsed = viewSchema.safeParse(state);
  const view = parsed.success ? parsed.data : null;
  const matched = invite && view && invite.id === view.id && invite.messageHash === view.messageHash && invite.planHash === view.planHash;
  approve.disabled = busy || !matched || !info?.legacySignOnly || info.account !== invite?.plan.contributions[invite.slot].wallet
    || view?.state !== 'collecting' || !!view.approvedSlots.some(value => value.slot === invite?.slot);
  submit.disabled = busy || !matched || invite?.slot !== 0 || view?.state !== 'ready';
  simulate.disabled = busy || !matched || view?.approvedSlots.length !== 1;
  refresh.disabled = busy || !matched;
  disconnect.disabled = disconnecting;
}
function listWallets() {
  walletSelect.replaceChildren(...wallets.get().map((wallet, index) => {
    const option = document.createElement('option'); option.value = String(index); option.textContent = wallet.name; return option;
  })); render();
}
async function run(operation: () => Promise<void>, interrupt = false) {
  if (navigation.signal.aborted || activeOperations && !interrupt) return;
  activeOperations++; message.textContent = ''; render();
  try { await operation(); }
  catch (error) { message.textContent = error instanceof Error ? error.message : 'Operation failed'; }
  finally { activeOperations--; render(); }
}
element('connect', HTMLButtonElement).onclick = () => void run(async () => {
  const wallet = wallets.get()[Number(walletSelect.value)];
  if (!wallet) throw new Error('No Wallet Standard wallet found. Install or enable a supported extension, then reload.');
  await session.connect(wallet, invite?.plan.contributions[invite.slot].wallet);
});
disconnect.onclick = () => {
  if (disconnecting) return;
  disconnecting = true;
  void run(async () => {
    const wallet = wallets.get()[Number(walletSelect.value)];
    if (!wallet) throw new Error('No Wallet Standard wallet selected. Choose a registered wallet to disconnect.');
    await session.disconnect(wallet);
    message.textContent = 'Wallet provider disconnection completed. Reconnect and check the selected account.';
  }, true).finally(() => { disconnecting = false; render(); });
};
element('clear', HTMLButtonElement).onclick = () => session.clear();
approve.onclick = () => void run(async () => {
  if (!invite) throw new Error('Load your private payer invitation first');
  const payload = await api('payload');
  try {
    const approval = await session.sign(payload, invite.slot, invite);
    state = await api('approval', 'POST', approval);
    message.textContent = 'Independent sign-only approval verified for the frozen message.';
  } catch (error) {
    if (error instanceof WalletRejected) state = await api('decline', 'POST');
    throw error;
  }
});
submit.onclick = () => void run(async () => { state = await api('submit', 'POST'); });
refresh.onclick = () => void run(async () => { state = await api('refresh', 'POST'); });
simulate.onclick = () => void run(async () => { message.textContent = JSON.stringify(await api('simulate-first', 'POST')); });
wallets.on('register', listWallets);
wallets.on('unregister', () => { session.clear(); listWallets(); });
listWallets();
if (invalidInvitation) message.textContent = 'Invalid private invitation. Open a valid payer invitation.';
else void run(async () => { state = await api('view'); });
