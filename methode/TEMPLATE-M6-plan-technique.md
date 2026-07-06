<!-- KIT-VERSION: 1.4.0 -->
# M6 · Plan technique + matrice de couverture — {{nom du chantier}}

> Template. Choisir les briques **par nature** (arbre V005), **jamais par épic**. Réutiliser la plateforme.
> La matrice est la **seule source de vérité** du mapping US→phase→brique (méthode §0).
> **Relecture requise** (méthode §1).

## 1. Rôle
Traduire chaque phase en briques techniques + prouver la couverture.

## 2. Entrée
**Phasage** (M5) + **Spec** (M1).

## 3. Livrable (par phase)
1. **Réutilisation plateforme** (ce qu'on NE code pas) · 2. **Briques nouvelles**
(worker/service/stage/package) · 3. **Modèle de données** · 4. **Matrice de couverture** ·
5. **Plan de test** (pilier conception : `conception/TEMPLATE-TESTS.md` — tagging `@US-x`/`@RG-x`,
gate scriptée, non-régression des gates précédentes) · 6. **Mapping habilitations → IAM**
(rôles métier → rôles/scopes `manifest.json` + mode SSO par route, §3 de
`conception/TEMPLATE-HABILITATIONS.md`).

## 4. Relations (mermaid)
```mermaid
flowchart LR
  M5["M5 Phases"] --> M6["M6 Plan"]
  M6 --> EX["Exécution + suivi"]
  US["US"] --> EP["Épic"] --> PH["Phase"] --> BR["Brique"]
```

## 5. Matrice de couverture (le garde-fou)
| US | Épic | Phase | Brique technique | Tests | Gate | Statut / révisé le |
|----|------|-------|------------------|-------|------|--------------------|
| `{{X1}}` | `{{A}}` | `{{P-0}}` | `{{service/stage/worker}}` | `{{@US-X1 (+@RG-x, +@neg)}}` | `{{démo}}` | `{{à faire}}` |

## 6. Definition of Done
- [ ] Chaque US tracée jusqu'à une brique (aucune orpheline)
- [ ] Aucune brique sans US
- [ ] Réutilisation plateforme explicitée · **zéro mock**
- [ ] Colonne **Tests** remplie (aucune US sans test ni démo listée) · plan de test posé
- [ ] Mapping habilitations → IAM complet (si pilier conception actif)
- [ ] **Relecture faite** (relecteur défini en M0)
