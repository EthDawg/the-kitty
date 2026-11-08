"""The Davies household's grocery receipts (fictional), rebuilt from one seed.

    python3 data/groceries/generate.py

Reads data/snapshot-v2.json (the Davies Entries) and writes, next to this file:
  receipts.csv, receipt-lines.csv   the sheet-version-3 Receipts and Receipt Lines tabs, headers exact
  accounts.json                     gift cards (ACC-GC-1..5) and a cash wallet, in the Accounts shape
  gift-cards.json                   each card: load date, value, source "gift", every use, balance left
  merchants.json                    the MER- keys the receipts use
  bank-additions.json               four Entries rows the bank would also show (split card parts, a refund)
  sealed/key.json                   the truth for every receipt and line, the files, the traps, the sample

Everything is fictional: Jordan, Mia and their toddler Ava; products and brands are invented;
merchant names match the Davies bank rows. Money is held in integer cents throughout.
"""
import csv, json, random, re, datetime as dt
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SEED = 3027
rng = random.Random(SEED)
D = dt.date.fromisoformat
AS_OF = D("2027-01-31")
START = D("2025-07-01")

RECEIPT_HEADERS = ["Receipt ID", "Date", "Time", "Merchant", "Merchant ID", "Store", "Channel", "Person", "Items",
                   "Total", "GST", "Savings", "Paid with", "Entry ID", "Account ID", "Source", "Source kind",
                   "Read by", "Check", "Note"]
LINE_HEADERS = ["Receipt ID", "Line", "Printed text", "Product", "Brand", "Group", "Kind", "Qty", "Unit",
                "Unit price", "Amount", "GST", "Pack size", "Price per kg or L", "Retailer code", "Note"]
GROUPS = ["Fruit & veg", "Meat & seafood", "Dairy & eggs", "Bakery", "Pantry", "Snacks & sweets", "Drinks", "Frozen",
          "Prepared meals", "Baby", "Health & beauty", "Household", "Alcohol", "Pet", "Other"]

# --------------------------------------------------------------------------------------------------------------
# Products. key, plain name, group, taxable, pack, sold (each|kg), base Woolworths price in cents (Jul 2025),
# brand ("HOUSE" = the store's own, "" = loose / unbranded), short printed name, visit frequency, qty choices,
# availability window. GST follows the ATO's GST-free food rules: basic food is GST-free; confectionery,
# savoury snacks, sweet biscuits, soft drinks, ice cream, prepared meals, household and health & beauty are taxable.
F, T = False, True
PRODUCTS = [
    # Fruit & veg, loose by weight
    ("banana", "Bananas", "Fruit & veg", F, "", "kg", 390, "", "BANANAS CAVENDISH", .95, [1]),
    ("apple", "Royal Gala apples", "Fruit & veg", F, "", "kg", 550, "", "APPLES ROYAL GALA", .8, [1]),
    ("carrot", "Carrots", "Fruit & veg", F, "", "kg", 250, "", "CARROTS LOOSE", .6, [1]),
    ("onion", "Brown onions", "Fruit & veg", F, "", "kg", 300, "", "ONIONS BROWN", .45, [1]),
    ("broccoli", "Broccoli", "Fruit & veg", F, "", "kg", 690, "", "BROCCOLI", .55, [1]),
    ("tomato", "Truss tomatoes", "Fruit & veg", F, "", "kg", 890, "", "TOMATOES TRUSS", .5, [1]),
    ("zucchini", "Zucchini", "Fruit & veg", F, "", "kg", 690, "", "ZUCCHINI GREEN", .35, [1]),
    ("sweetpot", "Sweet potato", "Fruit & veg", F, "", "kg", 450, "", "SWEET POTATO GOLD", .35, [1]),
    ("pear", "Packham pears", "Fruit & veg", F, "", "kg", 490, "", "PEARS PACKHAM", .3, [1]),
    ("mandarin", "Mandarins", "Fruit & veg", F, "", "kg", 490, "", "MANDARINS IMPERIAL", .5, [1], ("04-01", "10-15")),
    ("nectarine", "Yellow nectarines", "Fruit & veg", F, "", "kg", 690, "", "NECTARINES YELLOW", .5, [1], ("12-01", "03-15")),
    # Fruit & veg, each
    ("potato2", "Washed potatoes 2kg", "Fruit & veg", F, "2kg", "each", 550, "", "POTATOES WASHED 2KG", .4, [1]),
    ("cucumber", "Lebanese cucumber", "Fruit & veg", F, "", "each", 120, "", "CUCUMBER LEBANESE", .55, [1, 2, 3]),
    ("avocado", "Hass avocado", "Fruit & veg", F, "", "each", 200, "", "AVOCADO HASS", .5, [1, 2, 3]),
    ("spinach", "Baby spinach 120g", "Fruit & veg", F, "120g", "each", 350, "HOUSE", "BABY SPINACH 120G", .55, [1]),
    ("strawb", "Strawberries 250g", "Fruit & veg", F, "250g", "each", 400, "", "STRAWBERRIES 250G", .45, [1, 2]),
    ("blueb", "Blueberries 125g", "Fruit & veg", F, "125g", "each", 450, "", "BLUEBERRIES 125G", .4, [1, 2]),
    ("lemon", "Lemon", "Fruit & veg", F, "", "each", 90, "", "LEMONS", .3, [1, 2, 3]),
    ("garlic", "Garlic", "Fruit & veg", F, "", "each", 100, "", "GARLIC LOOSE", .3, [1, 2]),
    # Meat & seafood
    ("mince", "Beef mince 500g", "Meat & seafood", F, "500g", "each", 700, "HOUSE", "BEEF MINCE 3 STAR 500G", .8, [1, 2]),
    ("chbreast", "Chicken breast fillets 1kg", "Meat & seafood", F, "1kg", "each", 1250, "HOUSE", "CHICKEN BREAST FILLET 1KG", .7, [1]),
    ("chthigh", "Chicken thigh fillets 1kg", "Meat & seafood", F, "1kg", "each", 1400, "HOUSE", "CHICKEN THIGH FILLET 1KG", .45, [1]),
    ("lamb", "Lamb loin chops 500g", "Meat & seafood", F, "500g", "each", 1300, "HOUSE", "LAMB LOIN CHOPS 500G", .3, [1]),
    ("sausage", "Pork sausages 500g", "Meat & seafood", F, "500g", "each", 650, "HOUSE", "PORK SAUSAGES 500G", .4, [1]),
    ("salmon", "Salmon fillets 250g", "Meat & seafood", F, "250g", "each", 1050, "HOUSE", "SALMON PORTIONS SKIN ON 250G", .4, [1]),
    ("ham", "Shaved ham", "Meat & seafood", F, "", "kg", 1500, "", "DELI HAM SHAVED", .25, [1]),
    # Dairy & eggs
    ("milk2", "Full cream milk 2L", "Dairy & eggs", F, "2L", "each", 310, "HOUSE", "FULL CREAM MILK 2L", .95, [2, 2, 3]),
    ("eggs", "Free range eggs 12 pack", "Dairy & eggs", F, "700g", "each", 620, "HOUSE", "FREE RANGE EGGS 12PK 700G", .7, [1]),
    ("yoghurt", "Greek yoghurt 1kg", "Dairy & eggs", F, "1kg", "each", 650, "Hillmoor", "GREEK YOGHURT NATURAL 1KG", .5, [1, 2]),
    ("butter", "Salted butter 250g", "Dairy & eggs", F, "250g", "each", 550, "HOUSE", "BUTTER SALTED 250G", .35, [1]),
    ("cheese", "Tasty cheese block 500g", "Dairy & eggs", F, "500g", "each", 750, "Highfield", "TASTY CHEESE BLOCK 500G", .5, [1]),
    ("slices", "Cheese slices 250g", "Dairy & eggs", F, "250g", "each", 420, "HOUSE", "CHEESE SLICES 250G", .3, [1]),
    ("creamch", "Cream cheese 250g", "Dairy & eggs", F, "250g", "each", 350, "HOUSE", "CREAM CHEESE BLOCK 250G", .2, [1]),
    # Bakery
    ("bread", "White sandwich bread 700g", "Bakery", F, "700g", "each", 270, "HOUSE", "WHITE SANDWICH BREAD 700G", .8, [1, 2]),
    ("wmeal", "Wholemeal bread 700g", "Bakery", F, "700g", "each", 270, "HOUSE", "WHOLEMEAL BREAD 700G", .4, [1]),
    ("sourdough", "Sourdough loaf 650g", "Bakery", F, "650g", "each", 650, "Old Mill", "SOURDOUGH LOAF 650G", .35, [1]),
    ("wraps", "Wraps 8 pack", "Bakery", F, "8pk", "each", 350, "HOUSE", "WRAPS ORIGINAL 8PK", .35, [1]),
    ("croissant", "Croissants 4 pack", "Bakery", T, "4pk", "each", 500, "HOUSE", "CROISSANTS 4PK", .25, [1]),
    # Pantry
    ("cereal", "Wheat biscuit cereal 1.2kg", "Pantry", F, "1.2kg", "each", 600, "Sunvale", "WHEAT BITES CEREAL 1.2KG", .4, [1]),
    ("oats", "Rolled oats 1kg", "Pantry", F, "1kg", "each", 250, "HOUSE", "ROLLED OATS 1KG", .3, [1]),
    ("pasta", "Spaghetti 500g", "Pantry", F, "500g", "each", 150, "HOUSE", "SPAGHETTI 500G", .45, [1, 2]),
    ("sauce", "Pasta sauce 500g", "Pantry", F, "500g", "each", 380, "Casa Ferro", "PASTA SAUCE NAPOLETANA 500G", .4, [1, 2]),
    ("rice", "Jasmine rice 2kg", "Pantry", F, "2kg", "each", 600, "HOUSE", "JASMINE RICE 2KG", .2, [1]),
    ("oil", "Extra virgin olive oil 750ml", "Pantry", F, "750ml", "each", 1100, "HOUSE", "EXTRA VIRGIN OLIVE OIL 750ML", .15, [1]),
    ("tinned", "Diced tomatoes 400g", "Pantry", F, "400g", "each", 110, "HOUSE", "DICED TOMATOES 400G", .4, [2, 3, 4]),
    ("pbutter", "Peanut butter 375g", "Pantry", F, "375g", "each", 400, "Nutkin", "PEANUT BUTTER SMOOTH 375G", .2, [1]),
    ("honey", "Honey 500g", "Pantry", F, "500g", "each", 650, "HOUSE", "PURE HONEY 500G", .1, [1]),
    ("coffee", "Coffee beans 1kg", "Pantry", F, "1kg", "each", 2200, "Darkbird", "COFFEE BEANS ESPRESSO 1KG", .25, [1]),
    ("tea", "Tea bags 100 pack", "Pantry", F, "100pk", "each", 350, "HOUSE", "TEA BAGS 100PK", .1, [1]),
    ("yeast", "Yeast spread 380g", "Pantry", F, "380g", "each", 750, "Bluegum", "YEAST SPREAD 380G", .08, [1]),
    ("tsauce", "Tomato sauce 500ml", "Pantry", F, "500ml", "each", 350, "HOUSE", "TOMATO SAUCE 500ML", .1, [1]),
    ("flour", "Plain flour 2kg", "Pantry", F, "2kg", "each", 300, "HOUSE", "PLAIN FLOUR 2KG", .08, [1]),
    ("sugar", "White sugar 2kg", "Pantry", F, "2kg", "each", 340, "HOUSE", "WHITE SUGAR 2KG", .06, [1]),
    ("beans", "Baked beans 420g", "Pantry", F, "420g", "each", 160, "HOUSE", "BAKED BEANS 420G", .25, [1, 2]),
    ("tuna", "Tuna in springwater 95g", "Pantry", F, "95g", "each", 150, "HOUSE", "TUNA SPRINGWATER 95G", .25, [2, 3]),
    ("stock", "Chicken stock 1L", "Pantry", F, "1L", "each", 300, "HOUSE", "CHICKEN STOCK LIQUID 1L", .2, [1]),
    ("chickpea", "Chickpeas 400g", "Pantry", F, "400g", "each", 100, "HOUSE", "CHICKPEAS 400G", .15, [1, 2]),
    ("almonds", "Raw almonds 400g", "Pantry", F, "400g", "each", 850, "HOUSE", "ALMONDS RAW 400G", .1, [1]),
    # Snacks & sweets (taxable)
    ("chips", "Potato chips 175g", "Snacks & sweets", T, "175g", "each", 500, "Crunchley", "CHIPS SEA SALT 175G", .45, [1, 2]),
    ("choc", "Milk chocolate block 180g", "Snacks & sweets", T, "180g", "each", 600, "Velmora", "MILK CHOCOLATE BLOCK 180G", .35, [1, 2]),
    ("biscuits", "Chocolate biscuits 200g", "Snacks & sweets", T, "200g", "each", 500, "Choctop", "CHOC COATED BISCUITS 200G", .3, [1, 2]),
    ("mbars", "Muesli bars 6 pack", "Snacks & sweets", T, "6pk", "each", 450, "Ridgeback", "MUESLI BARS 6PK", .3, [1, 2]),
    ("cashews", "Salted cashews 500g", "Snacks & sweets", T, "500g", "each", 1100, "HOUSE", "CASHEWS ROASTED SALTED 500G", .1, [1]),
    ("cornchips", "Corn chips 200g", "Snacks & sweets", T, "200g", "each", 400, "Crunchley", "CORN CHIPS 200G", .2, [1]),
    # Drinks
    ("ojuice", "Orange juice 2L", "Drinks", F, "2L", "each", 600, "Orchard Gate", "100% ORANGE JUICE NAS 2L", .35, [1]),
    ("cola", "Cola 1.25L", "Drinks", T, "1.25L", "each", 350, "Fizzco", "COLA 1.25L", .2, [1, 2]),
    ("sparkling", "Sparkling mineral water 1.25L", "Drinks", T, "1.25L", "each", 150, "HOUSE", "SPARKLING MINERAL WATER 1.25L", .25, [2, 3]),
    # Frozen
    ("peas", "Frozen peas 1kg", "Frozen", F, "1kg", "each", 300, "HOUSE", "FROZEN GARDEN PEAS 1KG", .3, [1]),
    ("berries", "Frozen mixed berries 1kg", "Frozen", F, "1kg", "each", 850, "HOUSE", "FROZEN MIXED BERRIES 1KG", .3, [1]),
    ("icecream", "Vanilla ice cream 2L", "Frozen", T, "2L", "each", 800, "Polar Dairy", "ICE CREAM VANILLA 2L", .2, [1]),
    ("pizza", "Frozen margherita pizza", "Frozen", T, "400g", "each", 700, "Forno Rosso", "PIZZA MARGHERITA 400G", .15, [1, 2]),
    # Prepared meals (taxable)
    ("bbqchook", "Hot roast chicken", "Prepared meals", T, "", "each", 1300, "HOUSE", "HOT ROAST CHICKEN", .3, [1]),
    ("lasagne", "Beef lasagne 1kg", "Prepared meals", T, "1kg", "each", 1000, "HOUSE", "BEEF LASAGNE 1KG", .15, [1]),
    # Baby: food is GST-free, nappies and wipes are taxable
    ("nappy4", "Nappies crawler size 4, 54 pack", "Baby", T, "54pk", "each", 2500, "Snugglebum", "NAPPIES CRAWLER SZ4 54PK", .5, [1], (None, "2026-03-01")),
    ("nappy5", "Nappies walker size 5, 50 pack", "Baby", T, "50pk", "each", 2500, "Snugglebum", "NAPPIES WALKER SZ5 50PK", .5, [1], ("2026-03-01", "2026-10-01")),
    ("nappy6", "Nappy pants junior size 6, 40 pack", "Baby", T, "40pk", "each", 2600, "Snugglebum", "NAPPY PANTS JUNIOR SZ6 40PK", .5, [1], ("2026-10-01", None)),
    ("wipes", "Baby wipes 80 pack", "Baby", T, "80pk", "each", 350, "Snugglebum", "BABY WIPES FRAGRANCE FREE 80PK", .55, [1, 2]),
    ("pouch", "Toddler fruit pouch 120g", "Baby", F, "120g", "each", 200, "Tiny Fork", "FRUIT POUCH APPLE MANGO 120G", .8, [3, 4, 5]),
    ("ypouch", "Toddler yoghurt pouches 4 x 70g", "Baby", F, "280g", "each", 450, "Tiny Fork", "YOGHURT POUCH 4X70G", .55, [1, 2]),
    ("formula", "Follow-on formula 900g", "Baby", F, "900g", "each", 2200, "Tiny Fork", "FOLLOW ON FORMULA STG2 900G", .5, [1], (None, "2025-08-20")),
    ("tmilk", "Toddler milk drink 900g", "Baby", F, "900g", "each", 2200, "Tiny Fork", "TODDLER MILK DRINK STG3 900G", .35, [1], ("2025-08-20", None)),
    # Health & beauty (taxable)
    ("toothpaste", "Toothpaste 110g", "Health & beauty", T, "110g", "each", 400, "Enamelle", "TOOTHPASTE FRESH MINT 110G", .15, [1]),
    ("kidspaste", "Kids toothpaste 60g", "Health & beauty", T, "60g", "each", 350, "Enamelle", "KIDS TOOTHPASTE BERRY 60G", .08, [1]),
    ("shampoo", "Shampoo 400ml", "Health & beauty", T, "400ml", "each", 600, "Silkwood", "SHAMPOO EVERYDAY 400ML", .1, [1]),
    ("sunscreen", "Sunscreen SPF50 200ml", "Health & beauty", T, "200ml", "each", 1200, "Solace", "SUNSCREEN SPF50 200ML", .08, [1]),
    ("paracetamol", "Paracetamol 20 pack", "Health & beauty", T, "20pk", "each", 350, "HOUSE", "PARACETAMOL 500MG 20PK", .05, [1]),
    # Household (taxable)
    ("tp", "Toilet paper 24 pack", "Household", T, "24pk", "each", 1300, "HOUSE", "TOILET TISSUE 3PLY 24PK", .25, [1]),
    ("ptowel", "Paper towel 4 pack", "Household", T, "4pk", "each", 600, "HOUSE", "PAPER TOWEL 4PK", .2, [1]),
    ("dishliq", "Dishwashing liquid 500ml", "Household", T, "500ml", "each", 300, "HOUSE", "DISHWASHING LIQUID 500ML", .12, [1]),
    ("laundry", "Laundry liquid 2L", "Household", T, "2L", "each", 1400, "Freshline", "LAUNDRY LIQUID 2L", .2, [1]),
    ("dishtabs", "Dishwasher tablets 40 pack", "Household", T, "40pk", "each", 1500, "Sparkwash", "DISHWASHER TABS 40PK", .2, [1]),
    ("binliner", "Bin liners 50 pack", "Household", T, "50pk", "each", 400, "HOUSE", "KITCHEN TIDY BAGS 50PK", .1, [1]),
    ("cling", "Cling wrap 60m", "Household", T, "60m", "each", 350, "HOUSE", "CLING WRAP 60M", .05, [1]),
    # Alcohol, ALDI Coburg only
    ("shiraz", "Shiraz 750ml", "Alcohol", T, "750ml", "each", 1050, "", "SHIRAZ 750ML", .25, [1, 2]),
]
FIELDS = ["key", "product", "group", "taxable", "pack", "sold", "base", "brand", "short", "freq", "qty", "window"]
PROD = {}
for row in PRODUCTS:
    p = dict(zip(FIELDS, list(row) + [None] * (len(FIELDS) - len(row))))
    PROD[p["key"]] = p

# Market-only products (Merri Growers Market, a fictional farmers' market)
MARKET = {
    "m_apple": ("Apples, mixed", "Fruit & veg", F, "kg", 480, "Apples mixed"),
    "m_banana": ("Bananas", "Fruit & veg", F, "kg", 350, "Bananas"),
    "m_tomato": ("Heirloom tomatoes", "Fruit & veg", F, "kg", 890, "Tomatoes heirloom"),
    "m_kale": ("Kale bunch", "Fruit & veg", F, "each", 400, "Kale bunch"),
    "m_carrot": ("Dutch carrots bunch", "Fruit & veg", F, "each", 350, "Dutch carrots bunch"),
    "m_mandarin": ("Mandarins", "Fruit & veg", F, "kg", 450, "Mandarins"),
    "m_potato": ("Kipfler potatoes", "Fruit & veg", F, "kg", 690, "Kipfler potatoes"),
    "m_eggs": ("Pasture eggs 12 pack", "Dairy & eggs", F, "each", 900, "Pasture eggs dozen"),
    "m_honey": ("Raw honey 500g", "Pantry", F, "each", 1200, "Raw honey 500g"),
    "m_sourdough": ("Sourdough loaf", "Bakery", F, "each", 850, "Sourdough loaf"),
    "m_croissant": ("Croissant", "Bakery", T, "each", 450, "Croissant"),
    "m_bbread": ("Banana bread slice", "Bakery", T, "each", 400, "Banana bread slice"),
}

# Price watch: sharp jumps on named items, on top of a 2-4% a year drift.
JUMPS = {"eggs": ("2026-02-01", 1.22), "coffee": ("2026-05-15", 1.18), "choc": ("2025-10-01", 1.25),
         "mince": ("2026-08-01", 1.14), "butter": ("2026-01-15", 1.15)}
PROMOS = {"chips": (2, 700), "choc": (2, 900), "pouch": (5, 800), "biscuits": (2, 700), "mbars": (2, 700),
          "cola": (2, 500), "yoghurt": (2, 1100)}  # n for $X (deal price set at Jul 2025 prices, moves with drift)
FILLERS = ["banana", "apple", "carrot", "onion", "broccoli", "tomato", "zucchini", "sweetpot", "pear", "mandarin", "nectarine"]

STORES = {
    "W": {"merchant": "Woolworths", "mer": "MER-WOOLWORTHS", "store": "Brunswick", "no": "3021", "bank": "WOOLWORTHS 3021 BRUNSWICK"},
    "C": {"merchant": "Coles Supermarkets", "mer": "MER-COLES", "store": "Coburg", "no": "0457", "bank": "COLES 0457 COBURG"},
    "A": {"merchant": "ALDI Stores", "mer": "MER-ALDI", "store": "Coburg", "no": "", "bank": "ALDI STORES COBURG"},
    "M": {"merchant": "Merri Growers Market", "mer": "", "store": "", "no": "", "bank": ""},
}
HOUSE_BRAND = {"W": "Woolworths", "C": "Coles", "A": "", "M": ""}
HOUSE_PREFIX = {"W": "WW ", "C": "COLES ", "A": "", "M": ""}

# Per-product, per-store fixed traits from the seed
TRAIT = {}
for k in PROD:
    TRAIT[k] = {
        "C": 1 + rng.uniform(-0.03, 0.04), "A": 0.86 + rng.uniform(-0.04, 0.04),
        "g": rng.uniform(0.02, 0.04), "every": rng.randint(91, 150), "offset": rng.randint(0, 90),
        "codeW": str(rng.randint(100000, 999999)), "codeC": str(rng.randint(1000000, 9999999)),
        "codeA": str(rng.randint(100000, 999999)),
    }


def in_window(p, d):
    w = p.get("window")
    if not w:
        return True
    a, b = w
    if a and len(a) == 5:  # seasonal MM-DD window, may wrap the year
        md = d.strftime("%m-%d")
        return (a <= md <= b) if a <= b else (md >= a or md <= b)
    return (a is None or d >= D(a)) and (b is None or d < D(b))


def price(key, store, d):
    """Shelf price in cents (per kg for kg items) at a store on a date."""
    p, t = PROD[key], TRAIT[key]
    days = (d - START).days
    review = max(0, (days - t["offset"]) // t["every"] * t["every"] + t["offset"]) if days >= t["offset"] else 0
    f = (1 + t["g"]) ** (review / 365.25)
    if key in JUMPS and d >= D(JUMPS[key][0]):
        f *= JUMPS[key][1]
    f *= {"W": 1.0, "C": t["C"], "A": t["A"]}[store]
    c = p["base"] * f
    if store == "A":
        return max(49, int(round(c / 10.0)) * 10 - 1)
    return max(50, int(round(c / 10.0)) * 10)


def cents(x):
    return f"{x / 100:.2f}"


def half_up_div(n, d):
    """round(n/d) half away from zero, integers."""
    s = -1 if (n < 0) != (d < 0) else 1
    n, d = abs(n), abs(d)
    return s * ((2 * n + d) // (2 * d))


def pack_kg_or_l(pack):
    m = re.fullmatch(r"(\d+(?:\.\d+)?)(kg|g|ml|L)", pack or "")
    if not m:
        return None
    v, u = float(m.group(1)), m.group(2)
    return {"kg": v, "g": v / 1000, "L": v, "ml": v / 1000}[u]


# --------------------------------------------------------------------------------------------------------------
# Lines
def item_line(store, key, d, qty=1, grams=None, note="", special=False, sub_for=None, oos=False, tare=None):
    p = PROD[key]
    up = price(key, store, d)
    if special:
        up = int(round(up / 2 / 10.0)) * 10 if store != "A" else up
    brand = HOUSE_BRAND[store] if p["brand"] == "HOUSE" else p["brand"]
    if store == "A":
        brand = ""
        printed = p["short"]
    elif p["brand"] == "HOUSE":
        printed = HOUSE_PREFIX[store] + p["short"]
    elif p["brand"]:
        printed = p["brand"].upper() + " " + p["short"]
    else:
        printed = p["short"]
    if p["sold"] == "kg":
        q = grams / 1000.0
        amt = half_up_div(grams * up, 1000)
        unit = "kg"
    else:
        q = qty
        amt = up * qty
        unit = "each"
    if oos:
        q, amt = 0, 0
    code = {"W": TRAIT[key]["codeW"], "C": TRAIT[key]["codeC"], "A": TRAIT[key]["codeA"]}[store]
    return {"key": key, "printed": printed[:34], "product": p["product"], "brand": brand, "group": p["group"],
            "kind": "Item", "qty": q, "unit": unit, "unit_price": up, "amount": amt,
            "gst": "Taxable" if p["taxable"] else "GST-free", "pack": p["pack"], "code": code, "note": note,
            "special_saving": (price(key, store, d) - up) * qty if special else 0, "full_price": price(key, store, d), "sub_for": sub_for,
            "grams": grams, "tare": tare}


def market_line(key, grams=None, qty=1):
    name, group, tax, sold, base, printed = MARKET[key]
    if sold == "kg":
        amt, q, unit = half_up_div(grams * base, 1000), grams / 1000.0, "kg"
    else:
        amt, q, unit = base * qty, qty, "each"
    pack = "500g" if "500g" in name else ""
    return {"key": key, "printed": printed, "product": name, "brand": "", "group": group, "kind": "Item", "qty": q,
            "unit": unit, "unit_price": base, "amount": amt, "gst": "Taxable" if tax else "GST-free", "pack": pack,
            "code": "", "note": "", "special_saving": 0, "sub_for": None, "grams": grams, "tare": None}


def discount_line(store, item, n, deal, count):
    amt = -(n * item["unit_price"] - deal) * count
    text = {"W": f"PROMO {n} FOR ${deal / 100:.2f}", "C": f"MULTI-SAVE {n} FOR ${deal / 100:.2f}"}[store]
    return {"key": "disc:" + item["key"], "printed": text, "product": f"Multi-buy discount, {item['product'].lower()}",
            "brand": "", "group": item["group"], "kind": "Discount", "qty": count, "unit": "each",
            "unit_price": -(n * item["unit_price"] - deal), "amount": amt, "gst": item["gst"], "pack": "", "code": "",
            "note": f"{n} for ${deal / 100:.2f}", "special_saving": 0}


def fee_line(printed, product, amount, group="Other", note=""):
    return {"key": "fee", "printed": printed, "product": product, "brand": "", "group": group, "kind": "Fee", "qty": 1,
            "unit": "each", "unit_price": amount, "amount": amount, "gst": "Taxable", "pack": "", "code": "",
            "note": note, "special_saving": 0}


def promo_deal(key, store, d):
    n, deal0 = PROMOS[key]
    f = price(key, store, d) / max(1, price(key, store, START))
    return n, int(round(deal0 * f / 50.0)) * 50


def safe_insert(lines, i, ln):
    """Insert without splitting an item from the discount line printed under it."""
    while i < len(lines) and lines[i]["kind"] == "Discount":
        i += 1
    lines.insert(i, ln)


def find_grams(target, up, lo=150, hi=1800):
    for g in range(lo, hi + 1):
        if half_up_div(g * up, 1000) == target:
            return g
    return None


def basket(store, d, target, r, channel="In-store", small=False, force=(), avoid=()):
    """Build lines whose amounts sum exactly to target cents."""
    lines, used = [], set()

    def add(key, qty=None, **kw):
        p = PROD[key]
        if not in_window(p, d) or key in used:
            return None
        if store == "A" and key in ("bbqchook", "ham"):
            return None
        if store != "A" and key == "shiraz":
            return None
        if p["sold"] == "kg":
            ln = item_line(store, key, d, grams=r.randint(350, 1600), **kw)
        else:
            ln = item_line(store, key, d, qty=qty or r.choice(p["qty"]), **kw)
        lines.append(ln)
        used.add(key)
        return ln

    for k in force:
        add(k)
    order = list(PROD)
    r.shuffle(order)
    scale = 0.55 if small else 1.0
    for k in order:
        if k in avoid or k in used:
            continue
        p = PROD[k]
        if r.random() < p["freq"] * scale:
            special = store in "WC" and p["brand"] not in ("", "HOUSE") and r.random() < 0.12
            add(k, special=special, note="Half price special" if special else "")
        if sum(l["amount"] for l in lines) > target - 1200:
            break
    # multi-buy promotions
    out = []
    for ln in lines:
        out.append(ln)
        if store in "WC" and ln["key"] in PROMOS and ln["kind"] == "Item" and not ln.get("special_saving") and r.random() < 0.45:
            n, deal = promo_deal(ln["key"], store, d)
            if n * ln["unit_price"] > deal:
                if ln["qty"] < n:
                    ln["qty"] = n
                    ln["amount"] = ln["unit_price"] * n
                cnt = int(ln["qty"]) // n
                out.append(discount_line(store, ln, n, deal, cnt))
    lines = out
    return lines


def settle(lines, store, d, target, r, avoid=()):
    """Add or drop items, then one weighed line, so the lines sum exactly to target."""
    for _ in range(400):
        sub = sum(l["amount"] for l in lines)
        R = target - sub
        if R < 120:
            # drop the cheapest removable item that clears the gap, never a forced or discounted one
            removable = [l for l in lines if l["kind"] == "Item" and not l.get("forced") and l["unit"] == "each"
                         and not any(x["key"] == "disc:" + l["key"] for x in lines)]
            if not removable:
                raise RuntimeError("cannot settle")
            removable.sort(key=lambda l: l["amount"])
            pick = next((l for l in removable if l["amount"] >= 120 - R), removable[-1])
            lines.remove(pick)
            continue
        cands = [k for k in FILLERS if k not in {l["key"] for l in lines} and in_window(PROD[k], d)
                 and price(k, store, d) < 1000 and k not in avoid]
        r.shuffle(cands)
        for k in cands:
            up = price(k, store, d)
            g = find_grams(R, up)
            if g:
                ln = item_line(store, k, d, grams=g)
                safe_insert(lines, r.randint(0, len(lines)), ln)
                return lines
        # too much left over: add a fixed-price item that fits
        fits = [k for k in PROD if PROD[k]["sold"] == "each" and in_window(PROD[k], d) and k not in {l["key"] for l in lines}
                and price(k, store, d) <= R - 150 and not (store == "A" and k in ("bbqchook",))
                and not (store != "A" and k == "shiraz")]
        if not fits:
            # bump the quantity of a cheap each-line
            each = [l for l in lines if l["kind"] == "Item" and l["unit"] == "each" and l["unit_price"] <= R - 150
                    and not any(x["key"] == "disc:" + l["key"] for x in lines)]
            if not each:
                raise RuntimeError("cannot settle: nothing fits")
            l = r.choice(each)
            l["qty"] += 1
            l["amount"] = l["unit_price"] * l["qty"]
            continue
        fits.sort(key=lambda k: -PROD[k]["freq"])
        k = r.choice(fits[:12])
        safe_insert(lines, r.randint(0, len(lines)), item_line(store, k, d, qty=1))
    raise RuntimeError("settle did not converge")


# --------------------------------------------------------------------------------------------------------------
snap = json.loads((REPO / "data/snapshot-v2.json").read_text())
G = sorted([e for e in snap["entries"] if e["category_id"] == "GROCERIES"], key=lambda e: e["settled_at"])
assert len(G) == 76, len(G)
SKEY = {"WOOLWORTHS 3021 BRUNSWICK": "W", "COLES 0457 COBURG": "C", "ALDI STORES COBURG": "A"}

# Formats for the bank receipts. Woolworths 38: 14 delivery invoices, 2 pick-up invoices, 6 e-receipts, 16 dockets.
# Coles 19: 5 delivery invoices, 3 e-receipts, 11 dockets. ALDI 19: dockets.
TRAP_EARLY = "T0866"          # receipt printed two days before its bank row, same day as a gift-card shop
TRAP_POINTS = "T0688"         # rewards points redemption on an e-receipt
TRAP_BAG = "T0490"            # in-store docket whose total includes a bag fee
TRAP_TARE = "T0696"           # Coles docket with a deli line weighed with a tare
TRAP_SMUDGE = "T0705"         # ALDI docket, smudged and photographed sideways
TRAP_DUP = "T0767"            # Woolworths docket photographed twice
REFUND_SOURCE = "T0257"       # Coles shop whose nappies come back three days later

w_entries = [e for e in G if SKEY[e["raw_text"]] == "W"]
c_entries = [e for e in G if SKEY[e["raw_text"]] == "C"]
fixed_w = {TRAP_EARLY: "docket", TRAP_POINTS: "ereceipt", TRAP_BAG: "docket", TRAP_DUP: "docket"}
fixed_c = {TRAP_TARE: "docket", REFUND_SOURCE: "docket"}
free_w = [e["entry_id"] for e in w_entries if e["entry_id"] not in fixed_w]
free_c = [e["entry_id"] for e in c_entries if e["entry_id"] not in fixed_c]
rng.shuffle(free_w)
rng.shuffle(free_c)
FMT = dict(fixed_w)
FMT.update(fixed_c)
for i, eid in enumerate(free_w):
    FMT[eid] = "delivery" if i < 14 else "pickup" if i < 16 else "ereceipt" if i < 21 else "docket"
for i, eid in enumerate(free_c):
    FMT[eid] = "delivery" if i < 5 else "ereceipt" if i < 8 else "docket"
for e in G:
    FMT.setdefault(e["entry_id"], "docket")

receipts = []  # dicts with all fields plus lines and render hints


def mk_time(r, channel):
    if channel.startswith("Online"):
        return f"{r.randint(9, 19):02d}:{r.randint(0, 59):02d}"
    return f"{r.choice([8, 9, 10, 10, 11, 11, 12, 13, 14, 15, 16, 17, 17, 18, 19]):02d}:{r.randint(0, 59):02d}"


def new_receipt(store, d, channel, fmt, target, r, entry=None, paid="Card", account="ACC-CC", note="", person="Joint",
                force=(), small=False, extra=None, pre=()):
    lines = basket(store, d, target, r, channel, small=small, force=force, avoid=[p["key"] for p in pre])
    for l in lines:
        if l["key"] in force:
            l["forced"] = True
    for p in pre:
        p["forced"] = True
        safe_insert(lines, min(3, len(lines)), p)
    fees = []
    if channel == "Online delivery":
        fees.append(fee_line("DELIVERY FEE", "Delivery fee", r.choice([500, 900, 1100, 1500]), note="Delivery window fee"))
    if extra:
        fees.extend(extra(lines))
    target_items = target - sum(f["amount"] for f in fees)
    lines = settle(lines, store, d, target_items, r)
    return {"store": store, "date": d, "channel": channel, "fmt": fmt, "lines": lines, "fees": fees, "target": target,
            "entry": entry, "paid": paid, "account": account, "note": note, "person": person, "time": mk_time(r, channel)}


# 1. one receipt for every bank grocery row
for e in G:
    s = SKEY[e["raw_text"]]
    settled = D(e["settled_at"])
    fmt = FMT[e["entry_id"]]
    channel = {"delivery": "Online delivery", "pickup": "Online pickup"}.get(fmt, "In-store")
    r = random.Random(f"{SEED}-{e['entry_id']}")
    lag = 2 if e["entry_id"] == TRAP_EARLY else r.choice([0, 1, 1])
    d = settled - dt.timedelta(days=lag)
    target = int(round(-e["amount"] * 100))
    force = ()
    extra = None
    note = ""
    pre = []
    if e["entry_id"] == REFUND_SOURCE:
        force = ("nappy4",)
    if e["entry_id"] == TRAP_TARE:
        pre = [item_line("C", "ham", d, grams=256, tare=12, note="Gross 0.268 kg less 0.012 kg tare; net 0.256 kg charged")]
        note = "Deli ham weighed in a container; the scale took off the tare."
    if e["entry_id"] == TRAP_POINTS:
        extra = lambda ls: [{"key": "points", "printed": "REWARDS REDEMPTION $10 OFF", "product": "Rewards points redemption",
                             "brand": "", "group": "Other", "kind": "Discount", "qty": 1, "unit": "each", "unit_price": -1000,
                             "amount": -1000, "gst": "GST-free", "pack": "", "code": "",
                             "note": "Loyalty points redeemed (2,000 points); not a payment, the card paid the rest",
                             "special_saving": 0}]
        note = "Rewards points redeemed for $10 off; the card paid the printed total."
    if e["entry_id"] == TRAP_BAG:
        extra = lambda ls: [fee_line("REUSABLE BAG", "Reusable shopping bag", 75, group="Household",
                                     note="3 bags @ $0.25; part of the printed total")]
        note = "The printed total includes three reusable bags."
    rc = new_receipt(s, d, channel, fmt, target, r, entry=e["entry_id"], note=note, force=force, extra=extra, pre=pre)
    if e["entry_id"] == TRAP_BAG:
        rc["fees"][0]["qty"], rc["fees"][0]["unit_price"] = 3, 25
    if lag == 2:
        rc["note"] = (rc["note"] + " " if rc["note"] else "") + "Printed two days before the card settled."
    receipts.append(rc)

# Online orders: one substitution and one out-of-stock line on some, deterministic
for rc in receipts:
    if not rc["channel"].startswith("Online"):
        continue
    r = random.Random(f"{SEED}-online-{rc['entry']}")
    items = [l for l in rc["lines"] if l["kind"] == "Item" and l["unit"] == "each" and PROD[l["key"]]["brand"] not in ("",)]
    if items and r.random() < 0.5:
        l = r.choice(items)
        orig = PROD[l["key"]]
        l["sub_for"] = orig["product"]
        l["note"] = f"Substituted: ordered {orig['product']}"
        alt = {"Hillmoor": "Dairyvale", "Highfield": "Glenbrook", "Casa Ferro": "Bella Cucina", "Sunvale": "Morning Mill",
               "Crunchley": "Kettle Lane", "Velmora": "Cocoa Bay", "Tiny Fork": "Little Spoon", "Snugglebum": "Cosy Bub",
               "Enamelle": "Pearlbright", "Freshline": "Cleanbay", "Sparkwash": "Gleamo", "Old Mill": "Stone Oven",
               "Orchard Gate": "Sunpress", "Polar Dairy": "Frostline", "Forno Rosso": "Napoli Oven", "Darkbird": "Roastery Lane",
               "Nutkin": "Kernel Co", "Choctop": "Biscuit Barn", "Ridgeback": "Trailhead", "Fizzco": "Bubbleup",
               "Bluegum": "Ironbark", "Silkwood": "Rainleaf", "Solace": "Shorebreak"}
        if orig["brand"] == "HOUSE":
            l["brand"] = "Kitchen Table"
            l["printed"] = ("KITCHEN TABLE " + orig["short"])[:34]
        else:
            nb = alt.get(orig["brand"], "Other Brand")
            l["brand"] = nb
            l["printed"] = (nb.upper() + " " + orig["short"])[:34]
        l["note"] = f"Substituted for {l['sub_for']} ({HOUSE_BRAND[rc['store']] if orig['brand'] == 'HOUSE' else orig['brand']}); same price charged"
    if r.random() < 0.55:
        cands = [k for k in PROD if PROD[k]["sold"] == "each" and in_window(PROD[k], rc["date"])
                 and k not in {l["key"] for l in rc["lines"]} and PROD[k]["group"] in ("Pantry", "Dairy & eggs", "Snacks & sweets", "Frozen")]
        k = r.choice(cands)
        oos = item_line(rc["store"], k, rc["date"], qty=1, oos=True, note="Out of stock, not supplied, not charged")
        rc["oos"] = oos

# 2. gift cards, splits, cash markets, the refund
GIFT = [
    {"id": "ACC-GC-1", "store": "W", "value": 20000, "load": "2025-12-20", "from": "Mia's parents, Christmas", "owner": "Joint", "last4": "8812",
     "uses": [("2026-01-07", 6485), ("2026-01-29", 9240), ("2026-02-14", ("split", 13460))]},
    {"id": "ACC-GC-2", "store": "C", "value": 10000, "load": "2025-12-23", "from": "Jordan's work, Christmas", "owner": "Jordan", "last4": "3307",
     "uses": [("2026-01-20", 5830), ("2026-03-05", 3610)]},
    {"id": "ACC-GC-3", "store": "W", "value": 15000, "load": "2026-04-12", "from": "Mia's sister, Mia's birthday", "owner": "Mia", "last4": "5129",
     "uses": [("2026-04-19", 8765), ("2026-05-15", ("split", 17120))]},
    {"id": "ACC-GC-4", "store": "C", "value": 25000, "load": "2026-08-02", "from": "Jordan's parents, for Ava's second birthday", "owner": "Joint", "last4": "7741",
     "uses": [("2026-08-08", 9620), ("2026-09-01", 7115), ("2026-10-05", 4990), ("2026-11-15", ("split", 11845))]},
    {"id": "ACC-GC-5", "store": "W", "value": 10000, "load": "2026-12-20", "from": "Neighbours, Christmas", "owner": "Joint", "last4": "2290",
     "uses": [("2026-12-22", 4430), ("2027-01-12", 3895)]},
]
EGIFT = {("ACC-GC-2", "2026-03-05"), ("ACC-GC-4", "2026-09-01")}
additions = []
for gc in GIFT:
    bal = gc["value"]
    for ds, amt in gc["uses"]:
        d = D(ds)
        r = random.Random(f"{SEED}-{gc['id']}-{ds}")
        if isinstance(amt, tuple):
            total = amt[1]
            gift_part, card_part = bal, total - bal
            tg = f"TG{len(additions) + 1:03d}"
            st = STORES[gc["store"]]
            additions.append({"entry_id": tg, "kind": "transaction", "settled_at": (d + dt.timedelta(days=1)).isoformat(),
                              "account_id": "ACC-CC", "raw_text": st["bank"], "description": st["merchant"].split()[0].title()
                              if gc["store"] == "W" else "Coles", "amount": -card_part / 100, "category_id": "GROCERIES",
                              "person": "Joint", "receipt_held": None,
                              "note": f"Card part of a split payment; {gc['id']} gift card paid {cents(gift_part)}",
                              "status": "settled", "created_at": (d + dt.timedelta(days=1)).isoformat(), "transfer_id": None,
                              "transfer_account": None, "foreign_amount": None, "foreign_currency": None, "units": None,
                              "unit_price": None, "source": "bank export", "flow": "Expense"})
            rc = new_receipt(gc["store"], d, "In-store", "docket", total, r, entry=tg, paid="Mixed", account="ACC-CC",
                             note=f"Split: gift card {gc['id']} paid {cents(gift_part)} (emptied it), the card paid {cents(card_part)}. "
                                  f"The bank shows only the card part.", small=True)
            rc["tender"] = [("GIFT CARD", gc["last4"], gift_part, 0), ("MASTERCARD", "4417", card_part, None)]
            rc["gift_uses"] = [(gc["id"], gift_part)]
            bal = 0
        else:
            rc = new_receipt(gc["store"], d, "In-store", "ereceipt" if (gc["id"], ds) in EGIFT else "docket", amt, r,
                             paid="Gift card", account=gc["id"], person=gc["owner"], small=True,
                             note=f"Paid wholly by gift card {gc['id']}. Real spending the bank never shows.")
            bal -= amt
            rc["tender"] = [("GIFT CARD", gc["last4"], amt, bal)]
            rc["gift_uses"] = [(gc["id"], amt)]
        receipts.append(rc)
    gc["balance"] = bal

# cash at the market (no bank row): four shops
MARKETS = [
    ("2025-09-13", "Stall 14 Fruit & Veg", 4265, ["m_apple", "m_banana", "m_kale", "m_mandarin", "m_eggs"], 5000),
    ("2026-02-21", "Stall 3 Bakery", 2150, None, 2150),
    ("2026-06-06", "Stall 14 Fruit & Veg", 3685, ["m_banana", "m_carrot", "m_potato", "m_eggs", "m_honey"], 5000),
    ("2026-10-24", "Stall 14 Fruit & Veg", 4730, ["m_apple", "m_tomato", "m_kale", "m_eggs", "m_mandarin"], 5000),
]
for ds, stall, total, keys, tendered in MARKETS:
    r = random.Random(f"{SEED}-market-{ds}")
    d = D(ds)
    if keys is None:
        lines = [market_line("m_sourdough"), market_line("m_croissant", qty=2), market_line("m_bbread")]
    else:
        fixed = [k for k in keys if MARKET[k][3] == "each"]
        weighed = [k for k in keys if MARKET[k][3] == "kg"]
        for _ in range(500):
            lines = [market_line(k) for k in fixed]
            for k in weighed[:-1]:
                lines.append(market_line(k, grams=r.randint(800, 2600)))
            R = total - sum(l["amount"] for l in lines)
            g = find_grams(R, MARKET[weighed[-1]][4], 400, 3000) if R > 0 else None
            if g:
                break
        assert g, (ds, R)
        lines.append(market_line(weighed[-1], grams=g))
    assert sum(l["amount"] for l in lines) == total, (ds, total)
    rc = {"store": "M", "date": d, "channel": "In-store", "fmt": "docket", "lines": lines, "fees": [], "target": total,
          "entry": None, "paid": "Cash", "account": "ACC-CASH", "person": "Joint", "time": f"{r.randint(8, 11):02d}:{r.randint(0, 59):02d}",
          "note": "Paid in cash at the market. Real spending the bank never shows.", "stall": stall,
          "tender": [("CASH", "", tendered, tendered - total)]}
    receipts.append(rc)

# the refund: Coles nappies bought 8 Dec 2025 (T0257), returned unopened on 13 Dec 2025
src = next(rc for rc in receipts if rc["entry"] == REFUND_SOURCE)
nap = next(l for l in src["lines"] if l["key"] == "nappy4")
refund_amt = nap["unit_price"]
ref_line = dict(nap)
ref_line.update({"qty": -1, "amount": -refund_amt, "note": "Returned unopened; refunded to the card", "forced": True})
rd = D("2025-12-13")
additions.append({"entry_id": f"TG{len(additions) + 1:03d}", "kind": "transaction", "settled_at": "2025-12-15", "account_id": "ACC-CC",
                  "raw_text": "COLES 0457 COBURG", "description": "Coles", "amount": refund_amt / 100, "category_id": "GROCERIES",
                  "person": "Joint", "receipt_held": None, "note": "Refund of returned nappies", "status": "settled",
                  "created_at": "2025-12-15", "transfer_id": None, "transfer_account": None, "foreign_amount": None,
                  "foreign_currency": None, "units": None, "unit_price": None, "source": "bank export", "flow": "Expense"})
receipts.append({"store": "C", "date": rd, "channel": "In-store", "fmt": "docket", "lines": [ref_line], "fees": [],
                 "target": -refund_amt, "entry": additions[-1]["entry_id"], "paid": "Card", "account": "ACC-CC", "person": "Joint",
                 "time": "10:41", "refund": True, "refund_of_date": src["date"].isoformat(),
                 "note": "Refund: money back to the card, so negative spending. Total and line are negative.",
                 "tender": [("MASTERCARD REFUND", "4417", refund_amt, None)]})

# --------------------------------------------------------------------------------------------------------------
# Number, file names, totals
receipts.sort(key=lambda rc: (rc["date"], rc["time"]))
fr = random.Random(f"{SEED}-files")
img_nos = fr.sample(range(1000, 9900), len(receipts) + 2)
for i, rc in enumerate(receipts, 1):
    rc["id"] = f"R{i:04d}"
    # printed order: items, then fees; online invoices list unavailable items after the supplied ones
    for l in rc["lines"]:
        if l.get("special_saving"):
            l["special_saving"] = (l["full_price"] - l["unit_price"]) * l["qty"]
    if rc["channel"].startswith("Online"):
        items = [l for l in rc["lines"] if l["kind"] == "Item"]
        items.sort(key=lambda l: GROUPS.index(l["group"]))
        ordered = []
        for l in items:
            ordered.append(l)
            ordered += [x for x in rc["lines"] if x["key"] == "disc:" + l["key"]]
        assert len(ordered) == len(rc["lines"])
        rc["lines"] = ordered
    for j, l in enumerate(rc["lines"]):
        if l["kind"] == "Discount":
            assert j > 0 and rc["lines"][j - 1]["key"] == l["key"][5:], (rc.get("entry"), l["key"])
    allines = rc["lines"] + rc["fees"]
    if rc.get("oos"):
        allines = rc["lines"] + [rc["oos"]] + rc["fees"]
    rc["all"] = allines
    total = sum(l["amount"] for l in allines)
    assert total == rc["target"], (rc["id"], total, rc["target"])
    taxable = sum(l["amount"] for l in allines if l["gst"] == "Taxable")
    rc["total"] = total
    rc["gst_cents"] = half_up_div(taxable, 11)
    rc["savings"] = sum(-l["amount"] for l in allines if l["kind"] == "Discount" and l["key"] != "points") + \
        sum(l.get("special_saving", 0) for l in allines)
    rc["items"] = int(sum((l["qty"] if l["unit"] == "each" else 1) for l in allines if l["kind"] == "Item" and l["qty"] != 0))
    if rc.get("refund"):
        rc["items"] = 1
    fmt = rc["fmt"]
    if fmt == "docket":
        rc["files"] = [f"IMG_{img_nos[i]}.jpg"]
        rc["source_kind"] = "Photo"
    elif fmt == "ereceipt":
        rc["files"] = [f"eReceipt {rc['date'].strftime('%d%m%y')}-{img_nos[i] % 1000:03d}.pdf"]
        rc["source_kind"] = "Email"
    else:
        rc["order_no"] = str(fr.randint(140000000, 199999999))
        rc["files"] = [f"Tax invoice {rc['order_no']}.pdf"]
        rc["source_kind"] = "PDF"
    if rc["entry"] == TRAP_DUP:
        rc["files"].append(f"IMG_{img_nos[i] + 1}.jpg")
    if rc["paid"] == "Card" and "tender" not in rc:
        rc["tender"] = [("MASTERCARD", "4417", rc["total"], None)]

for gc in GIFT:
    gc["use_rows"] = [{"receipt_id": rc["id"], "date": rc["date"].isoformat(), "amount": a / 100}
                      for rc in receipts for gid, a in rc.get("gift_uses", []) if gid == gc["id"]]


def store_label(rc):
    if rc["store"] == "M":
        return rc["stall"]
    return "online" if rc["channel"].startswith("Online") else STORES[rc["store"]]["store"]


def ppkl(l):
    if l["kind"] != "Item" or not l["amount"] or l["qty"] == 0:
        return ""
    if l["unit"] == "kg":
        return f"{l['amount'] / 100 / l['qty']:.2f}"
    v = pack_kg_or_l(l["pack"])
    if v is None:
        return ""
    return f"{l['amount'] / 100 / (abs(l['qty']) * v):.2f}"


def fmt_qty(q):
    if isinstance(q, float):
        return f"{q:.3f}"
    return str(q)


R_ROWS, L_ROWS = [], []
for rc in receipts:
    st = STORES[rc["store"]]
    R_ROWS.append({
        "Receipt ID": rc["id"], "Date": rc["date"].isoformat(), "Time": rc["time"], "Merchant": st["merchant"],
        "Merchant ID": st["mer"], "Store": store_label(rc), "Channel": rc["channel"], "Person": rc["person"],
        "Items": rc["items"], "Total": cents(rc["total"]), "GST": cents(rc["gst_cents"]), "Savings": cents(rc["savings"]),
        "Paid with": rc["paid"], "Entry ID": rc["entry"] or "", "Account ID": rc["account"],
        "Source": rc["files"][0], "Source kind": rc["source_kind"], "Read by": "Fixture (generated, the truth)",
        "Check": "OK", "Note": rc["note"] + (f" Second photo of the same receipt: {rc['files'][1]}." if len(rc["files"]) > 1 else "")})
    for n, l in enumerate(rc["all"], 1):
        L_ROWS.append({
            "Receipt ID": rc["id"], "Line": n, "Printed text": l["printed"], "Product": l["product"], "Brand": l["brand"],
            "Group": l["group"], "Kind": l["kind"], "Qty": fmt_qty(l["qty"]), "Unit": l["unit"],
            "Unit price": cents(l["unit_price"]), "Amount": cents(l["amount"]), "GST": l["gst"], "Pack size": l["pack"],
            "Price per kg or L": ppkl(l), "Retailer code": l["code"] if (rc["store"] == "A" or rc["channel"].startswith("Online")) else "",
            "Note": l["note"]})
        assert l["group"] in GROUPS, l
    s = sum(int(round(float(x["Amount"]) * 100)) for x in L_ROWS if x["Receipt ID"] == rc["id"])
    assert s == rc["total"], rc["id"]


def write_csv(path, headers, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        w.writerows(rows)


write_csv(HERE / "receipts.csv", RECEIPT_HEADERS, R_ROWS)
write_csv(HERE / "receipt-lines.csv", LINE_HEADERS, L_ROWS)

accounts = [
    {"account_id": g["id"], "account": f"{STORES[g['store']]['merchant'].split()[0].title() if g['store'] == 'W' else 'Coles'} gift card {g['last4']}",
     "institution": STORES[g["store"]]["merchant"], "type": "Gift card", "owner": g["owner"], "opening_balance": g["value"] / 100,
     "opening_date": g["load"], "balance_at_as_of_date": g["balance"] / 100, "liquid": "Yes", "class": "Cash",
     "valuation_method": "ledger", "currency": "AUD", "status": "active" if g["balance"] else "closed", "purpose": "Groceries",
     "linked_account": None, "card_last4": g["last4"], "note": f"Source: gift ({g['from']}). Printed on dockets as GIFT CARD ****{g['last4']}."}
    for g in GIFT]
accounts.append({"account_id": "ACC-CASH", "account": "Cash wallet", "institution": None, "type": "Cash", "owner": "Joint",
                 "opening_balance": 300.0, "opening_date": "2025-06-30", "balance_at_as_of_date": round(300 - sum(m[2] for m in MARKETS) / 100, 2),
                 "liquid": "Yes", "class": "Cash", "valuation_method": "ledger", "currency": "AUD", "status": "active",
                 "purpose": "Market shopping", "linked_account": None, "card_last4": None,
                 "note": "Notes and coins on hand; market stalls take cash only."})
(HERE / "accounts.json").write_text(json.dumps({
    "_about": "Accounts the bank never shows, in the Davies Accounts shape plus card_last4. ACC-CC (the joint Rewards credit card) prints as MASTERCARD ****4417 on every docket.",
    "card_last4": {"ACC-CC": "4417"}, "accounts": accounts}, indent=1) + "\n")
(HERE / "gift-cards.json").write_text(json.dumps({
    "_about": "Gift cards the Davies were given. Paying with one is spending (programme decision D3): each use is a Receipts row with Paid with = Gift card (or Mixed) and Account ID = the card.",
    "cards": [{"account_id": g["id"], "merchant": STORES[g["store"]]["merchant"], "card_last4": g["last4"], "load_date": g["load"],
               "value": g["value"] / 100, "source": "gift", "from": g["from"], "owner": g["owner"], "uses": g["use_rows"],
               "balance_at_as_of": g["balance"] / 100} for g in GIFT]}, indent=1) + "\n")
(HERE / "merchants.json").write_text(json.dumps({
    "_about": "MER- keys for the Receipts tab, each tied to an id in merchants/merchants.json. The market is not in the dictionary, so its Merchant ID is blank.",
    "merchants": [{"merchant_id": "MER-WOOLWORTHS", "dictionary_id": "woolworths", "printed": "Woolworths"},
                  {"merchant_id": "MER-COLES", "dictionary_id": "coles", "printed": "Coles Supermarkets"},
                  {"merchant_id": "MER-ALDI", "dictionary_id": "aldi", "printed": "ALDI Stores"}]}, indent=1) + "\n")
(HERE / "bank-additions.json").write_text(json.dumps({
    "_about": "Rows the bank would also show that data/snapshot-v2.json does not have yet: the card part of the three split payments, and the nappies refund. Same shape as snapshot entries. Add them to Entries before matching receipts to the bank.",
    "entries": additions}, indent=1) + "\n")

# --------------------------------------------------------------------------------------------------------------
# Sealed key: truth, render hints, traps, the ladder sample
by_entry = {rc["entry"]: rc for rc in receipts if rc["entry"]}
gc5_first = next(rc for rc in receipts if rc.get("gift_uses") and rc["gift_uses"][0][0] == "ACC-GC-5")
refund = next(rc for rc in receipts if rc.get("refund"))
tare_rc = by_entry[TRAP_TARE]
tare_line = next(n for n, l in enumerate(tare_rc["all"], 1) if l.get("tare"))
points_rc = by_entry[TRAP_POINTS]
points_line = next(n for n, l in enumerate(points_rc["all"], 1) if l["key"] == "points")
bag_rc = by_entry[TRAP_BAG]
bag_line = next(n for n, l in enumerate(bag_rc["all"], 1) if l["printed"] == "REUSABLE BAG")
TRAPS = [
    {"id": "DUPLICATE", "receipt": by_entry[TRAP_DUP]["id"], "files": by_entry[TRAP_DUP]["files"],
     "what": "The same docket photographed twice (two files). One receipt, one row.",
     "caught_when": "exactly one row for the receipt, or a second row whose Note says it is a duplicate"},
    {"id": "REFUND", "receipt": refund["id"], "files": refund["files"],
     "what": "A refund docket: nappies returned unopened, money back to the card (bank row TG004, a credit).",
     "caught_when": "the row is marked as a refund (negative total, or Note says refund) and its total is right"},
    {"id": "TWO-DAYS-EARLY", "receipt": by_entry[TRAP_EARLY]["id"], "files": by_entry[TRAP_EARLY]["files"],
     "also": gc5_first["id"],
     "what": "Printed 22 Dec 2026, settled 24 Dec (T0866). A gift-card Woolworths shop the same morning has no bank row.",
     "caught_when": "Date is the printed date, Entry ID is T0866, and the gift-card shop has no Entry ID"},
    {"id": "TARE", "receipt": tare_rc["id"], "line": tare_line, "files": tare_rc["files"],
     "what": "Deli ham weighed in a container: gross 0.268 kg, tare 0.012 kg, net 0.256 kg charged.",
     "caught_when": "the ham line has Qty 0.256 (net), not 0.268"},
    {"id": "POINTS", "receipt": points_rc["id"], "line": points_line, "files": points_rc["files"],
     "what": "Rewards points redeemed for $10 off, printed as a line before the total; the card paid the rest.",
     "caught_when": "the redemption is a negative line (-10.00) and Paid with is Card"},
    {"id": "BAG-FEE", "receipt": bag_rc["id"], "line": bag_line, "files": bag_rc["files"],
     "what": "The printed total includes 3 reusable bags at $0.25.",
     "caught_when": "a 0.75 bag line is kept, so the lines tie to the total"},
    {"id": "SMUDGED", "receipt": by_entry[TRAP_SMUDGE]["id"], "files": by_entry[TRAP_SMUDGE]["files"],
     "what": "ALDI docket photographed sideways, crumpled, with a smudge across the middle.",
     "caught_when": "date and total exact and Entry ID right"},
]
for t in TRAPS:
    rc = next(x for x in receipts if x["id"] == t["receipt"])
    rc.setdefault("traps", []).append(t["id"])
smudge_rc = by_entry[TRAP_SMUDGE]
smudge_rc["render"] = {"smudge": True, "sideways": True, "crumple": True}
by_entry[TRAP_DUP]["render"] = {"duplicate": True}

# The ladder sample: 24 receipts, 25 files
sr = random.Random(f"{SEED}-sample")
trap_ids = {t["receipt"] for t in TRAPS}
must = set(trap_ids) | {gc5_first["id"]}
gc_e = next(rc for rc in receipts if rc.get("gift_uses") and rc["fmt"] == "ereceipt" and rc["paid"] == "Gift card")
must.add(gc_e["id"])
split = next(rc for rc in receipts if rc["paid"] == "Mixed" and rc["date"] == D("2026-05-15"))
cash = next(rc for rc in receipts if rc["paid"] == "Cash" and rc["date"] == D("2026-06-06"))
must |= {split["id"], cash["id"]}
chosen = [rc for rc in receipts if rc["id"] in must]


def count(pred):
    return sum(1 for rc in chosen if pred(rc))


def is_photo(rc): return rc["fmt"] == "docket" and not rc.get("refund") and rc["entry"] and rc["entry"].startswith("T0") and "DUPLICATE" not in rc.get("traps", [])
def is_pdf(rc): return rc["fmt"] in ("delivery", "pickup", "ereceipt") and rc["entry"] and rc["entry"].startswith("T0")


pool_photo = [rc for rc in receipts if is_photo(rc) and rc["id"] not in must]
pool_pdf_del = [rc for rc in receipts if rc["fmt"] == "delivery" and rc["id"] not in must]
pool_pdf_pick = [rc for rc in receipts if rc["fmt"] == "pickup" and rc["id"] not in must]
pool_pdf_e = [rc for rc in receipts if rc["fmt"] == "ereceipt" and is_pdf(rc) and rc["id"] not in must]
sr.shuffle(pool_photo); sr.shuffle(pool_pdf_del); sr.shuffle(pool_pdf_e)
# 8 bank photos: the four trap photos plus ALDI, ALDI, Coles, Woolworths
need = {"A": 2, "C": 1, "W": 1}
for rc in pool_photo:
    if count(is_photo) >= 8:
        break
    if need.get(rc["store"], 0) > 0:
        chosen.append(rc); need[rc["store"]] -= 1
# 8 bank PDFs: the points e-receipt plus 4 deliveries (one with a substitution and one with an out-of-stock line), 1 pick-up, 2 e-receipts
dl = [x for x in pool_pdf_del if x["store"] == "C"][:1]
rest = [x for x in pool_pdf_del if x not in dl]
dl += [next(x for x in rest if any(l.get("sub_for") for l in x["lines"]))]
dl += [next(x for x in rest if x.get("oos") and x not in dl)]
dl += [next(x for x in rest if x not in dl)]
chosen += dl + pool_pdf_pick[:1] + pool_pdf_e[:2]
# two more to reach 24: another delivery and another ALDI docket
chosen += [next(x for x in rest if x not in dl)]
chosen += [next(x for x in pool_photo if x["store"] == "A" and x not in chosen)]
chosen.sort(key=lambda rc: rc["id"])
assert len(chosen) == 24, len(chosen)
sample_files = [f for rc in chosen for f in rc["files"]]


def line_truth(rc):
    return [{"line": n, "printed": l["printed"], "product": l["product"], "brand": l["brand"], "group": l["group"],
             "kind": l["kind"], "qty": l["qty"], "unit": l["unit"], "unit_price": l["unit_price"] / 100,
             "amount": l["amount"] / 100, "gst": l["gst"], "pack": l["pack"], "code": l["code"], "note": l["note"],
             "sub_for": l.get("sub_for"), "tare_kg": (l["tare"] / 1000) if l.get("tare") else None,
             "gross_kg": ((l["grams"] + l["tare"]) / 1000) if l.get("tare") else None,
             "special": bool(l.get("special_saving"))} for n, l in enumerate(rc["all"], 1)]


key = {
    "_about": "Sealed answer key for the receipts test. Truth for every receipt (all of receipts.csv plus the files, render hints and lines), the planted traps, the price watch and the 24-receipt ladder sample. Do not give this to a reader.",
    "seed": SEED, "as_of": AS_OF.isoformat(),
    "counts": {"receipts": len(receipts), "lines": len(L_ROWS), "files": sum(len(rc["files"]) for rc in receipts),
               "bank_receipts": sum(1 for rc in receipts if rc["entry"] and rc["entry"].startswith("T0")),
               "gift_card_only": sum(1 for rc in receipts if rc["paid"] == "Gift card"),
               "split": sum(1 for rc in receipts if rc["paid"] == "Mixed"),
               "cash": sum(1 for rc in receipts if rc["paid"] == "Cash"), "refund": 1},
    "traps": TRAPS,
    "price_watch": [{"product": PROD[k]["product"], "from": JUMPS[k][0], "jump": f"+{round((JUMPS[k][1] - 1) * 100)}%",
                     "woolworths_before": cents(price(k, "W", D(JUMPS[k][0]) - dt.timedelta(days=1))),
                     "woolworths_after": cents(price(k, "W", D(JUMPS[k][0])))} for k in JUMPS],
    "sample": {"receipts": [rc["id"] for rc in chosen], "files": sample_files,
               "strata": {rc["id"]: ("duplicate pair" if "DUPLICATE" in rc.get("traps", []) else "refund" if rc.get("refund")
                                     else "gift card" if rc["paid"] == "Gift card" else "split" if rc["paid"] == "Mixed"
                                     else "cash" if rc["paid"] == "Cash" else "photo" if rc["fmt"] == "docket" else "pdf")
                          for rc in chosen}},
    "receipts": [{**{k: v for k, v in r_.items()}, "files": rc["files"], "fmt": rc["fmt"], "store_code": rc["store"],
                  "store_no": STORES[rc["store"]]["no"], "order_no": rc.get("order_no"), "tender": rc.get("tender"),
                  "render": rc.get("render", {}), "traps": rc.get("traps", []), "refund_of_date": rc.get("refund_of_date"),
                  "lines": line_truth(rc)} for r_, rc in zip(R_ROWS, receipts)],
}
(HERE / "sealed").mkdir(exist_ok=True)
(HERE / "sealed/key.json").write_text(json.dumps(key, indent=1, default=str) + "\n")
print(json.dumps(key["counts"]), "lines", len(L_ROWS), "sample files", len(sample_files))
