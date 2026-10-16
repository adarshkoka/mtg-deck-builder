---
name: commander-deckbuilding
description: How to build a balanced 100-card Commander deck from a player's own collection. Use when choosing cards for a commander, checking a deck's balance, or explaining why a card fits.
---

# Building a Commander deck from a collection

## Deck shape (targets for 99 cards plus the commander)

| Category      | Target | What counts                                                    |
|---------------|--------|----------------------------------------------------------------|
| Lands         | 35-38  | Basic lands are added automatically; pick good non-basic lands |
| Ramp          | 10+    | Mana rocks, mana dorks, spells that put lands onto the battlefield |
| Card draw     | 10+    | Anything that draws extra cards or gives repeatable card advantage |
| Removal       | 8+     | Answers to a single threat: destroy, exile, bounce, counter     |
| Board wipes   | 2-4    | Answers to many threats at once                                 |
| Synergy / plan| 25-30  | Cards that work with the commander's strategy and win the game  |

Keep the average mana value of non-land cards around 3. Most of the deck should cost
2-4 mana; only a few cards should cost 6 or more.

## Build order

1. Read the commander's text and name its strategy in one sentence
   (for example, "go wide with creature tokens and pump them").
2. Search for the essentials first, several searches in the same turn:
   ramp, card draw, removal, board wipes, non-basic lands.
3. Search for cards that support the strategy: matching creature types, keywords,
   and mechanics mentioned in the commander's text.
4. Assemble a draft of about 62-64 non-land cards and a few non-basic lands. Basic
   lands fill the rest automatically.
5. Check the draft with get_deck_stats and check_deck_rules, adjust, then submit.

## Choosing between cards

- Prefer cards that do two jobs (a creature that also draws cards).
- Prefer cheaper cards when two cards do the same job.
- Cards that directly reference the commander's mechanic beat generic good cards.
- If the collection is thin in a category, fill it with the best available cards and
  mention the gap in the summary; suggest a few purchases if a purchase tool is available.

## Writing reasons

Each reason is one or two sentences, specific to this commander:
"Makes a 1/1 Soldier each turn, which the commander turns into an army" is good;
"Good card" is not.
