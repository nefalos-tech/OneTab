# OneTab design system

This is the reference for how OneTab looks, reads and behaves. It covers the three desktop screens: create checkout, checkout room, and payment result. [Design decisions](design-decisions.md) explains why each rule exists.

Every UI or UX change updates this file in the same pull request. Four regions below are generated from code, so they cannot drift. The tokens come from `src/app/globals.css`, contrast ratios are computed from those tokens, and the states and words come from `src/client/catalog.ts`. Run `npm run design:write` to regenerate them. `npm run design:check` fails when a region is stale, a token has no documented role, a contrast pair misses its minimum, or `src/` uses an off-system value such as `bg-[#fff]`. Write the rest of this file by hand, and add a line to the [change log](#change-log) for every change. The steps are in [Change the UI design](development.md#change-the-ui-design).

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
| Scannability | Amount first, label second. Headings state the point, such as "Your share". Explanations are at most two short sentences |
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
- Create and room screens use two columns from 900px up (the `wide:` prefix), with the main column about 7/12 and the side column about 5/12. Below 900px they stack, main column first.
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
| What are you buying?  [_____] |   | Concert tickets            |
| Seller wallet         [_____] |   | 60.00 test USDC            |
| Total in test USDC    [_____] |   | [ 20.00 | 20.00 | 20.00 ]  |
| Split between      (2)  (3)   |   | Seller SAMP...Se11         |
| [Review checkout]             |   |                            |
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
        | [primary action, if any]             |
        | Receipt or payment summary           |
        | Back to checkout                     |
        +--------------------------------------+
```

## Components

| Component | Purpose | Variants and states |
| --- | --- | --- |
| Page shell | Header, flow steps, sample banner, page layout | The header holds the logo home link, the network label and the wallet slot. Layout is split (create, room) or single (result) |
| Flow steps | Where the viewer is in the flow | Each step is done, current, or upcoming. Current uses `aria-current="step"` |
| Sample banner | Marks sample data | Visible whenever sample data is shown, with links to the other viewers of the same sample and to every sample |
| Tab card | The checkout at a glance | Title, total, seller, split bar, counts. Tide fill, white text |
| Split bar | One segment per spot | Each segment follows the [spot status](#spot-status) |
| Button | Actions | Primary (Tide fill, white text), primary on Tide (Marigold fill, Deep Tide text), quiet (white, Tide text, strong border), link. States: default, hover, pressed, focus, disabled, loading |
| Text field | Form input | Label above, hint below, error below the hint. States: default, focus, invalid, disabled |
| Choice | Pick 2 or 3 payers | Radio group shown as two side-by-side options |
| Amount | Money values | Number plus "test USDC", tabular figures |
| Address | Wallets and transaction references | Mono font. Short form in lists, full form where the user verifies it. Copy button beside it |
| Payer list | Everyone's spot, share and status | One row per spot. Organizer and You tags |
| Status panel | The current state | Tone, label, status line, your share, and the action group |
| Action group | The state's actions | One primary at most. In sample data, actions that need a wallet, the backend or the chain explain themselves and send nothing |
| Receipt | Proof of a paid checkout | Seller, total, each contribution, transaction reference, explorer link. A sample receipt has no explorer link |
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
| `ready` | `brand-soft` fill | Tide check |
| `approved` | Marigold fill | Deep Tide check |

Ready and Approved always look different. Ready moves no money.

## States

Every checkout is in exactly one state. Each state has an owner screen, where its primary action lives. The other screen still renders the checkout and links to the owner: the room shows **View payment status** or **View receipt**, and the result shows **Back to checkout**. Neither page redirects, so the **Back to checkout** exit door never bounces back. When live polling arrives, a page may move the viewer to the owner screen only when the state changes owner, never on first load.

<!-- design-system:states -->
| State | Screen | Flow step | Tone | Label | Server data |
| --- | --- | --- | --- | --- | --- |
| `open_spots` | room | get_ready | neutral | Waiting for payers | phase open, no attempt, fewer payers than spots |
| `full_not_ready` | room | get_ready | neutral | Getting ready | phase open, no attempt, every spot taken |
| `ready` | room | get_ready | info | Everyone is ready | phase ready, no attempt |
| `preparing` | room | approve | info | Preparing payment | attempt preparing |
| `signing` | room | approve | info | Collecting approvals | attempt signing |
| `submitting` | result | paid | info | Sending payment | attempt submitting |
| `confirming` | result | paid | info | Finalizing | attempt confirmed, but no receipt or phase not paid |
| `unresolved` | result | paid | warning | Checking the network | attempt unresolved |
| `declined` | result | approve | warning | Approval declined | attempt declined |
| `failed` | result | approve | danger | Payment failed | attempt failed |
| `expired` | result | approve | warning | Approval window ended | attempt expired |
| `paid` | result | complete | success | Paid | phase paid and attempt confirmed with a receipt |

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
| Loading | The page layout with placeholder blocks. No layout shift when data arrives |
| Not found | "We can't find this checkout." with **Create a checkout** |
| Unexpected error | What failed, **Try again**, and a link home |
| Creation unavailable | The create screen explains that checkouts can't be created right now |
| Sample data | The sample banner on every screen |
| Signed out | The room is readable. Actions ask the viewer to **Connect wallet** |
| Spectator | A full room is readable. The status says the checkout is full |

## Copy

- Write in second person and present tense: "You approved", "Waiting for 1 more payer".
- Buttons are verbs that say what happens. The same action keeps the same name across screens.
- Error messages state what went wrong, then what to do. They never blame the user and never lead with a code.
- Keep blockchain terms such as blockhash, signature and lamports off the main path. Details may show a transaction reference.

### Words

Every button label, flow step and fixed word comes from `src/client/catalog.ts`.

<!-- design-system:words -->
| Action | Label | Needs | Element |
| --- | --- | --- | --- |
| `review_checkout` | Review checkout | nothing | button |
| `edit_details` | Edit details | nothing | button |
| `create_checkout` | Create checkout | backend | button |
| `copy_link` | Copy link | nothing | button |
| `connect_wallet` | Connect wallet | wallet | button |
| `join` | Join checkout | backend | button |
| `mark_ready` | I'm ready | backend | button |
| `mark_not_ready` | Not ready yet | backend | button |
| `start_payment` | Start payment | backend | button |
| `approve` | Approve in wallet | wallet | button |
| `retry` | Try again | backend | button |
| `view_status` | View payment status | nothing | link |
| `view_receipt` | View receipt | nothing | link |
| `back_to_checkout` | Back to checkout | nothing | link |
| `view_on_explorer` | View on Solana Explorer | chain | external_link |
| `open_sample_room` | Open the sample checkout | nothing | link |
| `create_a_checkout` | Create a checkout | nothing | link |
| `reload_page` | Try again | nothing | button |

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
| `payers` | Payers |
| `seller` | Seller |
| `spot` | Spot |
| `total` | Total |
| `wallet_not_connected` | No wallet connected |
| `viewing_as` | Viewing as |
| `link_copied` | Link copied. |
| `copy` | Copy |
| `copied` | Copied. |
| `copy_failed` | Couldn't copy. Select the text and copy it instead. |
| `opens_new_tab` | (opens in a new tab) |
| `receipt` | Receipt |
| `transaction_reference` | Transaction reference |
| `finalized_at` | Final on |
| `try_sample` | Try it with sample data |
| `home` | Go to the start |
| `steps` | Checkout steps |
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

FILL_AFTER_IMPLEMENTATION

## Change log

Add a row for every UI or UX change, newest first.

| Date | Change | Why | Card or PR |
| --- | --- | --- | --- |
| 2026-11-07 | First version: palette, type, layout, components, states, copy and accessibility rules, with generated token, contrast, state and word tables | F2 to F6 need one design language before they build on the screens | [F1](cards/F1.md), [#7](https://github.com/nefalos-tech/OneTab/issues/7) |
