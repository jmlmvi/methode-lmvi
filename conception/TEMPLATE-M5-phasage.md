<!-- KIT-VERSION: 1.10.0 -->
<!-- PROUVE-SUR: — (niveau Feature v1.8 non prouvé ; chaîne de base prouvée sur Régie kit v1.0) -->
# M5 · Phasage gaté — {{nom du chantier}}

> Template. Une phase = un lot de **features**/US livré ensemble, avec une **gate = démo vérifiable**
> (la feature — capacité démontrable — est l'unité naturelle du découpage).
> **Convention de nommage des phases** : `{{préfixe}}` (`P-x` par défaut ; une instance peut choisir
> un autre préfixe) — **unique** pour le chantier, déclaré ici.

## 1. Rôle
Ordonner la livraison en incréments démontrables (axe LIVRAISON).

## 2. Entrée
**Features & épics** (M3) + **Décisions** (M4).

## 3. Livrable
Phases `P-0…P-n`, chacune avec contenu (épics/US) + **gate**. Estimation : ré-estimer × 2
*(⚗️ règle candidate, méthode §1·M5)*.

## 4. Relations (mermaid)
```mermaid
flowchart LR
  P0["P-0 Socle"] --> P1["P-1"]
  P1 --> P2["P-2"]
  P2 --> P3["P-3"]
  P0 -. "gate: {{démo}}" .-> G0(("✔"))
```

## 5. Contenu
| Phase | Contenu (features/US) | Gate (démo) |
|---|---|---|
| `{{P-0}}` | `{{…}}` | `{{« on voit X marcher »}}` |

## 6. Definition of Done
- [ ] Chaque phase apporte de la valeur **démontrable** seule
- [ ] `P-0` = socle qui débloque le reste *(⚗️ règle candidate)*
- [ ] Chaque gate formulée comme une **démo**, pas une tâche — et **vue par le rôle** quand la
      phase livre un écran (« le bénéficiaire, connecté, lit… »), avec la liste fixe de la gate
      d'écran (METHODE §1·M7 : rôle · fenêtre et ascenseur · un bouton ou une raison par état ·
      une sortie par étape · le texte dit l'état réel)
- [ ] Préfixe de phase déclaré (une seule convention pour le chantier)
