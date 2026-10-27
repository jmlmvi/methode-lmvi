<!-- KIT-VERSION: 1.11.3 -->
<!-- PROUVE-SUR: — (niveau Feature v1.8 non prouvé ; chaîne de base prouvée sur Régie kit v1.0) -->
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
5. **Plan de test** (`TEMPLATE-TESTS.md` — tagging `@US-x`/`@RG-x`, gate scriptée, non-régression
des gates précédentes) · 6. **Mapping habilitations → IAM** (rôles métier → rôles/scopes
`manifest.json` + mode SSO par route, §3 de `TEMPLATE-HABILITATIONS.md`).

### 3 bis. Routage des briques (dans cet ordre : services, puis mécanismes)
Avant d'écrire une brique, on cherche où elle est déjà décrite :
1. **un service de la plateforme ?** → `APP-ZZ-TEMPLATE/docs/services-disponibles/` (index
   `00-index.md`) : on le **consomme** et on cite le guide — la table « besoin → guide » des 44
   guides est dans `CATALOGUE-SERVICES.md` (même dossier) ;
2. **sinon, un mécanisme du socle ?** → `APP-ZZ-TEMPLATE/docs/use-cases/` (index `INDEX.md` ; table
   « besoin → fiche » des 148 fiches dans `CATALOGUE-MECANISMES.md`, même dossier) : on
   cite la fiche et on **suit le mécanisme qu'elle prescrit** ;
3. **sinon** → `NON COUVERT`, écrit ici avant de coder ; le catalogue s'enrichit en M7.

| Brique | Ce qu'elle fait | Service consommé (`howto-NN`) | Mécanisme suivi (`UC-XXX-NN`) | Non couvert |
|--------|-----------------|-------------------------------|-------------------------------|-------------|
| `{{NomWorker}}` | `{{publie l'événement « idée reçue » sur NATS}}` | `{{howto-37}}` | `{{UC-RES-01}}` | |
| `{{NomService}}` | `{{calcule le score}}` | — | `{{UC-DOM-02}}` | |
| `{{NomStage}}` | `{{…}}` | — | — | `{{NON COUVERT — pourquoi, et quel catalogue enrichir}}` |

> Une brique peut citer un guide **et** une fiche : elle consomme un service par un mécanisme du
> socle. Une ligne sans aucune des trois colonnes remplies bloque le contrôle avant go.

## 4. Relations (mermaid)
```mermaid
flowchart LR
  M5["M5 Phases"] --> M6["M6 Plan"]
  M6 --> EX["Exécution + suivi"]
  US["US"] --> FT["Feature"] --> EP["Épic"] --> PH["Phase"] --> BR["Brique"]
```

## 5. Matrice de couverture (le garde-fou)
| US | Feature | Épic | Phase | Brique technique | Tests | Gate | Statut / révisé le |
|----|---------|------|-------|------------------|-------|------|--------------------|
| `{{X1}}` | `{{F-X1}}` | `{{A}}` | `{{P-0}}` | `{{service/stage/worker}}` | `{{@US-X1 (+@RG-x, +@neg)}}` | `{{démo}}` | `{{à faire}}` |

## 6. Definition of Done
- [ ] Chaque US tracée jusqu'à une brique (aucune orpheline)
- [ ] Aucune brique sans US
- [ ] Réutilisation plateforme explicitée · **zéro mock**
- [ ] Table de routage remplie : chaque brique cite son guide, sa fiche, ou porte `NON COUVERT`
- [ ] Colonne **Tests** remplie (aucune US sans test ni démo listée) · plan de test posé
- [ ] Mapping habilitations → IAM complet (si pilier conception actif)
- [ ] **Relecture faite** (relecteur défini en M0)
