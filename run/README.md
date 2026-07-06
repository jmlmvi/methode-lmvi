<!-- KIT-VERSION: 1.6.0 -->
# Pilier RUN — la vie après la livraison

> 3ᵉ pilier du kit ([conception](../conception/) / [conformité](../conformite/) / run). La méthode
> livre phase par phase ; ce pilier garantit que **ce qui est livré vit** : environnements,
> exploitation, flux qualité du code, doc & formation. Activé via le **casting M0** — recommandé
> partout, indispensable dès qu'un client ou un tiers exploite.

## Les 4 artefacts et où ils se branchent

| Artefact | Template | Se pose | Vit ensuite |
|---|---|---|---|
| **Environnements & promotion** | [`TEMPLATE-ENVIRONNEMENTS.md`](TEMPLATE-ENVIRONNEMENTS.md) | **M7** (câblage) | règle chaque déploiement (dev→staging→recette→prod, même image) |
| **Dossier d'exploitation** | [`TEMPLATE-EXPLOITATION.md`](TEMPLATE-EXPLOITATION.md) | dernière gate avant la prod | opéré au quotidien (SLA, backups **restauration prouvée**, runbooks) |
| **CI & revue de code** | [`TEMPLATE-CI-REVUE.md`](TEMPLATE-CI-REVUE.md) | **M7**, dès la P-0 | chaque incrément (exécute les suites taggées du pilier conception) |
| **Doc & formation** | [`TEMPLATE-DOC-FORMATION.md`](TEMPLATE-DOC-FORMATION.md) | ligne « doc due » dans la matrice **M6** | livrée à chaque gate ; formations calées sur les recettes |

## Doctrine

- **Une livraison sans exploitation n'est pas finie** : le dossier d'exploitation est un livrable
  de gate, pas une bonne intention.
- **Un backup jamais restauré n'est pas un backup** (clause zéro-mock appliquée au run) — la
  restauration se prouve, rapport archivé.
- **Même image du staging à la prod** : on promeut un tag, on ne rebuild pas.
- **La doc se livre avec la gate** : si la doc ne permet pas de rejouer la démo de recette, elle
  est fausse.
- La CI **consomme** les artefacts du pilier conception (suites `@US-x`/`@RG-x`/`@neg`,
  non-régression) — rien de nouveau à inventer, juste à exécuter à chaque incrément.

Le **prompt pilote** applique ce pilier quand le casting M0 l'active : environnements posés en M7,
ligne doc dans la matrice, dossier d'exploitation exigé avant la mise en prod.
