---
id: UC-RUL-09
titre: "Exécuter un script dynamique"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "ScriptEngine, executeScript, executeScriptFile, rechargement"
---

# UC-RUL-09 — Exécuter un script dynamique

## Questions auxquelles répond ce cas d'usage
1. Peut-on exécuter un script fourni par un fichier ou par la configuration ?
2. Quels usages légitimes cela couvre-t-il — transformation, règle modifiable ?
3. Quelles protections sont indispensables : délai, isolation, droits ?
4. Un script peut-il être rechargé sans redémarrer ?
5. Quelle est la différence avec la compilation à la volée ?
6. Dans les moteurs Python, que propose-t-on à la place ?
7. Comment tester un comportement qui vit dans un script ?

## Mots-clés
script, `ScriptEngine`, `executeScript`, `executeScriptFile`, BeanShell, JavaScript,
transformation, règle modifiable, rechargement à chaud, délai, isolation, droits,
exécution arbitraire, hors périmètre, test

## Ce que c'est, et quand s'en servir
Exécuter un script interprété, fourni en texte ou dans un fichier, pour une transformation de
données ou une règle que l'on veut pouvoir modifier sans livraison. Le Socle Java en fournit le
moteur, avec rechargement.

Le besoin est réel — une correspondance de champs qui change souvent, une règle en période de
calage. Mais la frontière avec « laisser n'importe qui exécuter du code chez nous » est mince, et
elle se tient par des protections, pas par la confiance.

## Ce que le socle fait · ce qu'il interdit
Java : le moteur exécute, met en cache, recharge, et borne le temps d'exécution ; sa documentation
traite explicitement de la sécurité et de l'accès concurrent.

Moteurs Python : **hors périmètre**. La raison est la même qu'ailleurs dans ce thème : un script
exécuté dans le processus hérite de tous ses droits — secrets, base, réseau, système de fichiers. Il
n'y a pas de « petit script sans risque ».

Ce qu'on fait à la place : une **transformation déclarative** (une correspondance de champs lue en
configuration, appliquée par du code testé), ou un paquet versionné quand il faut vraiment du code.
Et dans tous les cas, le comportement doit être testable : un script non testé est un trou dans la
couverture, quel que soit le langage.

## Exemples
### Socle Java
```java
Object resultat = scriptEngine.executeScript("montant * 1.2", Map.of("montant", 100));
Object r2 = scriptEngine.executeScriptFile(Path.of("/opt/app/scripts/mapping.bsh"), contexte);
```

### Moteurs Python — une transformation déclarative
```yaml
app:
  mapping:
    # Correspondance de champs : une donnée, pas du code.
    client_id: partner_customer_ref
    amount_cents: partner_amount
```
```python
def transformer(*, source: dict, mapping: dict[str, str]) -> dict:
    """Projeter les champs du partenaire vers nos noms, selon la correspondance déclarée."""
    return {cible: source[origine] for cible, origine in mapping.items() if origine in source}
```

### Ce qu'il ne faut jamais écrire
```python
exec(open(chemin_fourni).read())        # tous les droits du processus
eval(expression_du_partenaire)          # idem
```

## Pièges courants
- **Exécuter un fichier déposé** dans un dossier surveillé : quiconque écrit dans ce dossier
  exécute du code.
- **Pas de délai** : un script en boucle bloque le traitement.
- **Scripts non testés** : le comportement réel n'est vérifié par rien.
- **Rechargement silencieux** : le comportement change sans trace ; au minimum, journaliser le
  rechargement et la version.
- **Confondre transformation et calcul métier** : une règle de gestion mérite du code livré, testé.

## Cas d'usage voisins
- UC-RUL-07 — compiler du code à la volée
- UC-RUL-03 — écrire un évaluateur d'expression
- UC-OPS-08 — charger des plugins à chaud
- UC-DOM-04 — porter les règles de gestion dans un service
