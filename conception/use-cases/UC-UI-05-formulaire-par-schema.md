---
id: UC-UI-05
titre: "Servir un formulaire piloté par un schéma"
theme: "UC-UI · Pages et frontend"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "tables JSON, UI schema, JSONForms, repository UI"
---

# UC-UI-05 — Servir un formulaire piloté par un schéma

## Questions auxquelles répond ce cas d'usage
1. Comment obtenir un écran de saisie sans écrire de code d'interface ?
2. Où sont décrits les champs, leurs types et leurs rôles ?
3. Qui peut modifier un écran — un développeur ou un fonctionnel ?
4. Comment les validations de l'écran se relient-elles aux règles du serveur ?
5. Dans les moteurs Python, ce mécanisme existe-t-il ?
6. Comment éviter que la validation d'écran remplace les règles métier ?

## Mots-clés
formulaire, schéma, `*.table.json`, `*.uischema.json`, JSONForms, rôles,
groupes de champs, écran généré, repository UI, éditeur, fonctionnel,
validation d'écran, règles serveur, hors périmètre

## Ce que c'est, et quand s'en servir
Décrire un écran par des données — le schéma des champs, la mise en page par rôle — et laisser un
moteur de rendu le construire. Le Socle Java s'appuie sur des fichiers de définition éditables, avec
un éditeur dédié.

L'intérêt est de faire évoluer un écran sans livraison, et de confier cette évolution à un
fonctionnel.

## Ce que le socle fait · ce qu'il interdit
Java : les définitions vivent dans le dépôt de fichiers éditables (UC-FIL-01), avec validation et
édition (UC-FIL-03). Moteurs Python : **hors périmètre**, comme le dépôt de fichiers lui-même.

Le piège de fond, indépendant du moteur : la validation décrite dans le schéma d'écran est un
**confort pour l'utilisateur**, pas une garantie. Les règles restent côté serveur (UC-DOM-04) ;
un appel direct à l'action contourne l'écran. Deux niveaux, deux responsabilités, et jamais la
règle uniquement dans le schéma.

## Exemples
### Socle Java — les définitions
```
repository/UI/
├── tables/       commandes.table.json       schéma JSON + rôles + groupes de champs
├── examples/     commandes.example.json     données de test
└── templatesUI/  commandes.uischema.json    mise en page par rôle
```

### Moteurs Python — l'écran vit dans le frontend, les règles au serveur
```python
# L'action valide la forme (UC-ACT-02), le service porte la règle (UC-DOM-04).
@param("amount_cents", required=True, type=ParameterType.LONG, min_value=1)
```

## Pièges courants
- **La règle uniquement dans le schéma d'écran** : un appel direct à l'action la contourne.
- **Un schéma sans exemple de données** : impossible de vérifier le rendu.
- **Des schémas non versionnés** : un écran change sans trace.
- **Dupliquer les libellés métier** entre schéma et serveur : ils divergent.

## Cas d'usage voisins
- UC-FIL-01 — exposer un dépôt de fichiers éditables
- UC-FIL-03 — éditer ces fichiers depuis FrontendEditorZen
- UC-ACT-02 — valider les paramètres
- UC-DOM-04 — porter les règles de gestion dans un service
