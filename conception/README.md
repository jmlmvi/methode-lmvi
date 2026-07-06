<!-- KIT-VERSION: 1.4.0 -->
# Pilier CONCEPTION — RG · Habilitations · Tests

> Le premier des 3 piliers du kit (conception / [conformité](../conformite/) / [run](../run/)) :
> **ce que le client signe côté produit, et la preuve associée**. Les piliers se branchent sur la
> colonne vertébrale M0→M7 ([`methode/`](../methode/)) — ils ne la remplacent pas. Activation
> déclarée dans le **casting M0** (en solo : `conception/` au minimum ; chez un client : les trois).

## Les 3 artefacts et où ils se branchent

| Artefact | Template | S'écrit en | Se mappe en | Se prouve en |
|---|---|---|---|---|
| **Fiches RG** (règles de gestion) | [`TEMPLATE-RG.md`](TEMPLATE-RG.md) | **M1** (avec la spec ; les décisions M4 les créent/modifient) | matrice de conformité RG→US | tests `@RG-x` (exemples/contre-exemples) |
| **Matrice d'habilitations** (rôle × US) | [`TEMPLATE-HABILITATIONS.md`](TEMPLATE-HABILITATIONS.md) | **M1** (le métier la signe) | **M6** : rôles → IAM/scopes `manifest.json` + mode SSO par route | tests négatifs (chaque ⛔ = 403 attendu) + étanchéité cross-tenant |
| **Plan de test** (par phase) | [`TEMPLATE-TESTS.md`](TEMPLATE-TESTS.md) | **M6.5** | colonne **Tests** de la matrice de couverture | gate de chaque P-x (run scripté + démo) |

## Le modèle de test aligné sur les 3 axes (rappel doctrinal)

Pas de mapping naïf « US→unitaires, épic→intégration » (même piège que « 1 épic = 1 worker ») :

- **US → ≥ 1 test d'acceptation** (ses CA), automatisé, taggé `@US-<code>` ;
- **RG → ≥ 2 tests** (cas conforme + cas de rejet), taggés `@RG-<code>` ;
- **épic → rollup** par tag (pas un niveau de test) + scénarios inter-US éventuels ;
- **brique → tests unitaires / intégration technique** (vivent avec le code) ;
- **phase P-x → gate scriptée** : acceptation de la phase + **toute** la non-régression des phases
  précédentes + démo humaine du non-automatisable ;
- **app → E2E / smoke post-déploiement**.

Calibrage recommandé : acceptation automatisée **au niveau API par défaut**, UI/E2E réservé aux US
pivots ; unitaires seulement où il y a de la vraie logique ; pas de dogme de % de couverture.

## Doctrine habilitations (frontière RBAC / RG)

Le **RBAC gros grain** vit dans l'IAM Hub (rôles/scopes du `manifest.json`, vérifiés au proxy et à
l'entrée de l'app — contrat d'architecture §5). Les **conditions fines** (ownership « ses propres
recettes », états, montants…) sont des **RG de type `droit_acces`**, appliquées dans le code. On ne
fabrique pas de moteur ABAC maison (anti-extrapolation).

## Génération automatique

Le générateur [`../methode/gen-fiches-us.py`](../methode/gen-fiches-us.py) consomme les sections
optionnelles `rg:` et `roles:` du YAML (cf. `us-data.example.yml`) et produit :
- `M1-spec-besoins/RG/` — 1 fiche par RG + index, liens croisés US↔RG automatiques ;
- `M1-spec-besoins/matrice-habilitations.generated.md` — brouillon rôle × US (✅ dérivés des acteurs,
  `?` à qualifier en ⛔/⚠️ à la main) ;
- `tests-squelettes/` — squelettes Gherkin `@US-x` (1 scénario par CA) et `@RG-x` (1 scénario par
  exemple + contre-exemple), **à déplacer dans le repo de code** et à implémenter.
