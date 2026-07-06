<!-- KIT-VERSION: 1.6.0 -->
# CI & revue de code — {{nom du chantier}}

> Template du **flux qualité du code** (pilier run). Se pose en **M7**, s'applique à chaque
> incrément de chaque phase. « Incréments atomiques » (méthode §1·M7) sans définition du flux =
> chacun improvise ; ce document fixe les règles une fois.

## 1. Branches & incréments
- Modèle : {{`main` + branches courtes par incrément / trunk-based}} ; un **incrément atomique** =
  un lot cohérent qui compile, testé, ≤ {{~400 lignes de diff}} — sinon on découpe.
- Message de commit : {{convention — ex. `feat(P-1/US-B2): …`}} → la traçabilité US → code est
  gratuite dans l'historique.

## 2. Revue de code
| Contexte | Qui relit | Règle |
|---|---|---|
| Solo + agents | un agent séparé en revue adversariale | requis sur les briques des US `@pivot` et tout code d'habilitation/RG `droit_acces` |
| Équipe client | {{pair désigné du casting}} | toute PR ; auto-merge interdit |

La revue vérifie AUSSI : pas de mock/simulation, pas de brique plateforme recodée (contrat d'archi
§10), colonnes standard THESOCLE, secrets hors du code.

## 3. Ce que la CI exécute (à chaque incrément)
1. build ({{mvn clean package / npm build}}) ; 2. lint ; 3. **tests unitaires des briques** ;
4. **suites taggées de la phase courante** (`@US-x`, `@RG-x`, `@neg`) ; 5. **non-régression** :
suites des phases déjà livrées ; 6. rapport archivé (artefact) — c'est lui qu'on joint au PV.
Rouge = on ne merge pas ; « flaky » = un BLOCKER, pas une excuse.

## 4. Versionnage & livraison (convention LMVI)
Version bumpée **avec** les correctifs, en une fois : `pom.xml` + `build.properties` + tag image
Docker identiques. Une version livrée = un tag git = une image au registre. Changelog d'app :
{{fichier/lieu}} — alimenté à chaque gate, sert de release notes client.

## 5. Definition of Done
- [ ] Modèle de branches et taille max d'incrément adoptés
- [ ] Règle de revue par contexte (et périmètre « revue obligatoire » : pivots, habilitations)
- [ ] CI 6 étapes en place — la commande de gate de `TEMPLATE-TESTS.md` est un sous-ensemble
- [ ] Convention de version appliquée dès la P-0 (pas « on versionnera plus tard »)
