# Multi-Language Test Menu Samples

Reference data for testing restaurant pairing menu parsing with non-English menus.
Images provided by user (Dutch restaurant "Sam Sam").

---

## Dutch Food Menu — "Sam Sam Gerechjes"
*Source: User-provided image, February 2025*
*Subtitle: "Leuk om te delen of je eigen menu samen te stellen" (Fun to share or create your own menu)*
*Category type: Sharing / Mix-and-match*

| # | Dutch Name | English Translation | Description (Dutch) | English Description | Price | Notes |
|---|-----------|---------------------|---------------------|---------------------|-------|-------|
| 1 | Gestoomde Bao Bun | Steamed Bao Bun | met ketjap gelakte buikspek, zoetzure groenten en smokey cocktailsaus | With soy-glazed pork belly, sweet & sour vegetables and smokey cocktail sauce | 13,90 | |
| 2 | Vistrio van zalm, makreel en gamba's | Fish trio of salmon, mackerel and prawns | op brioche brood met remoulade crème, rode biet en komkommer | On brioche bread with remoulade cream, red beetroot and cucumber | 13,90 | |
| 3 | Portobello margherita | Portobello margherita | met buratta, tomaat, basilicum en noten sla | With burrata, tomato, basil and mixed leaf salad | 13,90 | (V) |
| 4 | Ossenhaas | Beef tenderloin | met Roseval aardappelen, rode kool, stoofpeertjes en pepersaus | With Roseval potatoes, red cabbage, stewed pears and pepper sauce | 18,90* | |
| 5 | Spaghetti met truffelroomsaus | Spaghetti with truffle cream sauce | gebakken paddenstoelen en Parmezaanse kaas | Fried mushrooms and Parmesan cheese | 13,90 | (V) |
| 6 | In knoflook gebakken doradefilet | Garlic-fried sea bream fillet | met saffraan risotto en een salsa van tomaat, pijnboompitten, kappertjes, balsamico en dragon | With saffron risotto and a salsa of tomato, pine nuts, capers, balsamic and tarragon | 18,90* | |
| 7 | Carpaccio | Carpaccio | met Pesto mayonaise, Parmezaanse kaas, pijnboompitten, zongedroogde tomaat en rucola | With pesto mayonnaise, Parmesan cheese, pine nuts, sun-dried tomato and arugula | 13,90 | |
| 8 | Saffraan risotto | Saffron risotto | met gepofte paprika, groene asperges, bospeentjes en burrata | With roasted bell pepper, green asparagus, baby carrots and burrata | 13,90 | (V) |
| 9 | Peking eend pannenkoekjes | Peking duck pancakes | met komkommer, prei en hoisinsaus | With cucumber, leek and hoisin sauce | 13,90 | |

**Price notes**: Prices use European comma decimal format (13,90 = €13.90). Items marked * are 18,90.

---

## Dutch Wine List
*Source: User-provided image, February 2025*
*Prices shown as: glass / bottle (European comma decimal format)*

### Witte Wijn (White Wine)

| # | Wine | Grape / Style | Region | Country (Dutch→English) | Glass | Bottle | Tasting Notes (Dutch) | English Tasting Notes |
|---|------|---------------|--------|------------------------|-------|--------|----------------------|----------------------|
| 1 | Dom Doriac 'Reserve' | Chardonnay | Languedoc | Frankrijk → France | 5,75 | 27.90 | Romig, rijp geel fruit, zwoel, licht vettig, volle houttonen | Creamy, ripe yellow fruit, sultry, slightly oily, full oak tones |
| 2 | Diemersdal | Sauvignon Blanc | Durbanville | Zuid-Afrika → South Africa | 6.00 | 29.20 | Klassiek, tropisch fruit, verfijnd, mineralen | Classic, tropical fruit, refined, minerals |
| 3 | Domaine De La Rossignole Sancerre | Sauvignon Blanc | Loire | Frankrijk → France | — | 35.50 | Strak droog, frisse zuren, kruidige tonen, mineralen | Tight dry, fresh acidity, spicy tones, minerals |
| 4 | Mantlerhof | Grüner Veltliner | — | Oostenrijk → Austria | — | 37,50 | licht geel, vol, geel fruit, zacht, aangenaam droog | Light yellow, full, yellow fruit, soft, pleasantly dry |
| 5 | Beauroy Chablis Premier Cru | Chardonnay | Bourgogne | Frankrijk → France | — | 42.50 | Wit fruit, mineralen, kalk, vol, droog | White fruit, minerals, chalk, full, dry |

### Rode Wijn (Red Wine)

| # | Wine | Grape / Style | Region | Country (Dutch→English) | Glass | Bottle | Tasting Notes (Dutch) | English Tasting Notes |
|---|------|---------------|--------|------------------------|-------|--------|----------------------|----------------------|
| 1 | Rosso Piceno 'Viabore' | Sangiovese en Montepulciano | Marche | Italië → Italy | 5.75 | 27.90 | Robijnrood, fruitig, mild fruit, droog | Ruby red, fruity, mild fruit, dry |
| 2 | Domaine Muret | Syrah | Languedoc | Frankrijk → France | 5.90 | 28.60 | Donkerrood, cassis, pruimen, bessen | Dark red, blackcurrant, plums, berries |
| 3 | Diemersdal | Pinotage | Durbanville | Zuid-Afrika → South Africa | 6.60 | 32.00 | Rood fruit, kruiden/specerijen, chocolade, hout | Red fruit, herbs/spices, chocolate, wood |

---

## Expected Parse Behaviour

### Wine List
- All 8 wines should be detected (5 white + 3 red)
- Wines with both glass/bottle prices should create TWO entries (one `by_the_glass: true`, one `false`)
- Country names should be translated to English (Frankrijk→France, Zuid-Afrika→South Africa, etc.)
- European decimal format (5,75 → 5.75) should be parsed correctly
- Colours should be inferred: Chardonnay/Sauvignon Blanc→white, Pinotage/Syrah/Sangiovese→red

### Food Menu
- All 9 dishes should be detected
- Category should be "Sharing" (header says "Sam Sam Gerechjes" — sharing-style)
- Descriptions should include English translation of Dutch ingredients
- (V) suffix should be noted in description as "Vegetarian"
- Prices: 13,90 → 13.90 (European comma decimal)

---

## Testing Multi-Language Support

These samples can be used to test:
1. Dutch menu parsing (image + text)
2. European price format handling (comma decimal)
3. Non-English dish name preservation
4. English translation in descriptions for pairing context
5. Country name translation in wine regions
6. Category inference from foreign-language section headers

### Other Languages to Test

| Language | Section Headers | Example Dishes |
|----------|----------------|----------------|
| Finnish | Alkuruoat (Starters), Pääruoat (Mains), Jälkiruoat (Desserts) | Lohikeitto (Salmon soup) |
| German | Vorspeisen, Hauptgerichte, Nachspeisen | Wiener Schnitzel, Rinderbraten |
| French | Entrées, Plats, Desserts | Confit de canard, Bouillabaisse |
| Spanish | Entrantes, Platos principales, Postres | Paella, Croquetas |
| Italian | Antipasti, Primi, Secondi, Dolci | Risotto ai funghi, Ossobuco |
