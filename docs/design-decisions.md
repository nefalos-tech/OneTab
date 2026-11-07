# Why OneTab looks and reads this way

This page explains the reasoning behind the [design system](design-system.md). The design system lists the rules. This page says why they exist, which alternatives lost, and what would justify changing them. Record each later change in the design system's [change log](design-system.md#change-log).

## The audience decides the defaults

OneTab asks two or three friends to approve one shared payment from their own wallets. The people who use it are millennials and younger. They use banking and chat apps every day, but many have never approved a crypto transaction. Every screen therefore has one job: show each payer their exact share, get the same approval from everyone, and say honestly what is happening at every moment.

Two consequences follow. The interface borrows familiar patterns from shopping checkouts and banking apps instead of crypto tools. It also avoids blockchain words on the main path. "Approve in wallet" replaces "sign transaction", and "spot" replaces "slot".

## About the palette

The team asked for a primary color slightly lighter than `#013D5A`, plus white, plus a third color.

### Primary: Tide `#065379`

`#013D5A` stays in the system as Deep Tide, the color of body text and headings. Text in Deep Tide reads 11.56:1 on white, which is more contrast than the AAA minimum of 7:1. Tinting text toward the brand also makes the page feel like one product.

Tide, the primary, keeps the exact hue angle of `#013D5A` (238° in OKLCH) and is about 8 OKLCH lightness points lighter. White text on Tide reads 8.33:1, so primary buttons pass AAA. Lighter candidates were rejected because `#11607F` drops below 7:1 with white text. Darker candidates such as `#014A6F` were too close to Deep Tide to tell apart as text and button.

### Third color: Marigold `#FFC845`

The third color has to do three jobs. It marks progress on the split bar. It highlights the payer's own share. It fills the one primary button that sits on a Tide surface. It must never be mistaken for a status color, and it must survive common color blindness.

The candidates were scored with `scripts/palette-candidates.mjs`. To score other colors, pass their hex values, for example `node scripts/palette-candidates.mjs "#FFD23F" "#B8A6FF"`. "Distance" is the OKLab difference between the candidate and Tide after simulating deuteranopia, protanopia, and tritanopia. The table keeps the smallest of the three.

| Candidate | Hex | Deep Tide text on it | It on Tide | Distance from Tide | Nearest status color |
| --- | --- | --- | --- | --- | --- |
| Marigold | `#FFC845` | 7.49:1 | 5.39:1 | 0.44 | warning, 0.38 |
| Sunflower | `#FFD23F` | 8.01:1 | 5.77:1 | 0.47 | warning, 0.40 |
| Coral | `#FF7A5C` | 4.51:1 | 3.25:1 | 0.25 | danger, 0.23 |
| Mint | `#5FE0B7` | 7.06:1 | 5.09:1 | 0.39 | success, 0.34 |
| Lime | `#C6F05A` | 8.82:1 | 6.35:1 | 0.47 | success, 0.43 |
| Lilac | `#B8A6FF` | 5.47:1 | 3.94:1 | 0.33 | danger, 0.36 |
| Apricot | `#FFB067` | 6.42:1 | 4.62:1 | 0.37 | danger, 0.33 |

Yellow against blue survives red-green color blindness, the most common kind, which is why both yellows lead the distance column. Marigold won over Sunflower on feel, not numbers. Sunflower scores slightly higher, but next to Tide it reads lemon-cold, while Marigold reads gold, which suits money and a finished payment. Sunflower remains the runner-up. Swapping it in is a one-token change.

The other candidates lost for concrete reasons:

- Coral fails AA as text on Tide and sits closest to the danger red, so a coral button could look like an error.
- Mint and Lime read as the success green, and a payment app cannot let "approved" look like "paid".
- Lilac fails AA as text on Tide and has the weakest separation.
- Apricot sits between the warning and danger colors.

### Status colors stay separate from the brand

Success green, warning orange, and danger red each appear only in status messages, always with an icon and words. Marigold never signals a status. Success green appears only on the Paid result, so green always means the seller received the money.

## About the typeface

Every payer checks an amount and a seller address before approving. A misread character there costs real money in a production version of the app, so legibility outranks personality. Atkinson Hyperlegible Next was designed by the Braille Institute to keep easily confused characters distinct, such as `1`, `l`, and `I`, or `0` and `O`. Atkinson Hyperlegible Mono, from the same family, sets wallet addresses and transaction references so that characters line up for comparison.

Inter and Geist were rejected because they are the defaults of countless templates and give the product no character. Lexend was close on readability but is wider and fits fewer address characters per line.

The scale has five sizes and three weights, which is enough for one hero amount, a page title, section headings, body, and small print.

## About the tab card and the split bar

The product's core idea is one bill split into equal parts that everyone approves together. The tab card shows that idea directly. The split bar is one bar with a segment per payer spot, and each segment fills as that spot joins, gets ready, and approves. It is the only filled card on the page and the only place where Marigold appears in quantity. Everything around it stays white and quiet, so the bar is where the eye goes first.

## About the words

Each concept gets one word, used everywhere. The spec says "signed". The interface says "approve" because that is the word wallets show on their buttons and the word people use for authorizing a payment. "Ready" exists only for coordination and moves no money, so it is never styled like "Approved".

Honest wording is a rule, not a tone choice. The app never says a payment succeeded until the receipt is final. It never says a declined approval was revoked, because signatures cannot be withdrawn. It never offers a new payment while the outcome of the old one is unknown. The [specification](../spec.md#attempt-states-and-retries) defines these limits, and the [states table](design-system.md#states) applies them screen by screen.

## How the rules stay enforced

Written rules drift unless something checks them. Three mechanisms hold the line:

- `src/app/globals.css` disables Tailwind's default palette, type scale, weights, radii, shadows, breakpoints and widths. An off-system class such as `bg-red-500` or `text-7xl` generates no CSS, so it shows up as missing styling during development.
- `npm run design:check` regenerates the token, contrast, state and word tables of the design system from code and fails when the committed document differs. It also fails when a token has no documented role, when a contrast pair falls below its minimum, and when `src/` uses an arbitrary value such as `bg-[#fff]` that would bypass the tokens.
- The state and word tables come from `src/client/catalog.ts`, the same registry the screens read. A new state or button label cannot reach the screens without reaching the document.

CI runs these checks on every pull request.
