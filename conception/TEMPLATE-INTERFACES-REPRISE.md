<!-- KIT-VERSION: 1.5.0 -->
# Interfaces & reprise de l'existant — {{nom du chantier}}

> Template **brownfield** : dès que l'app doit **coexister avec des systèmes existants** ou
> **reprendre des données legacy**. Les contrats d'interface se posent en **M1/M6** (le QUOI en
> M1, le câblage en M6) ; la reprise de données est presque toujours une **phase P-x dédiée**
> avec sa gate.

## 1. Contrats d'interface (un par système externe)
| # | Système | Sens | Contenu échangé | Format / protocole | Fréquence | Responsable côté client | Via |
|---|---|---|---|---|---|---|---|
| IF-1 | {{ERP, site web, SI métier…}} | entrant / sortant / bidirectionnel | {{quoi}} | {{REST/CSV/webhook…}} | {{temps réel / quotidien}} | {{qui maintient l'autre bout}} | **Hub/APIM** (contrat d'archi §2 — jamais de couplage direct) |

Pour chaque interface : **qui fait foi en cas d'écart** ({{source de vérité}}), comportement si
l'autre système est indisponible (état honnête `en_attente`, jamais un faux résultat), et ≥ 1 test
d'intégration réel (`@IF-x`).

## 2. Reprise de données legacy
| | |
|---|---|
| Source(s) | {{base, fichiers, exports}} |
| Volumétrie | {{lignes / Go}} |
| Qualité constatée | {{échantillon AUDITÉ réellement — doublons, champs vides, encodages ; jamais « on verra »}} |
| Règles de transformation | {{mapping vers le modèle M1, dédoublonnage, valeurs par défaut → décisions M4}} |
| Stratégie | one-shot / itérative / double-run (ancien + nouveau en parallèle pendant {{durée}}) |
| Rejets | tout enregistrement non reprenable est **listé et restitué au client** (pas de perte silencieuse) |

## 3. La reprise est une phase
`P-{{x}} · Reprise` avec sa **gate** : « {{N}} enregistrements repris, rapport de rejets présenté,
{{contrôle métier par échantillon}} validé par le client ». Le rapport de reprise (comptes
source/cible/rejets) est archivé dans `tracking/P-{{x}}/` — c'est la preuve.

## 4. Definition of Done
- [ ] Chaque système externe a son contrat IF-x (sens, format, responsable, indisponibilité)
- [ ] Qualité des données legacy **auditée sur échantillon réel** avant chiffrage
- [ ] Règles de transformation arbitrées (M4) ; rejets restitués, jamais silencieux
- [ ] La reprise a sa phase, sa gate et son rapport archivé
