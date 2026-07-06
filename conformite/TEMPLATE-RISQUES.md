<!-- KIT-VERSION: 1.5.0 -->
<!-- PROUVE-SUR: — -->
# Registre des risques — {{nom du chantier}}

> Template du **registre des risques** (pilier conformité). Posé au cadrage (M0/M5), **relu à
> chaque gate** (le PV de recette y renvoie). Proactif — complète `tracking/*/BLOCKERS.md` qui,
> lui, est réactif.

## 1. Registre
| # | Risque | Prob. | Impact | Mitigation | Porteur | Statut / revu le |
|---|---|:---:|:---:|---|---|---|
| RSK-1 | {{…}} | H/M/B | H/M/B | {{action préventive + plan B}} | {{…}} | ouvert · {{date}} |

## 2. Risques types à passer en revue au cadrage (cocher = évalué)
- [ ] **Disponibilité du client** pour les décisions M4 et les recettes (le risque n°1 des chantiers gatés)
- [ ] **API / service tiers** : quota, coût, sandbox indisponible (clause zéro-mock → état `en_attente`, pas de faux vert)
- [ ] **Données legacy** de mauvaise qualité (si reprise — cf. `conception/TEMPLATE-INTERFACES-REPRISE.md`)
- [ ] **LLM** : dérive de coût par run, indisponibilité provider (fallback APIM), qualité des sorties
- [ ] **Périmètre** : besoin encore mouvant après M4 (→ `TEMPLATE-AVENANT.md`)
- [ ] **Équipe** : personne clé unique (bus factor), montée en compétence plateforme
- [ ] **Réglementaire** : données personnelles (→ `TEMPLATE-RGPD.md`), obligations sectorielles

## 3. Rituel
À chaque gate : re-parcourir le registre (statuts, nouveaux risques), noter « revu le {{date}} ».
Un risque qui se matérialise devient un BLOCKER de phase (méthode §2.1) et le registre garde la trace.

## 4. Definition of Done
- [ ] Les 7 familles de risques types évaluées au cadrage (ligne ou « écarté car … »)
- [ ] Chaque risque ouvert a une mitigation ET un porteur
- [ ] Date de dernière revue ≤ la dernière gate passée
