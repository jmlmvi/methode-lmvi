#!/usr/bin/env python3
"""Vérifier le catalogue des cas d'usage : une fiche par cas, et chaque fiche exploitable par un RAG.

    python3 outils/verifier-catalogue.py        # sortie 1 à la première anomalie

Une fiche qu'un RAG ne peut pas retrouver ne sert à rien : ce contrôle exige donc les questions
(plusieurs, et par angles différents), les mots-clés, les sections d'explication et d'exemples, et
des renvois qui existent. Les règles de forme sont ici, pas dans la relecture d'un humain.
"""
import json
import pathlib
import re
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
SECTIONS = ("## Questions auxquelles répond ce cas d'usage", "## Mots-clés",
            "## Ce que c'est, et quand s'en servir", "## Ce que le socle fait · ce qu'il interdit",
            "## Exemples", "## Pièges courants", "## Cas d'usage voisins")
QUESTIONS_MINIMUM = 6
MOTS_CLES_MINIMUM = 8
STATUTS = ("ok", "P-3", "P-4", "P-5", "hors", "na")


#: Clés dont la valeur est citée : elle contient des « · », des « @ », des « [ »… que YAML refuse nus.
CLES_CITEES = ("titre", "theme", "contrat", "mecanismes", "voir-aussi")
_SCALAIRE = re.compile(r'^([a-z-]+): (".*"|[A-Za-z0-9][^"\n]*)$')
_MOTEUR = re.compile(r"^  ([a-z-]+): ([A-Za-z0-9-]+)$")


def bloc_entete(texte: str) -> str:
    """
    Rendre le bloc d'en-tête brut (entre les deux ``---``), ou une chaîne vide s'il n'y en a pas.
    """
    return texte.split("---\n", 2)[1] if texte.startswith("---\n") else ""


def entete(texte: str) -> dict:
    """
    Rendre l'en-tête de la fiche : les scalaires décités, et ``moteurs`` en dictionnaire.

    L'en-tête doit être du **YAML valide** : les éditeurs et les indexeurs le lisent comme tel.
    D'où les valeurs citées et le bloc ``moteurs`` en véritable table imbriquée.
    """
    tete: dict = {"moteurs": {}}
    for ligne in bloc_entete(texte).splitlines():
        moteur = _MOTEUR.match(ligne)
        if moteur:
            tete["moteurs"][moteur.group(1)] = moteur.group(2)
            continue
        scalaire = _SCALAIRE.match(ligne)
        if scalaire:
            valeur = scalaire.group(2)
            tete[scalaire.group(1)] = valeur[1:-1] if valeur.startswith('"') else valeur
    return tete


def anomalies_entete(nom: str, texte: str) -> list[str]:
    """
    Rendre les anomalies de forme de l'en-tête : lignes illisibles, valeurs non citées, YAML invalide.
    """
    bloc = bloc_entete(texte)
    if not bloc:
        return [f"{nom} : en-tête absent (il doit ouvrir le fichier, entre deux ---)"]
    anomalies = []
    for ligne in bloc.splitlines():
        if _MOTEUR.match(ligne):
            continue
        scalaire = _SCALAIRE.match(ligne)
        if not scalaire:
            if ligne.strip() != "moteurs:":
                anomalies.append(f"{nom} : en-tête, ligne illisible « {ligne[:60]} »")
            continue
        if scalaire.group(1) == "moteurs":
            # « moteurs: java: ok · … » sur une ligne est une imbrication interdite en YAML :
            # les éditeurs refusent le fichier. Il faut une table imbriquée, un moteur par ligne.
            anomalies.append(f"{nom} : en-tête, « moteurs » doit être une table imbriquée "
                             f"(un moteur par ligne, indenté de deux espaces)")
            continue
        if scalaire.group(1) in CLES_CITEES and not scalaire.group(2).startswith('"'):
            anomalies.append(f"{nom} : en-tête, « {scalaire.group(1)} » doit être cité "
                             f'(valeur entre guillemets) pour rester du YAML valide')
    try:  # contrôle strict quand un analyseur YAML est disponible (il l'est dans les deux venvs)
        import yaml
    except ImportError:
        return anomalies
    try:
        charge = yaml.safe_load(bloc)
    except yaml.YAMLError as exc:
        return anomalies + [f"{nom} : en-tête non analysable en YAML — {str(exc).splitlines()[0]}"]
    if not isinstance(charge, dict) or not isinstance(charge.get("moteurs"), dict):
        anomalies.append(f"{nom} : en-tête YAML valide mais mal structuré "
                         f"(« moteurs » doit être une table imbriquée)")
    return anomalies


def questions(texte: str) -> list[str]:
    """
    Rendre les questions posées, une question pouvant tenir sur plusieurs lignes.
    """
    posees: list[str] = []
    for ligne in section(texte, SECTIONS[0]).splitlines():
        nue = ligne.strip()
        if re.match(r"^\d+\.", nue):
            posees.append(nue)
        elif nue and posees:
            posees[-1] += " " + nue
    return posees


def section(texte: str, titre: str) -> str:
    if titre not in texte:
        return ""
    reste = texte.split(titre, 1)[1]
    return reste.split("\n## ", 1)[0]


def verifier_fiche(chemin: pathlib.Path, identifiant: str, theme: str, cas: dict,
                   connus: set[str]) -> list[str]:
    if not chemin.is_file():
        return [f"{identifiant} : fiche absente ({chemin.name})"]
    texte = chemin.read_text(encoding="utf-8")
    anomalies = anomalies_entete(chemin.name, texte)
    tete = entete(texte)
    if tete.get("id") != identifiant:
        anomalies.append(f"{chemin.name} : en-tête « id » = {tete.get('id')!r}, attendu {identifiant!r}")
    if theme not in tete.get("theme", ""):
        anomalies.append(f"{chemin.name} : en-tête « theme » ne porte pas {theme}")
    for moteur, statut in cas["moteurs"].items():
        if tete["moteurs"].get(moteur) != statut:
            anomalies.append(f"{chemin.name} : en-tête « moteurs » contredit le catalogue "
                             f"({moteur} attendu à {statut}, trouvé {tete['moteurs'].get(moteur)!r})")
    for titre in SECTIONS:
        if titre not in texte:
            anomalies.append(f"{chemin.name} : section manquante « {titre.lstrip('# ')} »")
    posees = questions(texte)
    if len(posees) < QUESTIONS_MINIMUM:
        anomalies.append(f"{chemin.name} : {len(posees)} question(s), {QUESTIONS_MINIMUM} au minimum")
    for question in posees:
        if "?" not in question:
            anomalies.append(f"{chemin.name} : « {question[:50]}… » n'est pas une question")
    debuts = [" ".join(re.sub(r"^\d+\.\s*", "", q).lower().split()[:4]) for q in posees]
    if len(set(debuts)) != len(debuts):
        anomalies.append(f"{chemin.name} : deux questions attaquent par les mêmes mots "
                         f"(angles à différencier)")
    mots = [m.strip() for m in section(texte, "## Mots-clés").replace("\n", " ").split(",")
            if m.strip()]
    if len(mots) < MOTS_CLES_MINIMUM:
        anomalies.append(f"{chemin.name} : {len(mots)} mot(s)-clé(s), {MOTS_CLES_MINIMUM} au minimum")
    voisins = set(re.findall(r"UC-[A-Z]{3}-\d{2}", section(texte, SECTIONS[-1])))
    for voisin in sorted(voisins - connus):
        anomalies.append(f"{chemin.name} : renvoi vers {voisin}, qui n'existe pas")
    if identifiant in voisins:
        anomalies.append(f"{chemin.name} : la fiche se cite elle-même en voisine")
    return anomalies


def main() -> int:
    donnees = json.loads((RACINE / "catalogue.json").read_text(encoding="utf-8"))
    attendues, anomalies = {}, []
    for theme in donnees["themes"]:
        for cas in donnees["cas"][theme["code"]]:
            identifiant = f"{theme['code']}-{cas['num']:02d}"
            attendues[identifiant] = (RACINE / f"{identifiant}-{cas['slug']}.md", theme["code"], cas)
            if cas["moteurs"].keys() != {m["code"] for m in donnees["moteurs"]}:
                anomalies.append(f"{identifiant} : moteurs incomplets dans catalogue.json")
            for moteur, statut in cas["moteurs"].items():
                if statut not in STATUTS:
                    anomalies.append(f"{identifiant} : statut inconnu « {statut} » ({moteur})")
    connus = set(attendues)
    for identifiant, (chemin, theme, cas) in attendues.items():
        anomalies += verifier_fiche(chemin, identifiant, theme, cas, connus)
    presentes = {p.name for p in RACINE.glob("UC-*.md")}
    for orpheline in sorted(presentes - {c.name for c, _, _ in attendues.values()}):
        anomalies.append(f"{orpheline} : fiche sans entrée dans catalogue.json")
    for anomalie in anomalies:
        print(f"  {anomalie}")
    print(f"\n{len(attendues)} cas d'usage, {len(presentes)} fiche(s) — "
          f"{len(anomalies)} anomalie(s)." if anomalies else
          f"\n{len(attendues)} cas d'usage, {len(presentes)} fiches — catalogue conforme.")
    return 1 if anomalies else 0


if __name__ == "__main__":
    raise SystemExit(main())
