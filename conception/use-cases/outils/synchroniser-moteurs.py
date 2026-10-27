#!/usr/bin/env python3
"""Recopier le catalogue des cas d'usage dans les moteurs, pour qu'il parte avec leur starter pack.

    python3 outils/synchroniser-moteurs.py           # synchronise
    python3 outils/synchroniser-moteurs.py --check   # échoue si une copie a dérivé

Le catalogue est écrit **une seule fois**, ici. Les moteurs en embarquent une copie dans leurs
ressources (``src/socle/resources/use-cases/``) : c'est elle qui voyage dans la roue, donc dans
l'archive du starter pack, donc dans le projet généré sur une machine qui n'a pas ce dépôt.

Une copie qui dérive est un piège : la suite de tests de chaque moteur rejoue ce contrôle en mode
``--check``, donc une modification du catalogue non synchronisée fait échouer les tests.
"""
import filecmp
import pathlib
import shutil
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
DEPOT = RACINE.parent.parent
#: Où le catalogue est recopié pour partir avec le starter pack de chaque moteur.
MOTEURS = {
    "socle-py-django": "src/socle/resources/use-cases",
    "socle-py": "src/socle/resources/use-cases",
    "socle-app-archetype": "src/main/resources/archetype-resources/docs/use-cases",
}
#: Ce qui voyage : l'index, les fiches, la source des identifiants, et les outils de contrôle.
INCLUS = ("INDEX.md", "catalogue.json")
IGNORES = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")


def fichiers_du_catalogue() -> list[pathlib.Path]:
    """
    Rendre les chemins relatifs des fichiers du catalogue à recopier.
    """
    fichiers = [pathlib.Path(nom) for nom in INCLUS]
    fichiers += [pathlib.Path(p.name) for p in sorted(RACINE.glob("UC-*.md"))]
    fichiers += [pathlib.Path("outils") / p.name for p in sorted(RACINE.glob("outils/*.py"))]
    return fichiers


def cible(moteur: str) -> pathlib.Path:
    """
    Rendre le dossier de destination du catalogue dans un moteur.
    """
    return DEPOT / moteur / MOTEURS[moteur]


def synchroniser(verifier: bool) -> int:
    fichiers = fichiers_du_catalogue()
    anomalies = 0
    for moteur in MOTEURS:
        destination = cible(moteur)
        if not (DEPOT / moteur).is_dir():
            print(f"  {moteur} : absent, ignoré")
            continue
        if verifier:
            manquants = [f for f in fichiers if not (destination / f).is_file()]
            differents = [f for f in fichiers if (destination / f).is_file()
                          and not filecmp.cmp(RACINE / f, destination / f, shallow=False)]
            surnuméraires = [p.relative_to(destination) for p in destination.rglob("*")
                             if p.is_file() and "__pycache__" not in p.parts
                             and p.relative_to(destination) not in fichiers]
            for liste, etiquette in ((manquants, "manquant"), (differents, "différent"),
                                     (surnuméraires, "en trop")):
                for fichier in liste:
                    print(f"  {moteur} : {fichier} {etiquette}")
                anomalies += len(liste)
            continue
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True)
        for fichier in fichiers:
            (destination / fichier).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(RACINE / fichier, destination / fichier)
        print(f"  {moteur} : {len(fichiers)} fichiers → {destination.relative_to(DEPOT)}")
    if verifier:
        print("\ncatalogue synchronisé." if not anomalies
              else f"\n{anomalies} écart(s) : relancez outils/synchroniser-moteurs.py")
    return 1 if anomalies else 0


if __name__ == "__main__":
    raise SystemExit(synchroniser("--check" in sys.argv))
