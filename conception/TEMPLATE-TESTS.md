<!-- KIT-VERSION: 1.4.0 -->
<!-- PROUVE-SUR: — -->
# Plan de test — {{nom du chantier}} · phase {{P-x}}

> Template du **plan de test par phase** (s'écrit en **M6.5**, s'exécute à la gate de {{P-x}}).
> Modèle doctrinal : cf. [README du pilier](README.md) (tests alignés sur les 3 axes, jamais
> « US→unitaires »). **Zéro mock** : un test sans dépendance réelle disponible = état honnête
> `en_attente`, jamais un faux vert.

## 1. Conventions (une fois pour le chantier)
- **Tagging** : `@US-<code>` (acceptation) · `@RG-<code>` (règle) · `@neg` (test négatif ⛔) ·
  `@pivot` (US pivot) — la couverture US/RG↔tests devient **calculable** (CI).
- **Emplacement** : tests d'acceptation `{{repo}}/src/test/…/acceptance/` · unitaires avec le code ·
  E2E `{{repo}}/e2e/`. Squelettes générés : `tests-squelettes/` (à déplacer puis implémenter).
- **Niveau par défaut** : acceptation **API** ; UI/E2E réservé aux `@pivot`.

## 2. Couverture de la phase {{P-x}}
| US / RG | Tests (IDs ou fichiers) | Niveau | Auto ? | État |
|---|---|---|---|---|
| {{A1}} | `@US-A1` {{fichier}} | API | ✅ | à écrire |
| {{RG-A2}} | `@RG-A2` (conforme + rejet) | API | ✅ | à écrire |
| {{B2 (pivot)}} | `@US-B2 @pivot` | UI | ✅ | à écrire |
| {{cellules ⛔ habilitations}} | `@US-x @neg` (403) + cross-tenant | API | ✅ | à écrire |
| {{non-automatisable}} | démo à la gate : {{quoi montrer}} | manuel | ⛔ | — |

## 3. Non-régression
La gate de {{P-x}} exécute **aussi** : {{suites des phases précédentes — commande}}.

## 4. La gate, en une commande
```bash
{{commande CI/local qui lance : acceptation P-x + négatifs + non-régression}}
# rapport archivé dans tracking/{{P-x}}/ comme preuve (clause gate = preuve réelle)
```
Puis démo humaine du non-automatisable, validée par {{recetteur du casting M0}}.

## 5. Definition of Done
- [ ] Chaque US de la phase a ≥ 1 test d'acceptation taggé (ou une démo listée en §2)
- [ ] Chaque RG touchée par la phase a ses 2 scénarios (conforme + rejet)
- [ ] Chaque ⛔ d'habilitation de la phase a son test négatif + étanchéité cross-tenant
- [ ] La colonne **Tests** de la matrice de couverture (M6) est remplie pour la phase
- [ ] La commande de gate tourne et son rapport est archivé dans `tracking/{{P-x}}/`
