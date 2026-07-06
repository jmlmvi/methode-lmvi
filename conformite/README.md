<!-- KIT-VERSION: 1.5.0 -->
# Pilier CONFORMITÉ — le contractuel & légal

> 2ᵉ pilier du kit ([conception](../conception/) / conformité / [run](../run/)). **Ce qui rend le
> chantier opposable** : recette formelle, données personnelles, risques, changements de
> périmètre, audit. Activé via le **casting M0** — indispensable en contexte **client**, allégeable
> en solo (le registre des risques reste utile partout).

## Les 5 artefacts et où ils se branchent

| Artefact | Template | Se remplit | Se rejoue |
|---|---|---|---|
| **PV de recette** | [`TEMPLATE-PV-RECETTE.md`](TEMPLATE-PV-RECETTE.md) | à **chaque gate** de phase | réserves re-vérifiées au PV suivant |
| **RGPD / données perso** | [`TEMPLATE-RGPD.md`](TEMPLATE-RGPD.md) | avec la SPEC **M1** (revue de chaque entité) ; cas LLM tranché en **M4** | à chaque évolution du modèle |
| **Registre des risques** | [`TEMPLATE-RISQUES.md`](TEMPLATE-RISQUES.md) | au cadrage (**M0/M5**), 7 familles types | relu à **chaque gate** |
| **Fiche d'impact / avenant** | [`TEMPLATE-AVENANT.md`](TEMPLATE-AVENANT.md) | à chaque **changement de périmètre** (prolonge la boucle §2.2 côté contrat) | archivée dans `tracking/` |
| **Audit trail métier** | [`TEMPLATE-AUDIT-TRAIL.md`](TEMPLATE-AUDIT-TRAIL.md) | événements auditables en **M1**, brique en **M6** | prouvé par tests `@US-x`/`@RG-x` |

## Doctrine

- **La démo prouve, le PV rend opposable** : la gate reste une démo réelle ; le PV qualifie les
  réserves (bloquante = gate refusée) et déclenche la garantie.
- **Pas de dérive silencieuse** : tout changement de périmètre passe par une fiche d'impact — même
  « absorbé gratuitement », il est tracé.
- **Le RGPD se traite en M1, pas en fin de projet** : chaque entité est revue à l'écriture de la
  spec ; le cas LLM (données perso dans les prompts ?) est un arbitrage M4 obligatoire.
- **Audit métier ≠ logs techniques** : immuable, identité SSO, consultation habilitée — conçu,
  pas improvisé.

En contexte client, le **prompt pilote** (conception) applique ce pilier automatiquement quand le
casting M0 l'active : PV proposé à chaque gate, registre des risques relu, fiche d'impact ouverte
dès qu'une demande sort du périmètre.
