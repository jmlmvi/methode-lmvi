<!-- KIT-VERSION: 1.7.0 -->
<!-- PROUVE-SUR: — -->
# RETEX méthode — {{nom du chantier}} · {{date}}

> Template du **post-mortem méthode** (à ne pas confondre avec le post-mortem produit). Rempli par
> le pilote à la **fin du chantier** (ou à son arrêt §2.4), arbitré par le commanditaire.
> **C'est lui qui fait évoluer le kit** : une version du kit = un RETEX (règle de cadence) —
> le canonique est gelé pendant les chantiers.

## 1. Le chantier en une ligne
{{profil}} · {{mode d'entrée}} · {{n}} US · {{n}} phases · du {{début}} au {{fin}} · issue :
{{livré / arrêté §2.4}}.

## 2. Verdict par maillon
| Maillon | Utilisé ? | Utile ? (la friction en une phrase) | Durée | Allers-retours commanditaire |
|---|---|---|---|---|
| M0 | oui/non | {{…}} | {{…}} | {{n}} |
| M1 (+RG, habilitations) | | | | |
| M2/M3 (générateur) | | | | |
| M4 | | | | |
| M5 · M6 · M7 | | | | |
| P-x (par phase : gate, PV) | | | | |

## 3. Verdict par template (fait vivre `PROUVE-SUR`)
| Template | Instancié ? | Verdict | Action kit |
|---|---|---|---|
| {{TEMPLATE-X}} | oui, en réel | tient / à amender ({{quoi}}) | `PROUVE-SUR` += ce chantier |
| {{TEMPLATE-Y}} | **non** | {{pourquoi pas ?}} | reste ⚗️ / **candidat à la coupe** (2 RETEX sans usage = coupé) |

## 4. Frictions (reprises de KIT-FRICTIONS.md, dédupliquées)
| # | Friction | Gravité | Proposition kit |
|---|---|---|---|
| F-1 | {{…}} | bloquant / gênant / cosmétique | {{…}} |

## 5. Économie de la méthode (données, pas impressions)
Temps commanditaire total : {{h}} (dont attente de décisions : {{h}}) · durée méthode avant 1ʳᵉ
ligne de code : {{j}} · rapport méthode/réalisation : {{…}} · coût agents (tokens/€ si connu) : {{…}}.
**Verdict** : proportionné / trop lourd sur {{maillons}} / trou sur {{…}}.

## 6. Décisions pour la prochaine version du kit (arbitrées par le commanditaire)
1. {{changement retenu → change-set}}
2. {{template coupé / fusionné}}
3. {{règle candidate ⚗️ confirmée → règle}}

## 7. Definition of Done
- [ ] Tous les maillons et templates du profil ont un verdict (y compris « non utilisé »)
- [ ] Chaque friction a une proposition (ou « on vit avec »)
- [ ] Section économie chiffrée depuis PILOTAGE.md (pas de souvenir)
- [ ] Les décisions §6 sont le SEUL contenu de la prochaine version du kit
