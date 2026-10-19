# Builds app/data/places.tsv, the typeahead index: the weather app's US place
# list (small towns included, with alternate names) plus every GeoNames city
# of 15,000+ people outside the US, sorted by population so a first-match scan
# is already ranked.
#
# Usage: python3 -I tools/places.py <uscities.tsv> <cities15000.txt> <admin1CodesASCII.txt> <countryInfo.txt> > app/data/places.tsv
# Row: name, region, country code, country, lat, lon, population, alternates (";", lowercase)
import sys

us_path, cities_path, admin_path, country_path = sys.argv[1:5]

countries = {}
for line in open(country_path, encoding="utf-8"):
    if line.startswith("#"):
        continue
    f = line.rstrip("\n").split("\t")
    if len(f) > 4:
        countries[f[0]] = f[4]

admin1 = {}
for line in open(admin_path, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if len(f) >= 3:
        admin1[f[0]] = f[2]  # ascii name

rows = []
for line in open(us_path, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if len(f) < 5:
        continue
    alts = f[5] if len(f) > 5 else ""
    rows.append((f[0], f[1], "US", "United States", f[2], f[3], int(f[4] or 0), alts.lower()))

for line in open(cities_path, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    cc = f[8]
    if cc == "US":
        continue
    name, ascii_name = f[1], f[2]
    # Typing "sao paulo" must find São Paulo.
    alts = ascii_name.lower() if ascii_name.lower() != name.lower() else ""
    region = admin1.get(cc + "." + f[10], "")
    rows.append((name, region, cc, countries.get(cc, cc), f"{float(f[4]):.4f}", f"{float(f[5]):.4f}", int(f[14] or 0), alts))

rows.sort(key=lambda r: -r[6])
out = sys.stdout
for r in rows:
    out.write("\t".join(str(x).replace("\t", " ") for x in r) + "\n")
