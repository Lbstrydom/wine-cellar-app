Observed issues:
1. 
Issues:
1. The zone_allocations table doesn't have cellar_id column in typical setups, but let me check the migrations. For now, let me update the wines query. Let me also check if we need to add cellar_id to zone_allocations:

Searched for text in migration SQL files
I see that zone_allocations doesn't have cellar_id. This is a problem for multi-tenancy. However, for now, I should note that wine queries need cellar filtering. The zone operations are complex, so let me focus on adding cellar_id filtering where critical. Let me update the wines update query:

We can't skip or jsut focus onc ritical, we need to be systematic: This file is large. Given that cellar.js has 23 queries that need updating according to the automated checker, let me focus on the most critical queries in key endpoints. Let me read more strategically to find the major database operations. same for wines.js and same for ratings.js


4) Buying guide strategy (no code, just product logic)
A. Start with a “Cellar Strategy Wizard” (2–4 minutes)

Ask:

How many bottles do you want “ready to drink” vs “for ageing”?

What do you actually cook most weeks (pick top 5)?

Do you prefer lighter and fresher, or richer and oaked?

Any grapes/regions you love or hate?

How often do you entertain?

Budget bands (everyday / weekend / special)

B. Define a simple target portfolio (coverage over cleverness)

Create a default “broad pairing” base, then customise:

Everyday versatile whites (high acid, low oak)

Food-friendly reds (medium body, balanced tannin)

One aromatic wildcard (spice, Asian food, tricky veg)

One richer white (cream sauces, roast chicken)

One serious red (steak, lamb, slow-cooked)

Sparkling (apertif, salty snacks, celebrations)

Optional: dessert/fortified only if they drink it

This becomes the buying guide’s backbone.

C. Gap analysis from the user’s actual cellar

Show the user:

“You have plenty of bold reds, but you’re missing crisp whites and sparkling.”

“Your drinking windows cluster in 2026–2027; you have little for 2030+.”

“Your fridge-ready selection is narrow (too many similar styles).”

D. Convert gaps into a shopping list with roles, not brands

Recommend “roles” and example styles:

“Crisp saline white” (Muscadet, Albariño, Vermentino)

“Aromatic white” (Riesling, Gewürztraminer in dry/off-dry)

“Chillable red” (Gamay, Pinot Noir)

“Structured age-worthy red” (Nebbiolo, Rioja Reserva, Bordeaux blend)

Let users choose producers they like, but keep the role-based system stable.

E. Close the loop with lightweight feedback

After each bottle:

1-click rating: “Loved / Liked / Meh / Never again”

Optional: “What did you eat with it?”

Optional: “Too acidic / too oaky / too tannic / too sweet”

Over time, your buying guide shifts from generic coverage to their house style.