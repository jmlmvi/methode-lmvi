---
id: UC-CTR-01
titre: "Écrire un contrat hors du code"
theme: "UC-CTR · Contrats et conformité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "contracts/, YAML, routes, clés, sujets, DDL, H1"
---

# UC-CTR-01 — Écrire un contrat hors du code

## Questions auxquelles répond ce cas d'usage
1. Qu'appelle-t-on un contrat dans le Socle, et où est-il écrit ?
2. Qu'est-ce qui relève du contrat et qu'est-ce qui n'en relève pas ?
3. Pourquoi ne pas simplement documenter le code de référence ?
4. Qui écrit un contrat, et qui le relit ?
5. Comment un contrat devient-il vérifiable plutôt que déclaratif ?
6. Que se passe-t-il si une implémentation s'en écarte ?
7. Où trouve-t-on la version du contrat en vigueur ?

## Mots-clés
contrat, `contracts/`, hors du code, YAML, routes, `health.yaml`, `workers.yaml`,
`public-routes.yaml`, `identity.yaml`, `keys.yaml`, `topics.yaml`, DDL,
comportement observable, référence, version, H1, conformité

## Ce que c'est, et quand s'en servir
Un contrat décrit, **hors du code**, ce qui est observable de l'extérieur : routes et formats de
réponse, routes publiques, règles d'identité, clés de configuration, sujets du bus, schéma des
tables techniques.

La raison d'être est simple : trois implémentations doivent se comporter de la même façon. Si la
référence est « le code Java », alors chaque divergence devient une archéologie. Si la référence est
un fichier lisible, elle s'arbitre et se vérifie.

## Ce que le socle fait · ce qu'il interdit
Le contrat vit dans un dossier dédié, avec sa version. Il n'est pas de la documentation : il est
**exécuté** par la suite de conformité (UC-CTR-02), qui le vérifie contre chaque moteur.

Ce qui n'en relève pas : les choix internes d'implémentation. Le contrat dit « cette route rend ces
champs » ; il ne dit pas comment la réponse est construite. C'est ce qui laisse chaque moteur
idiomatique — un backend Python n'a pas à imiter la structure interne du Java pour être conforme.

Modifier un contrat n'est donc pas un changement de code local : c'est une évolution livrée dans les
trois moteurs (UC-CTR-05).

## Exemples
### Ce que contient le dossier des contrats
```
contracts/
├── VERSION                       5.9
├── rest/      health.yaml, workers.yaml
├── security/  identity.yaml, public-routes.yaml, sensitive-names.yaml
├── config/    keys.yaml
├── kvbus/     topics.yaml
└── techdb/    ddl-core.sql, audit.yaml
```

### Un contrat se lit
```yaml
# contracts/security/public-routes.yaml (extrait de principe)
public:
  - /health
  - /health/live
  - /health/ready
  - /metrics
```

### Et il se vérifie
```bash
contracts/conformance/apps/python-django/run.sh        # démarre l'application de conformité
# puis la suite, qui joue le contrat contre elle
```

## Pièges courants
- **Changer un format « juste un peu »** : tout champ renommé ou ajouté dans une réponse touche le
  contrat.
- **Documenter au lieu de contractualiser** : une documentation ne casse pas la CI, un contrat oui.
- **Mettre de l'implémentation dans le contrat** : on bride les moteurs sans bénéfice.
- **Oublier la version** : impossible de dire ce qu'une instance respecte.

## Cas d'usage voisins
- UC-CTR-02 — jouer la suite de conformité croisée
- UC-CTR-03 — annoncer sa version de contrat
- UC-CTR-05 — faire évoluer un contrat dans les trois moteurs
- UC-CFG-02 — partager les mêmes clés entre les moteurs
