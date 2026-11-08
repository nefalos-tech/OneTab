# Verify the desktop demo flow

Prepare the [F6 evidence](../cards/F6.md) for the recorded desktop checkout. The recording must show every control in one three-payer room and one two-payer room, with each payer in a separate browser profile, on the hosted Devnet app. The receipt and the selected failure must be legible at the recording's window size, and the flow must work after a fresh page load.

F6 is incomplete. Its hosted acceptance remains **NOT RUN** and depends on [B5](../cards/B5.md), the live wallet adapter (the F2 and F4 remainders in the Frontend lane), and the [P6](../cards/P6.md) profiles. No public app URL, real sign-in, live approval, real receipt, or live insufficient-USDC failure has been observed for F6. This checklist does not authorize deployment, recording publication, or submission.

The local audit inspected every screen on main `642597945b354a68a62d34c8d097ddc7ed125658`. Two payment pull requests merged after it. Neither changes a screen, an action, or a word, so the audit's UI results still describe the current UI. The F6 fixes were built and tested on top of the second one.

| Inspected implementation | Exact revision |
| --- | --- |
| Local audit of every screen, viewer, and size | [`642597945b354a68a62d34c8d097ddc7ed125658`](https://github.com/nefalos-tech/OneTab/tree/642597945b354a68a62d34c8d097ddc7ed125658) |
| PR #37, pre-submission expiry. No UI file changed | [`554f32a09a94bdbd52c713ddf07d50011ad11fed`](https://github.com/nefalos-tech/OneTab/tree/554f32a09a94bdbd52c713ddf07d50011ad11fed) |
| PR #38, declined attempts before freeze and the timestamp fix. No UI file changed | [`be767b7c7b686c00fd296f60c9540ec2c169593f`](https://github.com/nefalos-tech/OneTab/tree/be767b7c7b686c00fd296f60c9540ec2c169593f) |
| F6 presentation fixes on branch `feat/F6-desktop-acceptance` | `a15d5cf1e0e88aca472de32456cf2aca96d2ce9a`, `2375aa3c6b46be51730628eb8fd63ef1aa428a29`, and `7d192cf86f5ad88407deea57cb22165fddcc86b7` |

These are source and local-test identities, not deployed revisions. Follow the [specification](../../spec.md#acceptance-criteria), [design system](../design-system.md), and [development guide](../development.md). A sample screen, fake-API run, or local screenshot does not satisfy F6.

## Read the local audit results

Tag every observation with its evidence class, as in [payment failures](payment-failures.md). `fixture` uses sample data. `local` runs the real Next.js server and pages against the fake API in `e2e/fake-api.mjs`. Neither uses a real wallet, database, or Devnet.

| Command and runtime | Observed result | Local artifact |
| --- | --- | --- |
| `npm run check` at `7d192cf`, Node `24.22.1` | PASS. Lint, route type generation, TypeScript, the design check, and 1,634 unit tests passed. The same check passed at `a15d5cf` and `2375aa3`. `fixture` | Rerun with the command |
| `npm run test:e2e` at `7d192cf`, Playwright `1.63.0`, Chromium `153.0.8010.12` | PASS. The production build and 148 browser cases passed, three of them new for F6. `fixture`, `local` | `test-results/` |
| Audit sweep at 1280 by 800, 1440 by 900, and 1920 by 1080 on `6425979` | 902 screenshots. Every sample screen and viewer (77 per size) and 64 fake-API live steps per size. `fixture`, `local` | Task-local `f6/audit-screens/` and `f6/tools/sweep-*.json`, `live-*.json` |
| axe, WCAG 2.0 to 2.2 A and AA, on `6425979` | 0 violations on 97 screens per size, 291 runs in all. `fixture`, `local` | Task-local `f6/tools/sweep-*.json`, `live-*.json` |
| Keyboard activation on `6425979` | 1,054 presses, 527 with Enter and 527 with Space, each on a control Tab reached. The skip link is the first stop and no page traps focus. 32 Space presses on links changed nothing, which is how browsers treat links. `fixture`, `local` | Task-local `f6/tools/activate-*.json` |
| Fake-API live flow on `6425979` | The payment script reached Paid, the failure script reached its replacement, the outage line appeared and cleared, a reload kept the same attempt, the explorer link used `?cluster=devnet`, the error page's **Try again** recovered, and a missing room returned 404. `local` | Task-local `f6/tools/live-*.json` |
| Fold and legibility measurements after the fixes, on `7d192cf` | With the sample asides hidden, as on a live page, **Approve in wallet** ends at 773px at all three sizes. After **Copy**, "Copied." adds 20px, to 793px. The failed result's **Try again** ends at 454px. The sample receipt ends at 758px. `fixture` | Task-local `f6/fix-screens/fix-measure.json` and nine viewport screenshots |

The audit and its scripts ran before this branch and were read for this record, not rerun. The fold measurements were rerun on the fix commits.

## Check the prerequisites

Before the hosted run, obtain these handoffs from their owners.

- [B5](../cards/B5.md) supplies the public URL, the exact deployed revision, the deployment ID, and the public `/api/config` response. `APP_ORIGIN` equals that URL, because the server refuses sign-in and writes from any other origin. `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SOLANA_RPC_URL` are set, and `ONETAB_FIXTURES` is not.
- The live wallet adapter is merged into the deployed revision with its pinned package versions. Today `src/lib/wallet/live.ts` fails every sign-in and `src/client/payment-check.ts` answers `unsupported`. No adapter pull request was open at 2026-11-08 07:50 UTC.
- Payments PR #38 merged into main at 2026-11-08 07:40:22 UTC as `be767b7`. The deployed revision must include it, because before it a real checkout could not freeze its payment message.
- [P6](../cards/P6.md) supplies three verified payer profiles and the separate seller. [Hosted payment](hosted-payment.md) records one profile that still selects the organizer's account.

Stop if those handoffs don't describe the artifact under test.

## Record the browsers, windows and profiles

Measure the window in each profile by running `innerWidth + "x" + innerHeight` in the browser console.

| Role | Profile or device, OS, Chrome and Phantom versions | Screen size and measured `innerWidth` by `innerHeight` | Public wallet |
| --- | --- | --- | --- |
| Organizer, payer slot 0 | NOT RUN | NOT RUN | NOT RUN |
| Payer slot 1 | NOT RUN | NOT RUN | NOT RUN |
| Payer slot 2 | NOT RUN | NOT RUN | NOT RUN |
| Separate seller, no approval | NOT RUN | NOT RUN | NOT RUN |

## Run the button and flow checklist

Run each step once in the three-payer room of 6 test USDC and once in a two-payer room. The expected words come from `src/client/catalog.ts`. A step passes only when its proof is captured in each profile that the step names.

| # | Step and control | Expected on screen | Proof to capture | Local evidence | Two payers | Three payers |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Fresh load of `/` | "Split a purchase" and the live preview. Never "Checkouts can't be created right now" | Capture and the public `/api/config` response | `local`. "plain / is the live create form and links no samples" | NOT RUN | NOT RUN |
| 2 | **Connect wallet** in the header | The bar shows "Approve the connection in your wallet.", then the sign-in prompt and "Signing in…", each with **Cancel**. Then the header shows the short address | Capture of each step. No signature or cookie | `fixture` sample wallet. Live sign-in is a stub, so it fails with "Sign-in isn't available right now." | NOT RUN | NOT RUN |
| 3 | Fill the form | The preview updates while typing. A field shows its error after it loses focus | Capture | `fixture`. "the create form explains a problem when a field loses focus" | NOT RUN | NOT RUN |
| 4 | **Review checkout**, then **Edit details** | "Check the details", the full seller with **Copy**, the total and network, each payer's share, and "These details can't change after you create the checkout." **Edit details** keeps the values | Capture | `fixture`. "the sample create flow works by keyboard alone" | NOT RUN | NOT RUN |
| 5 | **Create checkout** | **Creating…** until the room shows | Capture and the room URL | `local`. "live create uses the server's configuration and asks to connect a wallet before creating". Creating needs a live sign-in | NOT RUN | NOT RUN |
| 6 | **Copy link** in the organizer's room | "Waiting for N more payers, so copy the link and send it to them." Then "Link copied." | Capture and the pasted URL | `fixture`. "Copy link copies the room address and confirms it" | NOT RUN | NOT RUN |
| 7 | Open the link in each other profile, **Connect wallet**, **Join checkout** | Signed out, "Sign in with your wallet to take an open spot." Signed in, "There's an open spot. Join to pay your share." Then **Joining…** and a "You" tag. The last join hides **Copy link** | Capture per profile | `fixture` for every viewer. `local` for reading a room signed out | NOT RUN | NOT RUN |
| 8 | **I'm ready** | "Everyone has joined. Check your share, then tell the group you're ready, which moves no money." Then **Saving…** and "You're ready. Waiting for N more payers to get ready." Focus moves to the status block | Capture per profile | `local`. "three payers' screens agree on readiness and approvals at every step" | NOT RUN | NOT RUN |
| 9 | **Not ready yet** | The payer's spot returns to not ready, and **I'm ready** comes back | Capture | `fixture` | NOT RUN | NOT RUN |
| 10 | Everyone ready, then **Start payment** | Organizer, "Everyone is ready. Start the payment to ask each payer to approve it." Then **Starting…** and "Preparing payment" | Capture, checkout ID, and attempt ID | `local` fake-API script | NOT RUN | NOT RUN |
| 11 | Approval summary and **Approve in wallet** | Your share, the full seller with **Copy** beside it, the total and network, the network fee line, and "Your approval covers the whole payment…". **Approve in wallet** is on screen without scrolling. Then **Approving…** with the bar's **Cancel**, and "You approved. Waiting for N more approvals." | Capture per payer before and after the wallet prompt | `fixture`. "at 1280 by 800 a payer sees Approve in wallet without scrolling". The live approval seam is a stub | NOT RUN | NOT RUN |
| 12 | Last approval | Every page moves to the result. "Sending payment", then "Finalizing", then "Paid". The status block takes focus | Capture per profile | `local`. "three payers' screens agree…, and each moves to the result" | NOT RUN | NOT RUN |
| 13 | Status refresh, with no reload | Each change shows within a few seconds. While OneTab can't be reached, "Can't reach OneTab right now. This page keeps trying and shows the last update it got." | Capture timings per profile | `local`. "a live page reads its room about every two seconds, never faster" and the outage test | NOT RUN | NOT RUN |
| 14 | **View payment status**, **View receipt**, **Back to checkout** | Each opens the other screen of the same checkout | Capture | `fixture`. The "links from its … screen to its … screen" cases | NOT RUN | NOT RUN |
| 15 | Receipt | "Paid", "The seller received every share in one transaction.", **View on Solana Explorer**, the total, the full seller, "Final on" with the UTC time, each spot with its amount, and the transaction reference with **Copy** | Capture per profile after a reload | `fixture` and `local`. "a transaction reference alone is never a receipt" | NOT RUN | NOT RUN |
| 16 | **View on Solana Explorer** | A new tab at `https://explorer.solana.com/tx/<reference>?cluster=devnet` showing the finalized transaction | Capture and the URL | `local`. The link format only | NOT RUN | NOT RUN |

## Check keyboard, focus, busy states and errors

Run these at the recorded window size in one profile.

| Check | Local evidence | Hosted result |
| --- | --- | --- |
| The skip link is the first Tab stop, Tab order follows the screen, and nothing traps focus | `fixture`, `local` audit | NOT RUN |
| Buttons work with Enter and Space. Links work with Enter | `fixture`, `local` audit, 1,054 presses | NOT RUN |
| Every control shows its ring at full color as soon as it gets focus | `fixture`. "a button's focus ring shows at its full color the moment the button gets keyboard focus" | NOT RUN |
| Focus lands on the status block after **I'm ready** and after the move to the result | `local` | NOT RUN |
| Busy labels show, and repeat presses are ignored while a request runs | `fixture`, `local` audit | NOT RUN |
| The wallet bar's **Cancel** stops the wait, and Escape closes the wallet menu | `fixture`. "every wallet control works by keyboard alone and keeps focus somewhere sensible" | NOT RUN |
| The error page's **Try again**, the not-found page's **Create a checkout**, and creation unavailable's **Try again** | `local`. "creation unavailable offers Try again, which loads the page again" | NOT RUN |
| axe finds no violations | `fixture`, `local`, 0 on 291 runs | NOT RUN |

## Reload in every profile

A fresh page load works when each profile shows the same checkout state after a reload, and one press of **Connect wallet** resumes without a new sign-in signature while the session cookie is valid. A reload signs the viewer out, because the page starts signed out and never connects the wallet by itself. One press then reuses the session cookie when it belongs to the connected wallet, as `src/lib/wallet/machine.ts` is written, but no live run has shown it yet. Reload once in the open room, once during approvals, and once on the receipt.

| Profile | Screen before reload | After reload, signed out | After one **Connect wallet**, no new signature | Hosted first-load time |
| --- | --- | --- | --- | --- |
| Organizer | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Payer slot 1 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Payer slot 2 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

`local` evidence: "reloading a live room shows the same fixed details" and "reloading while … shows the same attempt" passed. A direct load stays blank until the server reads the room, so record the hosted first-load time.

## Make the failure case legible

The failure case is a preflight insufficient-USDC result, as live issue #18 selects. It stops before anything is sent, so no share moves and no network fee is paid. The preflight in `src/server/payments/preflight.ts` refuses the start with `INSUFFICIENT_USDC` and status 422 when any payer's token balance is below their share.

1. Use a fresh two-payer checkout, separate from the successful run. Set a total of 40 test USDC, so each share is 20. The recorded balances are 18 test USDC for the organizer and for the second payer, and the successful run lowers each by 2.
2. Join, mark both payers ready, and press **Start payment** in the organizer's window.
3. Capture the organizer's page before any reload. The reason is known only to the page that pressed **Start payment**, and only until it reloads.

Expect "Payment failed" and "No share reached the seller. Try again to ask everyone to approve a new payment." Then expect "A payer's wallet didn't hold their full share in test USDC, so nothing was sent and no network fee was paid." and "Each payer checks that their wallet holds their share in test USDC on Solana Devnet." Expect **Try again**, **Back to checkout**, and no transaction reference. The other payer's page says the payment stopped before it was sent. Don't press **Try again** on camera, because it fails the same way until the balances change.

| Failure evidence | Observed result and evidence |
| --- | --- |
| Checkout ID, attempt ID, UTC time, and the 422 `INSUFFICIENT_USDC` response | NOT RUN `hosted Devnet` |
| Organizer capture before reload, and the other payer's capture | NOT RUN |
| Token balances before and after, unchanged, and no transaction reference | NOT RUN |

## Capture screens for B6

| Capture | Profile and window | File | Status |
| --- | --- | --- | --- |
| Create review | Organizer | NOT RUN | NOT RUN |
| Room with **Copy link** and open spots | Organizer | NOT RUN | NOT RUN |
| Full room, "Getting ready" | Payer slot 1 | NOT RUN | NOT RUN |
| "Everyone is ready" with **Start payment** | Organizer | NOT RUN | NOT RUN |
| Approval summary with **Approve in wallet** on screen | Payer slot 1 | NOT RUN | NOT RUN |
| "Collecting approvals" with one spot Approved | Payer slot 2 | NOT RUN | NOT RUN |
| Paid receipt | Each profile | NOT RUN | NOT RUN |
| Solana Explorer tab | Organizer | NOT RUN | NOT RUN |
| Insufficient-USDC failure | Organizer | NOT RUN | NOT RUN |

Task-local `f6/fix-screens/` holds `fixture` reference captures of the signing payer, the receipt, and the failed result at all three sizes. They show the intended layout, not hosted evidence.

## Record the presentation fixes

`git diff --stat origin/main -- src/server src/app/api supabase src/contracts src/fixtures src/lib/payments src/client/contracts.ts src/client/checkout-view.ts src/client/catalog.ts` printed nothing at `7d192cf`. No route, contract, room rule, payment rule, or word changed. Each fix has an e2e check that failed before it and passed after it.

| Fix | Commit | Files | Before and after | Design-system change log |
| --- | --- | --- | --- | --- |
| **Copy** beside the seller in the approval summary, so **Approve in wallet** fits at 1280 by 800 | `a15d5cf` | `src/components/status-panel.tsx`, `e2e/samples.spec.ts` | The button ended at 821px in an 800px window. It now ends at 773px | 2026-11-08 F6 row |
| The focus ring appears at full color at once instead of fading in from white | `2375aa3` | `src/components/button.ts`, `e2e/samples.spec.ts` | The ring read `rgb(255, 255, 255)` at focus and `rgb(6, 83, 121)` once settled. It now reads Tide at focus | 2026-11-08 F6 row |
| **Try again** on the creation-unavailable screen | `2375aa3` | `src/components/create-screen.tsx`, `e2e/samples.spec.ts` | The screen had no control. It now offers **Try again**, which loads the page again | 2026-11-08 F6 row |
| Keyboard rule says links work with Enter. Focus rule keeps "never removed" for controls | `7d192cf` | `docs/design-system.md` | Documentation only | 2026-11-08 F6 row |

## List unresolved limitations

The audit found these, and F6 leaves them in place.

- Live sign-in always fails until the wallet adapter lands, and the room and the bar then both show **Try again**. After a refused connection, three **Connect wallet** buttons show at once.
- A declined payment has no next step. A signed decline keeps the room on hold on the hosted app, so a payer who refuses the wallet prompt by accident presses **Approve in wallet** again and never **Decline payment** in a demo room.
- A direct load of a room stays blank until the server reads it, so a missing checkout can return a real 404.
- The placeholder during the move from the room to the result has the room's two columns and no wallet button.
- At `/?sample` with samples off, the not-found page's **Create a checkout** and the logo keep the not-found page, because the path doesn't change.
- Spacing. On the result at 1920, the flow steps align to the 1080px column and the card to a centered 640px column. During signing the gap above Payers is 57px, down from 81px, against a 32px rule. An empty notice region adds 16px under the last button, which also widens the gap above the sample links on the creation-unavailable screen.
- Every 404 says "this checkout", whatever the path, and `/samples` with samples off keeps the title "Sample data".
- The wallet bar adds 72px at the top while a wallet prompt is open, which moves the page while Phantom's window is up.
- A button that waits on another request looks enabled. The design system promises a visible reason.
- A failed copy says "Select the text and copy it instead.", but the room never shows its URL.
- "Ready moves no money" shows only in the full-room status line.
- The create review and the transaction reference still put **Copy** under the address, against the design system's Address rule.
- At 1280 by 800 a live paid receipt ends at 831px in the fake-API run, so its transaction reference row needs a short scroll in an 800px window.
- After a reload every profile is signed out until one **Connect wallet** press.
- The organizer's insufficient-USDC reason disappears on reload. Other viewers read that the payment stopped before it was sent.
- Three windows side by side on a 1920px screen are about 640px wide each, so they stack into one column.

## Recommend decisions for B6 and P6

F6 doesn't edit other lanes' cards, so these are recommendations for their owners.

1. **Recording window.** Record each profile in one maximized Chrome window at 100% zoom on a screen of at least 1440 by 900. Record its measured `innerWidth` by `innerHeight` above. A window at least 800px tall keeps **Approve in wallet** on screen, and one at least 840px tall also shows the whole receipt. A 1440 by 900 laptop's Chrome window is about 780px tall (inferred), which fits **Approve in wallet** at 773px but not the full receipt. Show the profiles one at a time, not side by side.
2. **Failure case.** Use the insufficient-USDC preflight from the steps above, as issue #18 says. The repository copy of [B6](../cards/B6.md) doesn't have that sentence yet, so its owner should copy it from the issue. P6's wallet-rejection rehearsal in [hosted payment](hosted-payment.md) should stay in its own checkout and out of the video, and nobody should press **Decline payment** in a room used for the demo.
3. **How to trigger the shortage.** Create a two-payer checkout of 40 test USDC after the successful run. It covers F6's two-payer room in the same pass. Check the balances first, because the shortage needs a share above one payer's balance.
4. **Fresh page load.** Use the definition in [Reload in every profile](#reload-in-every-profile). Record it in each profile at the public URL, never a preview alias, because writes from another origin are refused.
5. **Narration.** Say that Ready moves no money over the "Getting ready" screen, because no other screen says it.

## Hand the evidence to B6

| Handoff check | Observed result and evidence |
| --- | --- |
| Evidence reviewed for secrets | NOT RUN |
| B6 recipient, handoff time, and evidence location | NOT RUN |
| Agreed window size per profile | NOT RUN |
| Outstanding limitations | NOT RUN |
| F6 hosted acceptance result | NOT RUN |

Exclude private keys, seed phrases, session cookies, authentication signatures, reusable payment signatures, fully signed transaction bytes, privileged database credentials, and private RPC URLs. Public addresses, the checkout and attempt IDs, and the transaction reference are enough.

Keep F6 incomplete until its hosted acceptance evidence exists.
