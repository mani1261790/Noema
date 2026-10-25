# Article social sharing actions

Replaced the article's generic native-share/copy buttons with three service icons and visible short labels: X, Discord, and copy. Each circular icon is 52px with a minimum 72px action width, pointer cursor, keyboard focus ring, and distinct hover state. The row wraps on narrow screens. Series sharing is unchanged.

X uses its intent/tweet composer URL with separately encoded title and canonical article URL. It never posts automatically. Discord uses a normal link to its web client and starts copying the canonical link within the click gesture; the user chooses a channel or DM and pastes it there. No generic Discord URL prefill endpoint was found, so the UI does not pretend to prefill a Discord message. A short instruction below the icons explains the paste step. A failed clipboard request exposes a selectable read-only URL instead of a browser alert. JavaScript-disabled pages retain X and Discord links and manual copying instructions; the script-dependent copy button stays hidden.

Links retain the existing share attribution with bounded x/discord methods, and discard incoming queries/fragments. X has no completion analytics because opening a composer cannot prove publication. Copy success retains the existing share event behavior.

Validation:
- Blog type checks, 160 unit tests plus 39 script tests, and build passed locally.
- Browser checks at 320/390/1280px: no horizontal overflow, target sizes, X destination/title/query, Discord destination/copy, clipboard denial fallback, and JavaScript-disabled behavior.
- Third-party destinations were intercepted and clipboard outcomes simulated. This verifies UI wiring, not logged-in X/Discord behavior or physical-device clipboard permissions. No messages were posted.
- Visual inspection of the rendered share region on mobile and desktop.

Sources:
- X's publisher provides intent/tweet links: https://publish.x.com/
- Discord symbol guidelines: https://discord.com/branding
- Discord SVG geometry from Simple Icons (CC0): https://github.com/simple-icons/simple-icons/blob/develop/icons/discord.svg
