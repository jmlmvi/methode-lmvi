---
id: UC-DEV-02
titre: "Obtenir un squelette complet en couches"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: hors
  socle-py: hors
  socle-py-django: ok
contrat: "5.9"
mecanismes: "starter pack, 38 fichiers de gabarit, application orders, imports relatifs"
---

# UC-DEV-02 — Obtenir un squelette complet en couches

## Questions auxquelles répond ce cas d'usage
1. Que contient exactement le projet généré, fichier par fichier ?
2. L'exemple livré est-il un squelette vide ou une application qui tourne ?
3. Comment adapter l'exemple à mon domaine métier ?
4. Y a-t-il des marques de gabarit à remplacer après génération ?
5. Les autres moteurs livrent-ils la même chose ?
6. Comment vérifier que le projet généré est sain avant d'écrire une ligne ?

## Mots-clés
starter pack, squelette, couches, `orders`, 38 fichiers, gabarit, `__PKG__`,
imports relatifs, règles de gestion, tests, Docker, CI, `CONVENTIONS.md`,
`CLAUDE.md`, exemple qui tourne, adaptation

## Ce que c'est, et quand s'en servir
Le projet généré par `socle-py-django new` n'est pas un squelette vide : c'est une **application qui
tourne**, en couches, avec un domaine d'exemple (des commandes isolées par tenant) et sept règles
de gestion réelles — référence vide, montant non positif, montant au-delà du plafond, référence en
double, commande inconnue, commande non confirmable, encours au-delà du plafond.

L'intention est qu'on ait un exemple **juste** sous les yeux au moment d'écrire le sien : où va une
règle, où va une requête, comment un refus remonte, comment on teste sans serveur.

## Ce que le socle fait · ce qu'il interdit
Le gabarit vit **dans le framework**, donc il suit ses versions, et la suite de tests du framework
génère un projet puis le joue réellement — ce qui est documenté est donc ce qui est livré.

Les sources n'utilisent que des **imports relatifs** : rien à renommer après génération, aucune
marque de gabarit à chercher. Le nom du paquet est celui du projet.

Les deux autres moteurs ne livrent pas cet équivalent : `socle-py` génère un projet plus simple, et
l'archétype Java pose un projet Maven. Le squelette en couches avec échanges et revue est propre à
`socle-py-django`.

## Exemples
### L'arborescence livrée
```
mon-app/
├── Makefile  README.md  CLAUDE.md  CONVENTIONS.md
├── Dockerfile  docker-compose.yml  .dockerignore  .env.example
├── .githooks/pre-commit        .github/workflows/ci.yml
├── application.yml  manifest.json  pyproject.toml  vendor/
├── tests/                      les règles sans serveur, puis les actions du worker
└── src/mon_app/
    ├── orders/                 models · selectors · mutators · exchanges · services · migrations
    └── workers/orders_worker.py
```

### Vérifier avant d'écrire
```bash
cd mon-app
make check          # revue des conventions (0 violation) + tests (3 verts)
make run            # http://localhost:8080
```

### Adapter à son domaine
```bash
# 1. renommer l'application Django (orders → votre domaine), dans installed-apps aussi
# 2. remplacer le modèle, les règles et les échanges
# 3. make migrations && make check
```

## Pièges courants
- **Garder `orders` « pour l'instant »** : on finit avec un domaine d'exemple en production.
- **Supprimer les tests livrés** : ils montrent comment tester une règle sans serveur.
- **Renommer les dossiers de couches** : la revue ne les reconnaît plus (UC-DOM-02).
- **Oublier `installed-apps`** après renommage de l'application : l'ORM ne trouve plus les modèles.
- **Croire l'exemple décoratif** : il est exécuté par la suite de tests du framework.

## Cas d'usage voisins
- UC-DEV-01 — créer un projet neuf
- UC-DOM-02 — séparer les couches
- UC-DEV-04 — contrôler son code contre les conventions
- UC-DEV-08 — emporter le framework et sa doc hors du dépôt
