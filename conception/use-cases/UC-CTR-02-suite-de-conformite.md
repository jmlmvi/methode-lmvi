---
id: UC-CTR-02
titre: "Jouer la suite de conformité croisée"
theme: "UC-CTR · Contrats et conformité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "applications de conformité, gate.sh, 72 tests, idp.py"
---

# UC-CTR-02 — Jouer la suite de conformité croisée

## Questions auxquelles répond ce cas d'usage
1. Comment vérifier qu'un moteur respecte réellement le contrat ?
2. Quelles applications faut-il démarrer, et sur quels ports ?
3. Pourquoi mes tests de jeton échouent-ils tous ?
4. Combien de tests contient la suite, et où lire le rapport ?
5. La suite se joue-t-elle contre une seule implémentation ou contre toutes ?
6. Comment l'exécuter avant de livrer ?
7. Faut-il PostgreSQL pour la jouer ?

## Mots-clés
conformité, suite croisée, boîte noire, applications de conformité, ports 18080,
18181, 18282, `gate.sh`, 72 tests, `identity/idp.py serve`, JWKS 18499,
rapport, preuve, livraison, PostgreSQL, H2

## Ce que c'est, et quand s'en servir
Des tests **boîte noire** joués à l'identique contre chaque moteur : on démarre une application de
conformité par implémentation, et la suite interroge leurs routes, leurs formats, leur sécurité et
leur base technique.

C'est le seul instrument qui dit « les trois moteurs se comportent pareil ». On la joue avant chaque
livraison, et elle garde la trace de son passage comme preuve.

## Ce que le socle fait · ce qu'il interdit
Les applications de conformité **se démarrent seules** : leur script lance le serveur, il ne joue pas
la suite. La confusion coûte du temps — on lance le script, il ne rend jamais la main, et on croit la
suite bloquée.

Deuxième point qui fait trébucher tout le monde : la suite comprend des tests de jeton délégué, qui
exigent le **fournisseur d'identité de test** (il sert les clés publiques). Sans lui, ces tests
échouent — et l'on cherche la cause dans l'application. Il faut le démarrer d'abord, puis
l'application, puis la suite.

## Exemples
### Le bon ordre
```bash
# 1. le fournisseur d'identité de test (clés publiques)
python contracts/conformance/identity/idp.py serve &

# 2. l'application de conformité du moteur visé (elle ne rend pas la main)
contracts/conformance/apps/python-django/run.sh &        # port 18282

# 3. la suite
cd contracts/conformance && pytest -q
# 72 passed
```

### La gate d'une phase, qui archive la preuve
```bash
contracts/conformance/gate.sh P-2
# rapport archivé dans socle-py/docs/chantier/tracking/P-2/gate-<horodatage>/
```

### Avec PostgreSQL en plus
```bash
SOCLE_TEST_PG_URL=jdbc:postgresql://127.0.0.1:15432/techdb contracts/conformance/gate.sh P-2
```

## Pièges courants
- **Croire que le script de l'application joue la suite** : il démarre le serveur, c'est tout.
- **Oublier le fournisseur d'identité** : les tests de jeton échouent en bloc.
- **Jouer la suite contre une seule implémentation** et conclure à la conformité : l'intérêt est le
  croisement.
- **Ne pas archiver le rapport** : la preuve de conformité se perd.
- **Laisser des processus résiduels** : le port est occupé à la prochaine exécution.

## Cas d'usage voisins
- UC-CTR-01 — écrire un contrat hors du code
- UC-CTR-04 — faire échouer la CI sur une régression
- UC-CTR-06 — vérifier qu'un backend est indiscernable
- UC-DB-02 — choisir le moteur de base
