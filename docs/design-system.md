# OneTab design system

This is the reference for how OneTab looks, reads and behaves. It covers the three desktop screens: create checkout, checkout room, and payment result. [Design decisions](design-decisions.md) explains why each rule exists.

Every UI or UX change updates this file in the same pull request. Five regions below are generated from code, so they cannot drift. The tokens come from `src/app/globals.css`, contrast ratios are computed from those tokens, and the states, words and wallet states come from `src/client/catalog.ts`. Run `npm run design:write` to regenerate them. `npm run design:check` fails when a region is stale, a token has no documented role, a contrast pair misses its minimum, or `src/` uses an off-system value such as `bg-[#fff]`. Write the rest of this file by hand, and add a line to the [change log](#change-log) for every change. The steps are in [Change the UI design](development.md#change-the-ui-design).

## Product frame

| Item | Rule |
| --- | --- |
| Platform | Desktop browser. Layouts stack to one column below 900px and at 200% zoom |
| Audience | Millennials and younger. Familiar with banking and chat apps, not necessarily with crypto |
| Asset | Test USDC on Solana Devnet, labeled as test funds wherever an amount appears |
| Job of every screen | Show each payer their exact share, collect the same approval from everyone, and report the payment status honestly |

## Rules at a glance

| Principle | OneTab rule |
| --- | --- |
| Hick's law | One primary button per screen state. A choice offers at most three options. Secondary actions are quiet buttons or links |
| Simplicity | Show only what the current step needs. The tab card is the only filled card. Nothing decorative that carries no information |
| Scannability | Amount first, label second. Headings state the point, such as "Your share". Explanations are at most two short sentences. A unit test in checkout-view.test.ts reads every sample's status lines and reasons and every catalog explanation, and fails on a third sentence. A result line for a signed-out viewer is one sentence plus the sign-in sentence, and a stop reason says what happened in one sentence and what to do next in one |
| Jakob's law | The logo, top left, goes home. The wallet sits top right. Copy uses the two-squares icon. External links use the arrow-out-of-box icon and open in a new tab. Flow steps read left to right like a shop checkout |
| Consistency | Colors, sizes, weights, radii, shadows, breakpoints and widths come only from tokens. Tailwind's defaults are disabled. One word per concept, from the [glossary](#glossary) |
| Visibility of system status | Every state shows a status line that says what is happening and what happens next. Work in progress shows a spinner with text. The split bar shows each spot's progress. Status changes are announced to screen readers |
| Signposting | Flow steps under the header mark the current step. The viewer's own spot carries a "You" tag. The page title names the checkout |
| Undo and exit doors | **Edit details** before creating. **Not ready yet** after **I'm ready**. **Back to checkout** from the result. The logo leaves the flow at any point |
| Error prevention | Validate a field when it loses focus, then as the user types. Exact shares appear before anything is created or approved |
| Error recovery | An error message names the problem and the next action in plain words. Fields keep their values after an error |
| Immediate feedback | Shares update while the total is typed. **Copy link** confirms the copy within the same second. Buttons show pressed and loading states. Status lines speak to the viewer: "You approved" |
| Readability | 16px body text, 1.5 line height, at most about 70 characters per line, Atkinson Hyperlegible |
| Accessibility | WCAG 2.2 AA at minimum. AAA contrast for body text and primary buttons. See [Accessibility](#accessibility) |

## Tokens

Tailwind's default colors, type scale, weights, radii, shadows, breakpoints and container widths are reset, so only the tokens below compile into utilities. The comment above each token in `globals.css` is its role in this table.

<!-- design-system:tokens -->
| Token | Value | Role |
| --- | --- | --- |
| `--color-ink` | `#013D5A` | Deep Tide. Body text, headings, pressed primary buttons. |
| `--color-brand` | `#065379` | Tide. Primary buttons, links, focus ring on light surfaces, tab card fill. |
| `--color-brand-soft` | `#E8F2F7` | Info notices, selected and hover rows, joined and ready spots. |
| `--color-white` | `#FFFFFF` | Page and surfaces. Text on Tide. |
| `--color-accent` | `#FFC845` | Marigold. Approved spots, your-share highlight, primary button and focus ring on Tide. Never text on white, never a status. |
| `--color-muted` | `#4A6575` | Secondary text and hints. |
| `--color-line` | `#D5E2E9` | Dividers. Decoration only, never a control border. |
| `--color-line-strong` | `#7590A0` | Input, choice and quiet-button borders. |
| `--color-on-brand-muted` | `#C5DDE8` | Secondary text on the tab card. |
| `--color-success` | `#17703F` | Paid status text and icon. Nowhere else. |
| `--color-success-soft` | `#E5F4EB` | Paid status background. |
| `--color-warning` | `#8F4A00` | Needs-attention status text and icon: unresolved, declined, expired. |
| `--color-warning-soft` | `#FFF1DD` | Needs-attention status background. |
| `--color-danger` | `#B3261E` | Failed status and field errors. |
| `--color-danger-soft` | `#FCE9E7` | Failed status background. |
| `--font-sans` | `var(--font-atkinson-next), ui-sans-serif, system-ui, sans-serif` | Atkinson Hyperlegible Next. All text. |
| `--font-mono` | `var(--font-atkinson-mono), ui-monospace, monospace` | Atkinson Hyperlegible Mono. Wallet addresses and transaction references only. |
| `--font-weight-normal` | `400` | Body text. |
| `--font-weight-semibold` | `600` | Labels, buttons, emphasis. |
| `--font-weight-bold` | `700` | Headings and amounts. |
| `--text-small` | `0.875rem` | 14px. Hints, badges, table labels. |
| `--text-small--line-height` | `1.25rem` | Line height of small text. |
| `--text-body` | `1rem` | 16px. Body text, buttons, inputs. |
| `--text-body--line-height` | `1.5rem` | Line height of body text. |
| `--text-section` | `1.25rem` | 20px. Section headings and status labels. |
| `--text-section--line-height` | `1.75rem` | Line height of section headings. |
| `--text-title` | `1.75rem` | 28px. Page titles. |
| `--text-title--line-height` | `2.25rem` | Line height of page titles. |
| `--text-hero` | `2.5rem` | 40px. The one hero amount per screen. |
| `--text-hero--line-height` | `3rem` | Line height of the hero amount. |
| `--radius-control` | `0.5rem` | Buttons, inputs, badges, notices. Pills and segments use rounded-full. |
| `--radius-card` | `1.25rem` | The tab card and the result panel. |
| `--shadow-tab` | `0 16px 40px -20px rgb(1 61 90 / 0.55)` | The tab card only. Tinted with Deep Tide, never grey. |
| `--breakpoint-narrow` | `22.5rem` | 360px. Below this width the hero amount takes the title size, so its digits fit on one line. |
| `--breakpoint-wide` | `56.25rem` | 900px. Create and room use two columns at and above this width. |
| `--container-content` | `67.5rem` | 1080px. Content max width. |
| `--container-result` | `40rem` | 640px. Result column max width. |
<!-- /design-system:tokens -->

### Color rules

- Tide is the primary, white is the page, and Marigold is the accent. Deep Tide carries text. Aim for a page that is mostly white, with Tide for text and controls and a small amount of Marigold.
- Status colors appear only in status messages, always with an icon and words. Success green appears only on the Paid result.
- Never use Marigold for text on white (1.54:1) or to signal a status.
- Never use `line` where a control boundary must be visible. Use `line-strong`.

### Contrast pairs

The Foreground, Background, Minimum and Use columns are written by hand. The script measures the rest. Text needs at least 4.5:1, and body text and primary buttons need 7:1. Control borders and focus rings need 3:1.

<!-- design-system:contrast -->
| Foreground | Background | Minimum | Measured | Use |
| --- | --- | --- | --- | --- |
| `ink` | `white` | 7 | 11.56 | Body text and headings |
| `ink` | `brand-soft` | 7 | 10.17 | Text on notices and selected rows |
| `muted` | `white` | 4.5 | 6.16 | Secondary text and hints |
| `muted` | `brand-soft` | 4.5 | 5.42 | Secondary text on notices |
| `brand` | `white` | 4.5 | 8.33 | Links, quiet buttons, focus ring on white |
| `white` | `brand` | 7 | 8.33 | Primary button text, tab card text |
| `on-brand-muted` | `brand` | 4.5 | 5.90 | Secondary text on the tab card |
| `accent` | `brand` | 4.5 | 5.39 | Your share on the tab card, focus ring on Tide |
| `ink` | `accent` | 7 | 7.49 | Text on Marigold buttons and approved spots |
| `line-strong` | `white` | 3 | 3.36 | Control borders |
| `success` | `success-soft` | 4.5 | 5.39 | Paid status |
| `warning` | `warning-soft` | 4.5 | 6.00 | Needs-attention status |
| `danger` | `danger-soft` | 4.5 | 5.59 | Failed status |
| `danger` | `white` | 4.5 | 6.54 | Field error text |
<!-- /design-system:contrast -->

### Type rules

- Atkinson Hyperlegible Next sets all text. Atkinson Hyperlegible Mono sets only wallet addresses and transaction references. Both load through `next/font/google` in `src/app/layout.tsx`.
- Use the hero size for one amount per screen.
- Use sentence case everywhere, including buttons and headings. Never set text in all capitals.
- Keep paragraphs under about 70 characters per line.
- Amounts use tabular figures, so digits line up in lists.
- Use one `h1` per page, then `h2` for sections. Never skip a level.

### Shape, elevation and motion rules

- Buttons, inputs, badges and notices use `rounded-control`. The tab card and the result panel use `rounded-card`. Pills, split-bar segments and step markers use `rounded-full`.
- Only the tab card has a shadow, `shadow-tab`.
- Spacing uses Tailwind's 4px steps. Prefer 4, 8, 12, 16, 24, 32, 48 and 64px.
- State changes animate for at most 200ms. The split bar fills over 300ms.
- With `prefers-reduced-motion: reduce`, nothing moves. Spinners become a static icon beside their text.

## Layout

- Content is at most 1080px wide (`max-w-content`), centered, with 24px side padding.
- Create and room screens use two columns from 900px up (the `wide:` prefix), with the main column about 7/12 and the side column about 5/12.
- Below 900px, and at 200% zoom on a laptop, the columns stack. The room stacks the tab card, then the status panel with the viewer's action, then the payer list, so the action never sits below every payer. The create screen stacks the form above its preview. The DOM order matches the stacked order, so keyboard order matches what the viewer sees.
- The result screen is one centered column, at most 640px wide (`max-w-result`).
- Text is left-aligned. Amounts in lists are right-aligned.

Every page has this frame:

```text
+------------------------------------------------------------------+
| OneTab (home)              Test USDC on Solana Devnet  [wallet]  |
+------------------------------------------------------------------+
| (1) Create --- (2) Get ready --- (3) Approve --- (4) Paid         |
| [Sample data banner, only when sample data is shown]              |
|                                                                   |
| page content                                                      |
+------------------------------------------------------------------+
```

Each state names its flow step in the [states table](#states). Create is the create screen. Get ready covers the room before payment starts. Approve covers preparing, signing, and the stopped states, because the next step is approving again. Paid covers sending, finalizing and checking, and it is marked done only when the checkout is paid.

Create checkout:

```text
+-------------------------------+   +----------------------------+
| Split a purchase              |   | TAB CARD (live preview)    |
| Checkout name         [_____] |   | Concert tickets            |
| Seller wallet         [_____] |   | 60.00 test USDC            |
| Total in test USDC    [_____] |   | Seller SAMP...Se11         |
| Split between                 |   | [ Joined | Open | Open ]   |
|   (o) 2 payers  ( ) 3 payers  |   | You       20.00 test USDC  |
| [Review checkout]             |   | Spot 2    20.00 test USDC  |
|                               |   | Spot 3    20.00 test USDC  |
+-------------------------------+   +----------------------------+
```

The review step replaces the form with the full summary, the full seller address, a note that these details can't change after creating, **Create checkout** and **Edit details**.

Checkout room:

```text
+-------------------------------+   +----------------------------+
| TAB CARD                      |   | Status label               |
| Concert tickets               |   | status line                |
| 60.00 test USDC               |   | Your share                 |
| [ approved | ready | open ]   |   | 20.00 test USDC            |
| 2 of 3 joined, 1 ready        |   | [primary action]           |
+-------------------------------+   | quiet secondary actions    |
| Payers                        |   +----------------------------+
| Organizer SAMP...  20.00 Ready|
| You       SAMP...  20.00      |
| Open spot          20.00      |
+-------------------------------+
```

Payment result:

```text
        +--------------------------------------+
        | (icon) Status label                  |
        | Status line: what happened and       |
        | what happens next                    |
        | Connection line, while offline       |
        | Reason, when the payment failed:     |
        | what happened, what to do next       |
        | [primary action, if any]             |
        | Receipt or transaction reference     |
        | Back to checkout                     |
        +--------------------------------------+
        | TAB CARD                             |
        +--------------------------------------+
```

The reason always comes before the action, so the viewer reads why a payment stopped before choosing to try again. The room's status panel shows the same connection line under its status line.

## Components

| Component | Purpose | Variants and states |
| --- | --- | --- |
| Page shell | Header, flow steps, sample banner, page layout | The header holds the logo home link, the network label and the wallet control. Layout is split (create, room) or single (result) |
| Wallet control | Connect, sign in, and show who you are | A quiet **Connect wallet** button when signed out. A spinner and the current step while a wallet prompt is open, with **Cancel**, the payment prompt included. Cancel there stops the page waiting, and the wallet's own prompt still blocks a second one until it answers. When signed in, a menu button with the wallet icon and the short address, holding **Copy address** and **Disconnect**. See [Wallet and sign-in states](#wallet-and-sign-in-states) |
| Sample wallet | Stands in for a real wallet in sample data | Styled like the sample banner and labeled "Sample wallet". When idle it is one line with the selected account, **End sign-in** when it applies, and a **Switch account** disclosure. A pending wallet prompt expands it with **Approve** and **Reject** and is announced politely. Focus never moves on its own. It never opens a real wallet or calls a real route |
| Flow steps | Where the viewer is in the flow | Each step is done, current, or upcoming. Current uses `aria-current="step"` |
| Sample banner | Marks sample data | Visible whenever sample data is shown, with links to the other viewers of the same sample and to every sample |
| Tab card | The checkout at a glance | Title, total, seller, split bar, counts. Tide fill, white text |
| Split bar | One segment per spot | Each segment follows the [spot status](#spot-status) |
| Button | Actions | Primary (Tide fill, white text), primary on Tide (Marigold fill, Deep Tide text), quiet (white, Tide text, strong border), link. States: default, hover, pressed, focus, disabled, loading |
| Text field | Form input | Label above, hint below, error below the hint. States: default, focus, invalid, disabled |
| Choice | Pick 2 or 3 payers | Radio group shown as two side-by-side options |
| Amount | Money values | Number plus "test USDC", tabular figures. A number never breaks across lines. The hero amount can put "test USDC" on the next line, and below 360px (the `max-narrow:` prefix) it takes the title size so its digits fit a 320px screen. The others stay on one line |
| Address | Wallets and transaction references | Mono font. Short form in lists, full form where the user verifies it. The full form has a **Copy** button beside it |
| Payer list | Everyone's spot, share and status | One row per spot. Organizer and You tags |
| Status panel | The current state | Tone, label, status line, the connection line, the reason when a payment failed, your share, and the action group. The status line, the connection line and the reason share one polite live region, so a screen reader hears each change. That block is also where focus lands after a live page moves the viewer between the room and the result, and when an answer removes the focused control and no primary action is left. A direct load or a reload leaves focus alone. The connection line, "Can't reach OneTab right now…", shows on both screens while the latest room read failed, and clears once any request shows a room. The reason comes from the stop reasons table: what happened, then what to do next. It names the cause the room gives, or the one this page's own Start or Try again heard for that exact attempt, and otherwise says the payment stopped before it was sent. It never shows the server's message. While a payer has a payment to approve, the approval summary takes your share's place, above **Approve in wallet**: the share as the hero, the full seller with **Copy**, the total and the network, who pays the network fee, and a note that one approval covers every share |
| Action group | The state's actions | One primary at most. In sample data, actions that need a wallet, the backend or the chain explain themselves and send nothing. A live action shows a spinner and its busy label, such as **Joining…**, and keeps its width, while the group's other buttons wait. A request that changes nothing explains itself in a notice under the actions, which clears when the wallet or the offered actions change, or when the screen shows another attempt. A notice can offer a follow-up, such as **Decline payment** after a refusal in the wallet. The follow-up shows its busy label in the notice, stays offered if it fails, and clears the notice once it goes through. While this page waits on the wallet's payment prompt, **Approve in wallet** on the room screen shows **Approving…**, only for the attempt the prompt is for. Another tab has its own prompt. While spots are open, **I'm ready** and **Not ready yet** are one secondary toggle that keeps its button and focus when it flips. Once the room is full, **I'm ready** is the primary action and **Not ready yet** a secondary one, so a flip removes the focused button. When an answer removes the focused control, focus moves to the primary action, or to the status block when there is none. So **Not ready yet** hands focus to **I'm ready**, and **I'm ready** hands it to the status block, or to **Start payment** for the organizer once everyone is ready. **Try again** shows **Starting…** like **Start payment**, and its notice lasts only while Try again is for the same attempt. When Try again is refused again and leaves a new failed attempt, the notice is about that new attempt and says the new try stopped before it was sent. It shows on every press, and clears once another attempt shows. The notice region stays separate from the status block's live region. On a result that is in progress, unresolved or needs attention, a signed-out viewer gets **Connect wallet** as the primary action, so a payer who reloaded can sign in and the page resumes checking. Before a payment starts, and during approvals, the result keeps **Back to checkout** first. A payment that is sending or unresolved offers nothing else but **Back to checkout** |
| Receipt | Proof of a paid checkout | Seller, total, each contribution, transaction reference, explorer link. It shows only when the room is paid and the receipt names the attempt's own transaction reference, this checkout's seller and total, and every share in spot order. Anything less reads **Finalizing**. The explorer link is built from the reference, never taken from the server. A sample receipt has no explorer link |
| Notice | Inline message | Info, success, warning, danger. Icon plus text |

Buttons:

- A screen state has at most one primary button.
- A disabled button keeps its label and has a visible reason next to it.
- A loading button keeps its width, shows a spinner and changes its label to the ongoing action, such as **Creating…**.
- Every button and link has a target of at least 44 by 44 pixels.

## Spot status

Labels and meanings are in the generated [states](#states) region. Each status also has a fixed look:

| Status | Split bar segment | Icon |
| --- | --- | --- |
| `open` | White outline, dashed | None |
| `joined` | `brand-soft` fill | None |
| `ready` | `brand-soft` fill | Check |
| `approved` | Marigold fill | Check |

Ready and Approved always look different. Ready moves no money.

## States

Every checkout is in exactly one state. Each state has an owner screen, where its primary action lives. The other screen still renders the checkout and links to the owner: the room shows **View payment status** or **View receipt**, and the result shows **Back to checkout**. Neither page redirects, so the **Back to checkout** exit door never bounces back. A live page polls its room, and moves the viewer to the owner screen only when a room it read changes owner, never on first load or after Back.

<!-- design-system:states -->
| State | Screen | Flow step | Tone | Label | Server data |
| --- | --- | --- | --- | --- | --- |
| `open_spots` | room | get_ready | neutral | Waiting for payers | phase open, no attempt, fewer payers than spots |
| `full_not_ready` | room | get_ready | neutral | Getting ready | phase open, no attempt, every spot taken |
| `ready` | room | get_ready | info | Everyone is ready | phase ready, no attempt |
| `preparing` | room | approve | info | Preparing payment | attempt preparing |
| `signing` | room | approve | info | Collecting approvals | attempt signing |
| `submitting` | result | paid | info | Sending payment | attempt submitting |
| `confirming` | result | paid | info | Finalizing | phase paid without a receipt that proves it, or attempt confirmed before the phase is paid |
| `unresolved` | result | paid | warning | Checking the network | attempt unresolved |
| `declined` | result | approve | warning | Approval declined | attempt declined |
| `failed` | result | approve | danger | Payment failed | attempt failed |
| `expired` | result | approve | warning | Payment expired | attempt expired |
| `paid` | result | complete | success | Paid | phase paid, attempt confirmed, and a receipt that matches the checkout, every spot and the attempt's signature |

| Spot status | Label | Meaning |
| --- | --- | --- |
| `open` | Open spot | No payer has taken this spot yet. |
| `joined` | Joined | A payer took this spot and is checking their share. |
| `ready` | Ready | The payer is ready to approve. Ready never moves money. |
| `approved` | Approved | The payer approved this payment in their wallet. Nothing moves until everyone approves. |
<!-- /design-system:states -->

Honesty rules that apply to every state:

1. Show success only when the phase is `paid` and a receipt exists. A transaction reference alone is not success.
2. Never say a declined approval was revoked or canceled.
3. Never offer a new payment while the outcome is `unresolved`.
4. Show **Try again** only when the server says `canRetry` is true, and only to the organizer. It always means everyone approves again.
5. Label every amount as test USDC on Solana Devnet.
6. Sample data is always labeled, never sends anything, and never links a sample transaction to the explorer.

Page states that every screen handles:

| State | What the viewer sees |
| --- | --- |
| Loading | The page layout with placeholder blocks. No layout shift when data arrives. A live checkout's first load waits for the server's read instead, so a missing checkout can still return a real 404 |
| Not found | "We can't find this checkout." with **Create a checkout**. A live checkout shows it, with status 404, only when the server says `CHECKOUT_NOT_FOUND` |
| Unexpected error | What failed, **Try again**, and a link home. A live checkout the server can't read, during an outage or before its route is deployed, shows this page with status 500 |
| Creation unavailable | When GET /api/config fails, the create screen says checkouts can't be created right now and asks the viewer to try again in a moment |
| Sample data | The sample banner on every screen |
| Signed out | The room is readable. Actions ask the viewer to **Connect wallet**. The create review offers **Connect wallet** in place of **Create checkout** |
| Spectator | A full room is readable. The status says the checkout is full |
| Seller | The room is readable, with no actions. While spots are open, the status says the seller doesn't take a spot |

### Wallet and sign-in states

**Connect wallet** is the only way in. It runs two wallet prompts in order and the status names the open one: first the connection, then the sign-in message. Signing in proves the wallet is yours and never moves money, and the sign-in status says so.

<!-- design-system:wallet -->
| State | Status line | Action |
| --- | --- | --- |
| Signed out | None | **Connect wallet** |
| Connecting | "Approve the connection in your wallet." | **Cancel** |
| Signing in | "Sign the sign-in message in your wallet. Signing in proves the wallet is yours. It can't move money." | **Cancel** |
| Checking sign-in | "Signing in…" | **Cancel** |
| Approving | "Approve the payment in your wallet. It covers every share in one payment." | **Cancel** |
| Signed in | None. The header shows the short address, and screen readers hear "Signed in as SAMP…Bea2." | Menu: **Copy address**, **Disconnect** |
| No wallet found | "No Solana wallet found. Install Phantom, then reload this page." | **Get Phantom** |
| Wrong network | "Your wallet isn't on Solana Devnet. Switch it to Devnet, then connect again." | **Connect wallet** |
| Connection refused | "You closed the connection request. Nothing was shared." | **Connect wallet** |
| Sign-in refused | "You didn't sign in. Nothing was signed or sent." | **Sign in again** |
| Wallet can't sign in | "This wallet can't sign in to OneTab. Use Phantom." | **Get Phantom** |
| Sign-in message expired | "That sign-in message expired. Sign in again for a new one." | **Sign in again** |
| Sign-in unavailable | "Sign-in isn't available right now. Try again in a moment." | **Try again** |
| Account switched | "Your wallet switched to SAMP…Bea2. Sign in again to continue as that wallet." | **Sign in again** |
| Sign-in expired | "Your sign-in expired. Sign in again with the same wallet to continue." | **Sign in again** |
<!-- /design-system:wallet -->

Rules for every wallet state:

1. The signed-in wallet is always the wallet's current account, or nobody is signed in. A switched account clears your share, Ready, Approve and any open prompt before anything else happens.
2. A wallet answer that arrives after **Cancel**, a switch or a disconnect changes nothing.
3. Signing in never asks the wallet to sign a payment.
4. **Disconnect** signs you out in the browser at once, even when the server can't be reached.
5. The table above is generated from the wallet tables in `src/client/catalog.ts`. Change the words there, then run `npm run design:write`.

## Copy

- Write in second person and present tense: "You approved", "Waiting for 1 more payer".
- Buttons are verbs that say what happens. The same action keeps the same name across screens.
- Error messages state what went wrong, then what to do. They never blame the user and never lead with a code.
- Keep blockchain terms such as blockhash, signature and lamports off the main path. Details may show a transaction reference.

### Words

Every button label, flow step and fixed word comes from `src/client/catalog.ts`.

<!-- design-system:words -->
| Action | Label | Needs | Element | Busy label |
| --- | --- | --- | --- | --- |
| `review_checkout` | Review checkout | nothing | button |  |
| `edit_details` | Edit details | nothing | button |  |
| `create_checkout` | Create checkout | backend | button | Creating… |
| `copy_link` | Copy link | nothing | button |  |
| `connect_wallet` | Connect wallet | wallet | button |  |
| `join` | Join checkout | backend | button | Joining… |
| `mark_ready` | I'm ready | backend | button | Saving… |
| `mark_not_ready` | Not ready yet | backend | button | Saving… |
| `start_payment` | Start payment | backend | button | Starting… |
| `approve` | Approve in wallet | wallet | button | Approving… |
| `decline` | Decline payment | backend | button | Declining… |
| `retry` | Try again | backend | button | Starting… |
| `view_status` | View payment status | nothing | link |  |
| `view_receipt` | View receipt | nothing | link |  |
| `back_to_checkout` | Back to checkout | nothing | link |  |
| `view_on_explorer` | View on Solana Explorer | chain | external_link |  |
| `open_sample_room` | Open the sample checkout | nothing | link |  |
| `create_a_checkout` | Create a checkout | nothing | link |  |
| `reload_page` | Try again | nothing | button |  |

| Request problem | Notice |
| --- | --- |
| `room_full` | Someone took the last spot first. This checkout is full. |
| `room_changed` | The checkout moved on before this went through. It shows the latest now. |
| `room_changed_unread` | The checkout moved on before this went through. OneTab couldn't load the latest yet. |
| `short_usdc` | A payer's wallet didn't hold their full share in test USDC, so nothing was sent and no network fee was paid. Each payer checks that their wallet holds their share in test USDC on Solana Devnet. |
| `short_sol` | The organizer's wallet didn't hold enough SOL for the network fee, so nothing was sent and no network fee was paid. The organizer adds SOL on Solana Devnet to their wallet. |
| `no_token_account` | A wallet in this payment, a payer's or the seller's, can't receive test USDC yet, so nothing was sent and no network fee was paid. That wallet receives test USDC on Solana Devnet once before the next try. |
| `rate_limited` | Too many tries in a row. Wait a few seconds, then try again. |
| `refused` | OneTab couldn't accept this, so nothing changed. Reload the page and try again. |
| `unavailable` | OneTab couldn't confirm this went through. Trying again is safe. |
| `start_unread` | OneTab couldn't confirm what happened to this payment. This page shows it as soon as it can read the checkout. |
| `mismatch` | The payment OneTab received doesn't match this checkout, so your wallet wasn't opened. Nothing was approved. |
| `unsupported` | Approving isn't available here yet, so your wallet wasn't opened. Nothing was approved. |
| `rejected` | You didn't approve in your wallet, so nothing was sent, and you can approve again. Declining stops this payment for everyone and keeps the checkout on hold until it's safely closed. |
| `busy` | Your wallet already has an approval request open. Finish it there first. |
| `failed` | Your wallet didn't return an approval OneTab can use, so nothing was approved. Try again. |
| `unchecked` | OneTab couldn't check the approval your wallet returned, so nothing was sent. |
| `approval_refused` | OneTab couldn't accept this approval, so nothing was sent. You can approve again. |

| Stop reason | What happened | What to do next |
| --- | --- | --- |
| `short_usdc` | A payer's wallet didn't hold their full share in test USDC, so nothing was sent and no network fee was paid. | Each payer checks that their wallet holds their share in test USDC on Solana Devnet. |
| `short_sol` | The organizer's wallet didn't hold enough SOL for the network fee, so nothing was sent and no network fee was paid. | The organizer adds SOL on Solana Devnet to their wallet. |
| `no_token_account` | A wallet in this payment, a payer's or the seller's, can't receive test USDC yet, so nothing was sent and no network fee was paid. | That wallet receives test USDC on Solana Devnet once before the next try. |
| `network_unreachable` | OneTab couldn't reach Solana Devnet while preparing the payment, so nothing was sent and no network fee was paid. | None. The status line says who can act. |
| `network_rejected` | The network rejected the payment, so no share reached the seller, though the organizer's wallet may have paid a small network fee in SOL. | Before the next try, each payer checks that their wallet still holds their share in test USDC. |
| `not_sent` | The payment stopped before it was sent, so nothing reached the seller and no network fee was paid. | Before the next try, each payer checks that their wallet holds their share in test USDC, and the organizer checks that theirs holds SOL for the network fee. |

| Word | Text |
| --- | --- |
| `product` | OneTab |
| `asset` | test USDC |
| `sample` | Sample data |
| `sample_notice` | Nothing here is a real checkout or payment. |
| `sample_caption` | In sample data, buttons that need a wallet or the network send nothing. |
| `not_connected_in_sample` | isn't connected in sample data. |
| `not_connected_yet` | isn't connected yet. |
| `nothing_sent` | Nothing was sent. |
| `nothing_created` | Nothing was created. |
| `view_as` | View as |
| `all_samples` | All samples |
| `you` | You |
| `organizer` | Organizer |
| `your_share` | Your share |
| `network_fee` | Network fee |
| `fee_you_pay` | You pay the network fee in SOL, because you're the organizer. |
| `fee_organizer_pays` | The organizer pays the network fee, even if your wallet shows one. |
| `approval_covers` | Your approval covers the whole payment, so your wallet may show every share, not just yours. Nothing moves until everyone approves. |
| `payers` | Payers |
| `seller` | Seller |
| `seller_no_spot` | You're the seller, so you don't take a spot. |
| `spot` | Spot |
| `total` | Total |
| `link_copied` | Link copied. |
| `copy` | Copy |
| `copied` | Copied. |
| `copy_failed` | Couldn't copy. Select the text and copy it instead. |
| `opens_new_tab` | (opens in a new tab) |
| `receipt` | Receipt |
| `transaction_reference` | Transaction reference |
| `finalized_at` | Final on |
| `creation_unavailable` | OneTab can't reach its payment service right now, so it can't create a checkout. Try again in a moment. |
| `try_sample` | Try it with sample data |
| `home` | Go to the start |
| `steps` | Checkout steps |
| `cancel` | Cancel |
| `copy_address` | Copy address |
| `disconnect` | Disconnect |
| `wallet` | Wallet |
| `signed_in_as` | Signed in as |
| `sample_wallet` | Sample wallet |
| `sample_wallet_note` | Stands in for a real wallet in sample data. It never signs a payment. |
| `sample_account` | Account |
| `switch_account` | Switch account |
| `connect_request` | OneTab wants to see your wallet address. |
| `sign_request` | OneTab asks you to sign this message: |
| `connect_request_announcement` | Sample wallet: OneTab asks you to approve the connection. |
| `sign_request_announcement` | Sample wallet: OneTab asks you to sign the sign-in message. |
| `approve` | Approve |
| `reject` | Reject |
| `declined` | You declined this payment. |
| `seller_wallet` | seller wallet |
| `you_are_ready` | You're ready. |
| `end_sign_in` | End sign-in |
| `no_payment_yet` | No payment has started yet. Its status appears here once everyone approves. |
| `approvals_soon` | Approvals open on the checkout page in a moment, and this page shows the payment once everyone approves. |
| `approvals_open` | Approvals are open on the checkout page. The payment goes out once every payer approves it, and its status appears here then. |
| `room_unreachable` | Can't reach OneTab right now. This page keeps trying and shows the last update it got. |
| `retry_stopped` | Your new try stopped before it was sent, so nothing moved. The reason is above. |
| `sign_in` | Sign in with your wallet if you hold a spot. |
| `preparing` | Preparing the payment, and approvals open in a moment. |
| `sending` | Sending one payment with every share to the seller, and OneTab confirms it once the network finalizes it. |
| `finalizing` | The network accepted the payment, and the receipt appears once it's final. |
| `unresolved_here` | We can't confirm the result yet, so this page keeps checking the same transaction and no new payment will start. |
| `unresolved_payers` | We can't confirm the result yet, so OneTab keeps checking the same transaction while a payer has this checkout open, and no new payment will start. |
| `payer_declined` | A payer declined, so this payment stays on hold until it's safely closed. |
| `failed_retry` | No share reached the seller. Try again to ask everyone to approve a new payment. |
| `failed_waiting` | No share reached the seller, and the organizer can start a new payment that everyone approves again. |
| `failed_on_hold` | No share reached the seller, and a new payment can start once this one is safely closed. |
| `expired_retry` | This payment expired before reaching the seller. Try again to ask everyone to approve a new payment. |
| `expired_waiting` | This payment expired before reaching the seller, and the organizer can start a new payment that everyone approves again. |
| `expired_on_hold` | This payment expired before reaching the seller, and a new one can start once it's safely closed. |
| `network devnet` | Test USDC on Solana Devnet |
| `flow steps` | Create, Get ready, Approve, Paid |
<!-- /design-system:words -->

### Glossary

| Use | Meaning | Avoid |
| --- | --- | --- |
| checkout | The shared purchase | order, bill, tab (except in the product name) |
| organizer | The payer who created the checkout | host, admin, creator |
| payer | Anyone holding a spot, the organizer included | member, participant, user |
| seller | The wallet that receives the payment | merchant, recipient |
| spot | One payer's place in a checkout | slot, seat |
| ready | Ready to pay. Coordination only, moves no money | confirmed, committed |
| approve, approved | The payer's wallet approval of the one payment | sign, signed, authorize |
| paid | The payment is final and the receipt exists | done, complete, success |
| test USDC on Solana Devnet | The asset | money, funds, dollars, USDC alone |
| sample data | Fixture data shown for development and demos | fake, mock, test data |
| connect | Let OneTab see your wallet address | link, attach, log in |
| sign in, signed in | Prove the wallet is yours by signing a message. Never moves money | authenticate, verify, log in |
| sample wallet | The in-page stand-in for a wallet in sample data | fake wallet, mock wallet |

### Formatting

| Value | Format |
| --- | --- |
| Amount | `1,250.00 test USDC`. At least two decimals, more only when the share needs them, such as `3.333334` |
| Address | Mono. The short form keeps the first and last four characters, such as `SAMP…Bea2`. The full form wraps instead of truncating |
| Count | Numerals: "2 of 3 ready" |
| Time | `Nov 7, 2026, 14:05 UTC` |

## Accessibility

| Area | Rule |
| --- | --- |
| Contrast | Pairs from [Contrast pairs](#contrast-pairs) only. Body text and primary buttons meet AAA |
| Keyboard | Every action works with Tab, Enter and Space. Focus order follows visual order. No traps |
| Focus | A 2px ring with a 2px offset. Tide on light surfaces, Marigold on Tide. Never removed |
| Structure | A skip link first, then `header`, `nav` for the flow steps, and `main`. One `h1` per page |
| Forms | Visible labels. Hints and errors linked with `aria-describedby`. Invalid fields set `aria-invalid` |
| Status | The status line is an `aria-live="polite"` region. Only blocking errors use `role="alert"` |
| Color | Never the only signal. Status and spot status always pair color with an icon and words |
| Motion | Honors `prefers-reduced-motion` |
| Targets | At least 44 by 44 pixels for buttons and links |
| Language | `<html lang="en">` |

## Debugging the UI

To see any state, run `npm run dev` and open http://localhost:3000/samples. Every sample state and viewer has a stable address, such as `/checkouts/sample-signing?as=spot-2`, that you can send to a teammate.

| Symptom | Where to look |
| --- | --- |
| A state shows the wrong label, owner screen or flow step | `SITUATIONS` in `src/client/catalog.ts` |
| A status line or an action is wrong for one viewer | `STATUS_COPY`, `ROOM_ACTIONS` and `resultActions` in `src/client/checkout-view.ts` |
| A button label or fixed word is wrong | `ACTIONS` and `WORDS` in `src/client/catalog.ts`. Run `npm run design:write` after the change |
| A sample shows impossible data | Its spec in `src/client/fixture-data.ts`. `npm test` checks every sample against the contract rules |
| A sample address returns 404 | Sample data is off, or the sample has no such viewer. Use `npm run dev`, or set `ONETAB_FIXTURES=1` for a production build |
| Every live checkout shows the error page | The server has no API origin, or can't reach it. Set `APP_ORIGIN` or `ONETAB_API_ORIGIN`. The server log names the origin it tried, or says none is set |
| A live checkout shows not found | Only the server's `CHECKOUT_NOT_FOUND` does that. Read GET /api/checkouts/:checkoutId on the API origin to check the ID |
| A notice after Create checkout or Join checkout has the wrong words | `REQUEST_PROBLEMS` in `src/client/catalog.ts`, and `REQUEST_PROBLEM_BY_CODE` in `src/client/api.ts`, which maps each error code to a problem |
| An older room replaces a newer one after a join | `roomTracker` in `src/client/live-actions.ts` decides which answer shows. `npm test` drives it through every order of sends and answers |
| A color, size, radius or width does not apply | The class uses a Tailwind default or an arbitrary value, and neither compiles. Use a token from [Tokens](#tokens). `npm run design:check` names the file and line |
| An amount shows the wrong digits | `src/client/units.ts` formats integer units with BigInt and never rounds |
| A screen looks wrong for one state only | After `npm run test:e2e`, open its screenshot in `test-results/screens/` |
| Connect wallet, sign-in or the header control behaves wrongly | Every wallet state and transition is in `src/lib/wallet/machine.ts`. `src/client/wallet-view.ts` turns a state into what the header, the status line and the room's inline action show |
| A wallet message or fix is wrong | The wallet tables in `src/client/catalog.ts`. Run `npm run design:write` after the change |
| Approve in wallet opens no wallet, or says the payment doesn't match | `src/client/payment-check.ts` compares the signing payload with the screen's `ApprovalTerms`. Its byte check answers `unsupported` until Payments' validator is wired |
| A second payment prompt opens, or a late approval is uploaded | `keptOrNewApproval` in `src/lib/wallet/store.ts` holds the page's one payment prompt and drops answers from an earlier sign-in. `npm test` runs every order of a switch, disconnect, expiry or second call against it |
| A room doesn't update, or a page moves to the wrong screen | `watch` and `pollPlan` in `src/client/live-actions.ts`, and `LiveCheckout` in `src/components/viewer.tsx` |
| An account switch or a late wallet answer misbehaves | `npm test` runs the exhaustive test in `src/lib/wallet/machine.test.ts`, which drives every short sequence of wallet events |
| Sign-in calls reach the server in the wrong order | `src/lib/wallet/store.ts` runs every effect and sends sign-in calls one at a time |
| The sample wallet misbehaves | `src/lib/wallet/sample.ts` holds the sample wallet and sign-in service. `src/components/wallet/sample-wallet-panel.tsx` draws it |

These files own the decisions behind every screen:

| File | Owns |
| --- | --- |
| `src/client/checkout-source.ts` | Which data a page gets, including the server's read of a live checkout. The only reader of `ONETAB_FIXTURES` |
| `src/client/api.ts` | Every request to a contract route, and which error code means which problem |
| `src/client/live-actions.ts` | What each live action sends and does next, which room answer a live checkout shows, and what each poll sends |
| `src/client/payment-check.ts` | Whether a signing payload is the payment the screen shows, before any wallet prompt |
| `src/client/fixtures.ts` | Sample addresses, viewers, and the registry that the tests enumerate |
| `src/client/checkout-view.ts` | Every rule about what a viewer sees and can do |
| `src/components/` | Rendering only. No state rules |
| `scripts/design-system.mjs` | The design check and the generated tables in this document |
| `src/components/viewer.tsx` | Gives every screen the wallet's signed-in identity and, for a live checkout, the newest room. F4's poller joins it here |
| `src/lib/wallet/` | The wallet session machine, its store, the live sign-in client, and the sample wallet |

An unknown viewer, such as `?as=bogus`, shows the not-found page with HTTP status 200 instead of 404. The room's loading placeholder starts streaming before the page can reject the viewer, and layouts cannot read query strings.

## Change log

Add a row for every UI or UX change, newest first.

| Date | Change | Why | Card or PR |
| --- | --- | --- | --- |
| 2026-11-07 | Add the stop reasons, what happened and what to do next, in place of the server's message, one notice per funding refusal built from the same words, **Try again** with **Starting…** and a notice when it is refused again, **Connect wallet** for a signed-out viewer of an in-progress, unresolved or needs-attention result, a connection line on both screens while OneTab can't be reached, one live region for the status line, the connection line and the reason, focus on that block after a move between screens, result lines during preparing and during approvals that point to the checkout page, unresolved lines that say who keeps checking, the **Payment expired** label and an expired line that holds whether or not the payment was sent, a failed line without the fee clause, decline copy that says the checkout stays on hold, result lines that keep to two sentences with the sign-in sentence, and a receipt only when it proves this checkout's payment | F5 shows the confirmed result or an accurate account of what remains unresolved. A failure needs its real reason and a next step, a reference alone must never read as paid, and a reload or an outage must keep showing the same attempt | [F5](cards/F5.md), [#11](https://github.com/nefalos-tech/OneTab/issues/11) |
| 2026-11-07 | Add the approval summary, the busy labels **Saving…**, **Starting…**, **Approving…** and **Declining…**, **Decline payment** after a refusal in the wallet, which lasts only while that attempt is on screen, a short note when a decline lands but the room can't be read, the payment prompt's status line with **Cancel**, **Approving…** only on the checkout the prompt is for, notices for a payment that doesn't match, can't start or can't be checked yet, and for an approval OneTab can't check after the wallet answers or the server refuses, after which Approve asks the wallet again, new status lines for getting ready and approving, including **You're ready.** while a spot is still open, so the status line announces each readiness change, a readiness toggle that keeps its button and focus when it flips while spots are open, **Approve in wallet** only for a payer in the room, a 409 notice that says the screen shows the latest only after the room was read again, a hero amount that keeps its digits on one line, wraps only before "test USDC" and takes the title size below 360px, and moves to the owner screen when a polled room changes owner | F4 asks each payer to approve one complete payment. The payer needs to see what they approve before the wallet opens, every wallet outcome needs words and a next step, and every screen follows the shared room | [F4](cards/F4.md), [#10](https://github.com/nefalos-tech/OneTab/issues/10) |
| 2026-11-07 | Add the busy labels **Creating…** and **Joining…**, the request problem notices, the seller's status line, Connect wallet at the create review, outage words for creation unavailable, a title for the error page, and focus moves when an answer removes the focused control | F3 creates checkouts and joins rooms against the real routes. Each request outcome needs words and a next step, and creating needs a signed-in organizer | [F3](cards/F3.md), [#9](https://github.com/nefalos-tech/OneTab/issues/9) |
| 2026-11-07 | Add the wallet control, the sample wallet, the wallet and sign-in states, and the words connect, sign in and sample wallet | F2 connects a wallet and signs in without moving money, and every outcome needs a visible status and a next action | [F2](cards/F2.md), [#8](https://github.com/nefalos-tech/OneTab/issues/8) |
| 2026-11-07 | First version: palette, type, layout, components, states, copy and accessibility rules, with generated token, contrast, state and word tables | F2 to F6 need one design language before they build on the screens | [F1](cards/F1.md), [#7](https://github.com/nefalos-tech/OneTab/issues/7) |
