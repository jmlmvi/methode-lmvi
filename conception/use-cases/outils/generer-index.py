#!/usr/bin/env python3
"""Générer ``INDEX.md`` depuis ``catalogue.json`` — source unique des identifiants et des statuts.

    python3 outils/generer-index.py          # écrit INDEX.md
    python3 outils/generer-index.py --check  # échoue si INDEX.md n'est pas à jour

L'index n'est jamais édité à la main : il porterait alors un identifiant ou un statut que les
fiches contredisent.
"""
import json
import pathlib
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
MARQUE = {"ok": "✅", "P-3": "⏳ P-3", "P-4": "⏳ P-4", "P-5": "⏳ P-5", "hors": "❌", "na": "—"}


def identifiant(theme: str, numero: int) -> str:
    """
    Rendre l'identifiant d'un cas d'usage (``UC-BUS-05``).
    """
    return f"{theme}-{numero:02d}"


def nom_de_fiche(theme: str, cas: dict) -> str:
    """
    Rendre le nom de fichier d'une fiche (``UC-BUS-05-publication-fiable.md``).
    """
    return f"{identifiant(theme, cas['num'])}-{cas['slug']}.md"


def rendre(donnees: dict) -> str:
    moteurs = [m["code"] for m in donnees["moteurs"]]
    total = sum(len(v) for v in donnees["cas"].values())
    lignes = [
        "<!-- Généré par outils/generer-index.py depuis catalogue.json — ne pas éditer à la main. -->",
        "# Catalogue des cas d'usage — Socle V005",
        "",
        f"> **{total} cas d'usage** · {len(donnees['themes'])} thèmes · contrat **{donnees['contrat']}**",
        "> Trois moteurs : **Socle V005 Java** (référence), **socle-py** (FastAPI), "
        "**socle-py-django** (ORM Django + Ninja).",
        "",
        "**Tout développement commence ici.** On cherche son cas d'usage, on lit sa fiche, et c'est "
        "elle qui dit par quel mécanisme du socle passer — pas le code d'un voisin, pas un modèle "
        "recopié sans sa raison.",
        "",
        "Légende : ✅ disponible · ⏳ prévu (phase du chantier) · ❌ hors périmètre déclaré · — sans objet.",
        "",
        "## Thèmes",
        "",
        "| Thème | Intention | Cas |",
        "|---|---|---|",
    ]
    for theme in donnees["themes"]:
        cas = donnees["cas"][theme["code"]]
        lignes.append(f"| [{theme['code']} · {theme['titre']}](#{theme['code'].lower()}) "
                      f"| {theme['intention']} | {len(cas)} |")
    for theme in donnees["themes"]:
        code = theme["code"]
        lignes += ["", f"## {code}", "",
                   f"**{theme['titre']}** — {theme['intention']}.", "",
                   "| Id | Cas d'usage | " + " | ".join(moteurs) + " |",
                   "|---|---|" + "---|" * len(moteurs)]
        for cas in donnees["cas"][code]:
            etats = " | ".join(MARQUE[cas["moteurs"][m]] for m in moteurs)
            lignes.append(f"| [{identifiant(code, cas['num'])}](./{nom_de_fiche(code, cas)}) "
                          f"| {cas['titre']} | {etats} |")
    compte = {code: 0 for code in MARQUE}
    for cas_du_theme in donnees["cas"].values():
        for cas in cas_du_theme:
            for moteur in moteurs:
                compte[cas["moteurs"][moteur]] += 1
    lignes += ["", "## Couverture par moteur", "",
               "| Moteur | ✅ | ⏳ | ❌ | — |", "|---|---|---|---|---|"]
    for moteur in moteurs:
        etats = [cas["moteurs"][moteur] for v in donnees["cas"].values() for cas in v]
        lignes.append(f"| {moteur} | {etats.count('ok')} "
                      f"| {sum(etats.count(p) for p in ('P-3', 'P-4', 'P-5'))} "
                      f"| {etats.count('hors')} | {etats.count('na')} |")
    lignes += ["", "Les ⏳ sont des phases cadrées du chantier (P-3 TechDB d'exploitation, P-4 "
               "supervision et workers intégrés, P-5 frontend et outillage) ; les ❌ sont les "
               "exclusions écrites de la spécification signée. Chaque fiche dit quoi faire en "
               "attendant — et ce qu'il ne faut surtout pas réimplémenter à la main.", ""]
    return "\n".join(lignes)


def main() -> int:
    donnees = json.loads((RACINE / "catalogue.json").read_text(encoding="utf-8"))
    rendu = rendre(donnees)
    index = RACINE / "INDEX.md"
    if "--check" in sys.argv:
        if not index.is_file() or index.read_text(encoding="utf-8") != rendu:
            print("INDEX.md n'est pas à jour : relancez outils/generer-index.py", file=sys.stderr)
            return 1
        print("INDEX.md à jour.")
        return 0
    index.write_text(rendu, encoding="utf-8")
    print(f"INDEX.md écrit ({len(rendu.splitlines())} lignes).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
