<!-- KIT-VERSION: 1.6.0 -->
<!-- PROUVE-SUR: — -->
# Environnements & promotion — {{nom du chantier}}

> Template des **environnements** (pilier run). Se pose en **M7** (câblage) : où le code tourne à
> chaque étape de sa vie, avec quelles données, et **qui promeut quoi**.

## 1. Les environnements
| Env | Cible (Hub/minihub) | URL | Données | Secrets | Qui déploie |
|---|---|---|---|---|---|
| **dev** | {{poste / compose local}} | {{localhost:…}} | jeu de test (générable) | `.env` local, jamais committé | dev |
| **staging** | {{hub/minihub interne}} | {{app-staging.…}} | jeu de test + copies anonymisées | Vault | dev (libre) |
| **recette client** | {{…}} | {{…}} | données client de recette (**jamais** prod copiée sans anonymisation — cf. RGPD) | Vault | dev, sur demande du recetteur |
| **prod** | {{…}} | {{…}} | réelles | Vault | **uniquement après PV** (contexte client) ou gate (solo) |

Chemin plateforme identique partout : **build image → registre → déploiement** (contrat d'archi §6) ;
un env = une route proxy + un schéma PG + un vault-path. Jamais de « ça marche que sur ma machine ».

## 2. Règles de promotion
1. **dev → staging** : à chaque incrément vert (CI passée — cf. `TEMPLATE-CI-REVUE.md`).
2. **staging → recette** : quand la gate de la phase est jouable (les suites `@US-x` de la phase
   passent en staging).
3. **recette → prod** : gate validée (solo) ou **PV de recette prononcé** (client). Jamais avant.
4. Toute promotion = **même image** (tag exact), pas de rebuild entre recette et prod.

## 3. Données de test
{{comment on fabrique le jeu de test : seed SQL, générateur, extraction anonymisée — et où il vit}}.
Clause zéro-mock : le jeu de test est **réaliste** (volumétrie NFR M1), pas trois lignes de démo.

## 4. Definition of Done
- [ ] Chaque env a sa ligne complète (cible, données, secrets, déployeur)
- [ ] Les 4 règles de promotion adoptées (ou dérogation = décision M4)
- [ ] Recette client ≠ prod, toujours
- [ ] Jeu de test réaliste disponible et documenté
