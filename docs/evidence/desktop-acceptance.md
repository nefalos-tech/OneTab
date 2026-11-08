# Verify the desktop demo flow

Prepare the [F6 evidence](../cards/F6.md) for the recorded desktop checkout. The recording must show every control in one three-payer room and one two-payer room, with each payer in a separate browser profile, on the hosted Devnet app. The receipt and the selected failure must be legible at the recording's window size, and the flow must work after a fresh page load.

F6 is incomplete. Its hosted acceptance remains **NOT RUN**. It depends on four handoffs: the [B5](../cards/B5.md) deployment, a deployed revision that includes Payments PR #38, the live wallet PR (the F2 and F4 remainders in the Frontend lane), and the [P6](../cards/P6.md) profiles. Each hosted row names the handoffs it needs, so it can run as soon as those exist. No public app URL, real sign-in, live approval, real receipt, or live insufficient-USDC failure has been observed for F6. This checklist does not authorize deployment, recording publication, or submission.

The local audit inspected every screen on main `642597945b354a68a62d34c8d097ddc7ed125658`. Two payment pull requests merged after it. Neither changes a screen, an action, or a word, so the audit's UI results still describe the current UI. The F6 fixes were built and tested on top of the second one.

| Inspected implementation | Exact revision |
| --- | --- |
| Local audit of every screen, viewer, and size | [`642597945b354a68a62d34c8d097ddc7ed125658`](https://github.com/nefalos-tech/OneTab/tree/642597945b354a68a62d34c8d097ddc7ed125658) |
| PR #37, pre-submission expiry. No UI file changed | [`554f32a09a94bdbd52c713ddf07d50011ad11fed`](https://github.com/nefalos-tech/OneTab/tree/554f32a09a94bdbd52c713ddf07d50011ad11fed) |
| PR #38, declined attempts before freeze and the timestamp fix. No UI file changed | [`be767b7c7b686c00fd296f60c9540ec2c169593f`](https://github.com/nefalos-tech/OneTab/tree/be767b7c7b686c00fd296f60c9540ec2c169593f) |
| F6 presentation fixes and this record | Branch commits on `feat/F6-desktop-acceptance`, based on `be767b7`. A squash merge replaces them with one commit on main, so this record names no branch commit |

These are source and local-test identities, not deployed revisions. Follow the [specification](../../spec.md#acceptance-criteria), [design system](../design-system.md), and [development guide](../development.md). A sample screen, fake-API run, or local screenshot does not satisfy F6.

## Read the local audit results

Tag every observation with its evidence class, as in [payment failures](payment-failures.md). `fixture` uses sample data. `local` runs the real Next.js server and pages against the fake API in `e2e/fake-api.mjs`. Neither uses a real wallet, database, or Devnet.

| Command and runtime | Observed result | Local artifact |
| --- | --- | --- |
| `npm run check` on this branch after the last fix, Node `24.22.1` | PASS. Lint, route type generation, TypeScript, the design check, and 1,634 unit tests in 31 files passed. `fixture` | Task-local `f6/verify/01-check.log` |
| `npm run test:e2e` on this branch after the last fix, Playwright `1.63.0`, Chromium `153.0.8010.12` | PASS. The production build and 148 browser cases passed, three of them new for F6. Two later runs on the branch also passed all 148. `fixture`, `local` | Task-local `f6/evidence/e2e-full-final.log`, `f6/verify/02-e2e-run1.log`, and `f6/verify/03-e2e-run2.log` |
| Audit sweep at 1280 by 800, 1440 by 900, and 1920 by 1080 on `6425979` | 902 screenshots. Every sample screen and viewer (77 per size) and 64 fake-API live steps per size. `fixture`, `local` | Task-local `f6/audit-screens/` and `f6/tools/sweep-*.json`, `live-*.json` |
| axe, WCAG 2.0 to 2.2 A and AA, on `6425979` | 0 violations on 97 screens per size, 291 runs in all. `fixture`, `local` | Task-local `f6/tools/sweep-*.json`, `live-*.json` |
| Keyboard activation on `6425979` | 1,054 presses, 527 with Enter and 527 with Space, each on a control Tab reached. The skip link is the first stop and no page traps focus. Space followed none of the 133 links it was pressed on. 116 of those presses scrolled the page and 17 did nothing, which is how browsers treat links. Across every control, 32 Space presses changed nothing: those 17, 12 in form fields, and 3 on **Review checkout** with an empty form, where Enter changed nothing either. `fixture`, `local` | Task-local `f6/tools/activate-*.json` |
| Fake-API live flow on `6425979` | The payment script reached Paid, the failure script reached its replacement, the outage line appeared and cleared, a reload kept the same attempt, the explorer link used `?cluster=devnet`, the error page's **Try again** recovered, and a missing room returned 404. `local` | Task-local `f6/tools/live-*.json` |
| Fold and legibility measurements after the fixes | With the sample asides hidden, as on a live page, **Approve in wallet** ends at 773px at all three sizes. After **Copy**, "Copied." adds 20px, to 793px. The failed result's **Try again** ends at 454px. The sample receipt ends at 758px. `fixture` | Task-local `f6/fix-screens/fix-measure.json` and nine viewport screenshots |
| Independent re-audit on this branch at the three sizes | **Approve in wallet** sat at 729 to 773px in a fake-API room with a simulated sign-in. On all 3,351 focus stops, the ring was Tide at the moment of focus and didn't change afterwards. **Try again** on creation unavailable reloaded the page with samples on and off. axe found 0 violations in 324 runs. `fixture`, `local` | Task-local `f6/reaudit-tools/` and `f6/reaudit-screens/` |

The audit and its scripts ran before this branch and were read for this record, not rerun. The fold measurements were rerun after the fixes, and an independent re-audit repeated the fix checks on this branch.

## Check the prerequisites

Each hosted row below names the handoffs it needs. Obtain them from their owners, and stop if a handoff doesn't describe the artifact under test. "All four" means every handoff in this table.

| Handoff | What it supplies | State at 2026-11-08 08:29 UTC |
| --- | --- | --- |
| Deployment | [B5](../cards/B5.md) supplies the public URL, the exact deployed revision, the deployment ID, and the public `/api/config` response. `APP_ORIGIN` equals that URL, because the server refuses sign-in and writes from any other origin. `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SOLANA_RPC_URL` are set, and `ONETAB_FIXTURES` is not | No deployment exists. B5's open PR #40 records how to publish and doesn't publish |
| PR #38 | The deployed revision includes Payments PR #38. Before it, a real checkout could not freeze its payment message | Merged into main at 07:40:22 UTC as `be767b7`. Any deployment of main from that revision on includes it |
| Live wallet | The live wallet PR is merged into the deployed revision with its pinned package versions. Today `src/lib/wallet/live.ts` fails every sign-in and `src/client/payment-check.ts` answers `unsupported` | In progress on branch `feat/F2-live-wallet`. No pull request for it was open |
| Profiles | [P6](../cards/P6.md) supplies three verified payer profiles and the separate seller | [Hosted payment](hosted-payment.md) records one profile that still selects the organizer's account |

## Record the browsers, windows and profiles

Measure the page in each profile by running `innerWidth + "x" + innerHeight` in the browser console. Undock DevTools into its own window first, because DevTools docked in the page's window makes the page and the measurement smaller. The page should measure at least 1280 by 840, as [recommendation 1](#recommend-decisions-to-their-owners) explains.

The screen numbers spots from 1, and a join takes the lowest open spot. Have the second payer join before the third, so the second payer holds Spot 2 in both rooms.

| Role | Profile or device, OS, Chrome and Phantom versions | Screen size and measured `innerWidth` by `innerHeight` | Public wallet |
| --- | --- | --- | --- |
| Organizer, Spot 1 | NOT RUN | NOT RUN | NOT RUN |
| Second payer, Spot 2 | NOT RUN | NOT RUN | NOT RUN |
| Third payer, Spot 3 in the three-payer room | NOT RUN | NOT RUN | NOT RUN |
| Separate seller, no spot | NOT RUN | NOT RUN | NOT RUN |

## Run the button and flow checklist

Run each step once in the three-payer room of 6 test USDC and once in a two-payer room of 6 test USDC. Both rooms end Paid. The 40 test USDC checkout in [Make the failure case legible](#make-the-failure-case-legible) stops at **Start payment**, so it doesn't count as the two-payer room. The expected words come from `src/client/catalog.ts`. A step passes only when its proof is captured in each profile that the step names. The Needs column names the handoffs from [Check the prerequisites](#check-the-prerequisites).

Where the local evidence says NOT RUN locally, two things kept it from running. Sample data stubs every action that needs the backend or a wallet, and says that nothing was sent. The e2e browser guard in `e2e/browser-api.ts` fails any request that isn't a GET.

| # | Step and control | Expected on screen | Proof to capture | Local evidence | Needs | Two payers | Three payers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Fresh load of `/` | "Split a purchase" and the live preview. Never "Checkouts can't be created right now" | Capture and the public `/api/config` response | `local`. "plain / is the live create form and links no samples" | Deployment | NOT RUN | NOT RUN |
| 2 | **Connect wallet** in the header | The bar shows "Approve the connection in your wallet.", then the sign-in prompt and "Signing in…", each with **Cancel**. Then the header shows the short address | Capture of each step. No signature or cookie | `fixture` sample wallet. Live sign-in is a stub, so it fails with "Sign-in isn't available right now." | Deployment, live wallet, profiles | NOT RUN | NOT RUN |
| 3 | Fill the form | The preview updates while typing. A field shows its error after it loses focus | Capture | `fixture`. "the create form explains a problem when a field loses focus" | Deployment | NOT RUN | NOT RUN |
| 4 | **Review checkout**, then **Edit details** | "Check the details", the full seller with **Copy**, the total and network, each payer's share, and "These details can't change after you create the checkout." **Edit details** keeps the values | Capture | `fixture`. "the sample create flow works by keyboard alone" | Deployment | NOT RUN | NOT RUN |
| 5 | **Create checkout** | **Creating…** until the room shows | Capture and the room URL | `local`. "live create uses the server's configuration and asks to connect a wallet before creating". **Creating…** is NOT RUN locally, because creating needs a live sign-in | Deployment, live wallet | NOT RUN | NOT RUN |
| 6 | **Copy link** in the organizer's room | "Waiting for N more payers, so copy the link and send it to them." Then "Link copied." | Capture and the pasted URL | `fixture`. "Copy link copies the room address and confirms it" | Deployment, live wallet | NOT RUN | NOT RUN |
| 7 | Open the link in each other profile, **Connect wallet**, **Join checkout** | Signed out, "Sign in with your wallet to take an open spot." Signed in, "There's an open spot. Join to pay your share." Then **Joining…** and a "You" tag. The last join hides **Copy link**. A payer who loses the last spot sees the room read again, or "Someone took the last spot first. This checkout is full." when it can't be read | Capture per profile | `fixture` for every viewer's screen. `local` for reading a room signed out. **Joining…** is NOT RUN locally. The lost-race notice has a unit test in `src/client/live-actions.test.ts` | Signed out, deployment and one room. Signed in, deployment, live wallet, profiles | NOT RUN | NOT RUN |
| 8 | **I'm ready** | "Everyone has joined. Check your share, then tell the group you're ready, which moves no money." Then **Saving…** and "You're ready. Waiting for N more payers to get ready." Focus moves to the status block | Capture per profile | `fixture` shows **I'm ready**, and a press in sample data says "I'm ready isn't connected in sample data. Nothing was sent." `local` shows signed-out viewers the readiness counts in "three payers' screens agree on readiness and approvals at every step". The press, **Saving…**, the new status line, and the focus move are NOT RUN locally | Deployment, live wallet, profiles | NOT RUN | NOT RUN |
| 9 | **Not ready yet** | The payer's spot returns to not ready, and **I'm ready** comes back | Capture | `fixture` shows **Not ready yet**, and the audit's presses got "Not ready yet isn't connected in sample data. Nothing was sent." The change back to not ready is NOT RUN locally | Deployment, live wallet, profiles | NOT RUN | NOT RUN |
| 10 | Everyone ready, then **Start payment** | Organizer, "Everyone is ready. Start the payment to ask each payer to approve it." Then **Starting…** and "Preparing payment" | Capture, checkout ID, and attempt ID | `local`. The fake-API script steps signed-out viewers from "Everyone is ready" to "Preparing payment". The **Start payment** press and **Starting…** are NOT RUN locally | All four | NOT RUN | NOT RUN |
| 11 | Approval summary and **Approve in wallet** | Your share, the full seller with **Copy** beside it, the total and network, the network fee line, and "Your approval covers the whole payment…". **Approve in wallet** is on screen without scrolling. Then **Approving…** with the bar's **Cancel**, "You approved. Waiting for N more approvals.", and the payer's spot turns Approved | Capture per payer before and after the wallet prompt | `fixture`. "at 1280 by 800 a payer sees Approve in wallet without scrolling". `local` shows signed-out viewers each spot turning Approved. **Approving…** is NOT RUN locally, because sample data stubs Approve and the live approval seam is a stub | All four | NOT RUN | NOT RUN |
| 12 | Last approval | Every page moves to the result. "Sending payment", then "Finalizing", then "Paid". The status block takes focus | Capture per profile | `local`. "three payers' screens agree…, and each moves to the result". "a payment that fails before sending moves viewers to an honest result…" checks the focus after a move, on a failed result | All four | NOT RUN | NOT RUN |
| 13 | Status refresh, with no reload | Each change shows within a few seconds. While OneTab can't be reached, "Can't reach OneTab right now. This page keeps trying and shows the last update it got." While approvals are open, a payer's page also asks OneTab to refresh the attempt | Capture timings per profile, and the URL and status of one payer's `POST /api/attempts/<id>/refresh` | `local`. "a live page reads its room about every two seconds, never faster" and the outage test. Unit tests in `src/client/live-actions.test.ts` check which attempt a payer's page refreshes. The refresh request is NOT RUN locally | All four | NOT RUN | NOT RUN |
| 14 | **View payment status**, **View receipt**, **Back to checkout** | Each opens the other screen of the same checkout | Capture | `fixture`. The "links from its … screen to its … screen" cases | All four | NOT RUN | NOT RUN |
| 15 | Receipt | "Paid", "The seller received every share in one transaction.", **View on Solana Explorer**, the total, the full seller, "Final on" with the UTC time, each spot with its amount, and the transaction reference with **Copy** | Capture per profile after a reload | `fixture` and `local`. "a transaction reference alone is never a receipt" | All four | NOT RUN | NOT RUN |
| 16 | **View on Solana Explorer** | A new tab at `https://explorer.solana.com/tx/<reference>?cluster=devnet` showing the finalized transaction | Capture and the URL | `local`. The link format only | All four | NOT RUN | NOT RUN |

## Check keyboard, focus, busy states and errors

Run these at the recorded window size in one profile.

| Check | Local evidence | Needs | Hosted result |
| --- | --- | --- | --- |
| The skip link is the first Tab stop, Tab order follows the screen, and nothing traps focus | `fixture`, `local` audit | Deployment for `/` and the not-found page. Each other screen needs what its checklist row needs | NOT RUN |
| Buttons work with Enter and Space. Links work with Enter | `fixture`, `local` audit, 1,054 presses | Deployment for `/` and the not-found page. Each other screen needs what its checklist row needs | NOT RUN |
| Every control shows its ring at full color as soon as it gets focus | `fixture`. "a button's focus ring shows at its full color the moment the button gets keyboard focus" | Deployment for `/` and the not-found page. Each other screen needs what its checklist row needs | NOT RUN |
| Focus lands on the status block after **I'm ready** and after the move to the result | After the move, `local`. "a payment that fails before sending moves viewers to an honest result…" checks it on a failed result. After **I'm ready**, NOT RUN locally, because sample data stubs the action and the e2e guard refuses writes | Deployment, live wallet, profiles. All four for the move to the result | NOT RUN |
| Busy labels show, and repeat presses are ignored while a request runs | `fixture` audit for the sample wallet's **Connecting…** and **Signing in…** only, which ignored Enter and Space while they showed (task-local `f6/tools/busy-*.json`). **Creating…**, **Joining…**, **Saving…**, **Starting…**, and **Approving…** are NOT RUN locally, because sample data stubs those actions and the e2e guard refuses writes. Unit tests in `src/client/checkout-view.test.ts` check only which action counts as busy | Deployment, live wallet. Each request label needs what its checklist row needs | NOT RUN |
| The wallet bar's **Cancel** stops the wait, and Escape closes the wallet menu | `fixture`. "every wallet control works by keyboard alone and keeps focus somewhere sensible" | Deployment, live wallet | NOT RUN |
| The error page's **Try again**, the not-found page's **Create a checkout**, and creation unavailable's **Try again** | `local`. "creation unavailable offers Try again, which loads the page again" | Deployment | NOT RUN |
| axe finds no violations | `fixture`, `local`, 0 on 291 runs | Deployment for `/` and the not-found page. Each other screen needs what its checklist row needs | NOT RUN |

## Reload in every profile

A fresh page load works when each profile shows the same checkout state after a reload, and one press of **Connect wallet** resumes without a new sign-in signature while the session cookie is valid. A reload signs the viewer out, because the page starts signed out and never connects the wallet by itself. One press then reuses the session cookie when it belongs to the connected wallet, as `src/lib/wallet/machine.ts` is written, but no live run has shown it yet. Reload once in the open room, once during approvals, and once on the receipt. The open-room reload needs the deployment, the live wallet, and the profiles. The other two need all four.

| Profile | Screen before reload | After reload, signed out | After one **Connect wallet**, no new signature | Hosted first-load time |
| --- | --- | --- | --- | --- |
| Organizer, Spot 1 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Second payer, Spot 2 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Third payer, Spot 3 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

`local` evidence: "reloading a live room shows the same fixed details" and "reloading while … shows the same attempt" passed. A direct load stays blank until the server reads the room, so record the hosted first-load time.

## Make the failure case legible

The failure case is a preflight insufficient-USDC result, as live issue #18 selects. It stops before anything is sent, so no share moves and no network fee is paid. The preflight in `src/server/payments/preflight.ts` refuses the start with `INSUFFICIENT_USDC` and status 422 when any payer's token balance is below their share. It needs all four handoffs.

This checkout covers only the failure case. It stops at **Start payment**, so it can't stand in for the two-payer room, whose rows 11 to 16 need a payment that ends Paid.

1. Run it after both paid rooms, in a fresh two-payer checkout of 40 test USDC, so each share is 20.
2. Check the balances first. The recorded balances are 18 test USDC for the organizer and for the second payer. The three-payer room lowers each by 2, and the two-payer room of 6 test USDC lowers each by 3 more, which leaves 13, below the share of 20.
3. Join, mark both payers ready, and press **Start payment** in the organizer's window.
4. Capture the organizer's page before any reload. The reason is known only to the page that pressed **Start payment**, and only until it reloads.

Expect "Payment failed" and "No share reached the seller. Try again to ask everyone to approve a new payment." Then expect "A payer's wallet didn't hold their full share in test USDC, so nothing was sent and no network fee was paid." and "Each payer checks that their wallet holds their share in test USDC on Solana Devnet." Expect **Try again**, **Back to checkout**, and no transaction reference. The other payer's page says the payment stopped before it was sent. Don't press **Try again** on camera, because it fails the same way until the balances change.

| Failure evidence | Observed result and evidence |
| --- | --- |
| Checkout ID, attempt ID, UTC time, and the 422 `INSUFFICIENT_USDC` response | NOT RUN `hosted Devnet` |
| Organizer capture before reload, and the other payer's capture | NOT RUN |
| Token balances before and after, unchanged, and no transaction reference | NOT RUN |

## Capture screens for B6

Each capture needs what its checklist row needs.

| Capture | Profile and window | File | Status |
| --- | --- | --- | --- |
| Create review | Organizer | NOT RUN | NOT RUN |
| Room with **Copy link** and open spots | Organizer | NOT RUN | NOT RUN |
| Full room, "Getting ready" | Second payer, Spot 2 | NOT RUN | NOT RUN |
| "Everyone is ready" with **Start payment** | Organizer | NOT RUN | NOT RUN |
| Approval summary with **Approve in wallet** on screen | Second payer, Spot 2 | NOT RUN | NOT RUN |
| "Collecting approvals" with one spot Approved | Third payer, Spot 3 | NOT RUN | NOT RUN |
| Paid receipt | Each profile | NOT RUN | NOT RUN |
| Solana Explorer tab | Organizer | NOT RUN | NOT RUN |
| Insufficient-USDC failure | Organizer | NOT RUN | NOT RUN |

Task-local `f6/fix-screens/` holds `fixture` reference captures of a payer asked to approve, the receipt, and the failed result at all three sizes. They show the intended layout, not hosted evidence.

## Record the presentation fixes

The audit rated each finding. Should fix means it visibly hurts the recording. A nit is fixed only when the fix is cheap. F6 fixed both should-fix findings and one nit, and reworded two design-system rules to match the code. The audit's one blocker, live sign-in, belongs to the live wallet PR.

`git diff --stat origin/main...HEAD -- src/server src/app/api supabase src/contracts src/fixtures src/lib src/client/contracts.ts src/client/checkout-view.ts src/client/catalog.ts src/client/live-actions.ts src/client/payment-check.ts` prints nothing on this branch. No route, contract, room rule, payment rule, or word changed. Each code fix has an e2e check that failed before the fix and passed after it. A8 and B4 are documentation-only and have no test.

| Audit finding and rating | Fix | Files | Before and after | Test | Design-system change log |
| --- | --- | --- | --- | --- | --- |
| A2, should fix | **Copy** beside the seller in the approval summary, so **Approve in wallet** fits at 1280 by 800 | `src/components/status-panel.tsx`, `e2e/samples.spec.ts` | The button ended at 821px in an 800px window. It now ends at 773px, or 793px once "Copied." shows | "at 1280 by 800 a payer sees Approve in wallet without scrolling". The failing run is in task-local `f6/evidence/a2-red.txt` | 2026-11-08 F6 row |
| A7, nit | The focus ring appears at full color at once instead of fading in from white | `src/components/button.ts`, `e2e/samples.spec.ts` | The ring read `rgb(255, 255, 255)` at focus and `rgb(6, 83, 121)` once settled. It now reads Tide at focus | "a button's focus ring shows at its full color the moment the button gets keyboard focus". The failing run is in task-local `f6/evidence/a7-b1-red.txt` | 2026-11-08 F6 row |
| B1, should fix | **Try again** on the creation-unavailable screen | `src/components/create-screen.tsx`, `e2e/samples.spec.ts` | The screen had no control. It now offers **Try again**, which loads the page again | "creation unavailable offers Try again, which loads the page again", which runs with samples on only. The failing run is in task-local `f6/evidence/a7-b1-red.txt` | 2026-11-08 F6 row |
| A8 and B4, nits | Keyboard rule says links work with Enter. Focus rule keeps "never removed" for controls | `docs/design-system.md` | Documentation only | None, because the change is documentation only | 2026-11-08 F6 row |

## List unresolved limitations

The audit found these, and F6 leaves them in place.

- Live sign-in always fails until the live wallet PR lands. The room and the bar then both show **Try again**, the same label as the payment's **Try again**. After a refused connection, three **Connect wallet** buttons show at once.
- A declined payment has no next step. On the hosted app, a decline during approvals keeps the room on hold, so a payer who refuses the wallet prompt by accident presses **Approve in wallet** again and never **Decline payment** in a demo room.
- A direct load of a room stays blank until the server reads it, so a missing checkout can return a real 404.
- The placeholder during the move from the room to the result has the room's two columns and no wallet button.
- At `/?sample` with samples off, the not-found page's **Create a checkout** and the logo keep the not-found page, because the path doesn't change.
- Spacing. On the result at 1920, the flow steps align to the 1080px column and the card to a centered 640px column. While approvals are open, the gap above Payers is 57px, down from 81px, against a 32px rule. An empty notice region adds 16px under the last button, which also widens the gap above the sample links on the creation-unavailable screen.
- Every 404 says "this checkout", whatever the path, and keeps the tab title "OneTab". `/samples` with samples off keeps the title "Sample data".
- The wallet bar adds 72px at the top while a wallet prompt is open, which moves the page while Phantom's window is up.
- A button that waits on another request looks enabled. The design system promises a visible reason.
- A failed copy says "Select the text and copy it instead.", but the room never shows its URL.
- "Ready moves no money" shows only in the full-room status line.
- The create review and the transaction reference still put **Copy** under the address, against the design system's Address rule.
- At 1280 by 800 a live paid receipt ends at 831px in the fake-API run, so its transaction reference row needs a short scroll in an 800px window.
- After a reload every profile is signed out until one **Connect wallet** press.
- The organizer's insufficient-USDC reason disappears on reload. Other viewers read that the payment stopped before it was sent.
- Three windows side by side on a 1920px screen are about 640px wide each, so they stack into one column.

The re-audit found two more nits on this branch.

- After **Copy** beside the seller, "Copied." wraps under the button and adds 20px to the seller row, so **Approve in wallet** moves from 773px to 793px. It still fits an 800px page. F6's A2 fix causes this.
- When Tab scrolls a control up from below the fold, Chrome stops with the control flush against the bottom edge, and the bottom 4px of its focus ring falls off screen. The re-audit saw this on 26 of 3,351 focus stops, and it predates F6. A scroll padding of about 8px on the page would likely fix it, but that is untested.

F6's own B1 fix has one known limitation, and F6 leaves the code as it is.

- The rule that offers **Try again** on creation unavailable lives in `src/components/create-screen.tsx`, not in `src/client/checkout-view.ts`, which the [architecture](../architecture.md#module-and-file-ownership) says holds every rule about what a viewer sees. It has no unit test, and the samples-off view that the hosted app shows has only a task-local screenshot.

## Recommend decisions to their owners

F6 doesn't edit other lanes' cards. Decisions 4 and 6 are F6's own. The others are recommendations for B6, P6, B5, and the live wallet PR's owner.

1. **Recording window.** Record each profile in one Chrome window at 100% zoom whose page measures at least 1280 by 840, measured as in [Record the browsers, windows and profiles](#record-the-browsers-windows-and-profiles). The live receipt ends at 831px, and **Approve in wallet** ends at 793px once "Copied." shows, so a page at least 840px tall shows the whole receipt and keeps **Approve in wallet** in view. A maximized window on a 1440 by 900 screen is likely too short, because Chrome leaves about 780px of page there (inferred, not measured). A maximized window on a 1920 by 1080 screen likely fits (inferred), so measure it before recording. Show the profiles one at a time, not side by side.
2. **Failure case.** Use the insufficient-USDC preflight from the steps above, as issue #18 says. The repository copy of [B6](../cards/B6.md) doesn't have that sentence yet, so its owner should copy it from the issue. P6's wallet-rejection rehearsal in [hosted payment](hosted-payment.md) should stay in its own checkout and out of the video, and nobody should press **Decline payment** in a room used for the demo.
3. **Two-payer rooms.** Run F6's two-payer room as its own paid checkout of 6 test USDC, after the three-payer room. Any total up to 32 test USDC fits, because after the three-payer room the organizer and the second payer hold 16 test USDC each (computed from the recorded balances). Then trigger the shortage with a separate two-payer checkout of 40 test USDC. It stops at **Start payment**, so it covers only the failure case and never rows 11 to 16. Check the balances first, because the shortage needs a share above a payer's balance.
4. **Fresh page load.** Use the definition in [Reload in every profile](#reload-in-every-profile). Record it in each profile at the public URL, never a preview alias, because writes from another origin are refused.
5. **Narration.** Say that Ready moves no money over the "Getting ready" screen, because no other screen says it.
6. **F6's pull request.** Open it with `Refs #12`, the fixes, and every hosted row **NOT RUN**. Use `Closes #12` only once the hosted evidence exists, and keep issue #12 open until then.
7. **Review of the live wallet PR.** Assign another teammate or an independent agent to review it now, as the repository's review rule requires. Every signed-in row waits for that PR.
8. **Deploy B5 before the wallet lands.** A deployment of main at `be767b7` or later already includes PR #38. The deployment alone lets F6 run row 1 and its first-load time, rows 3 and 4, the not-found page, and the error page if it appears. The signed-out half of row 7 and a room's first-load time need only the deployment and one room, and the first room needs one live **Create checkout**. Once sign-in works, the same deployment covers create, join, and Ready before approvals work.

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
