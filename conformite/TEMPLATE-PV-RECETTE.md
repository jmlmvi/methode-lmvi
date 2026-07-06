<!-- KIT-VERSION: 1.5.0 -->
<!-- PROUVE-SUR: — -->
# PV de recette — {{nom du chantier}} · phase {{P-x}}

> Template du **procès-verbal de recette** (pilier conformité). S'adosse à la **gate** de chaque
> phase : la démo reste la preuve, le PV la rend **opposable**. En solo, la gate suffit ; chez un
> client, pas de phase fermée sans PV.

## 1. Identification
| | |
|---|---|
| Chantier / phase | {{chantier}} · {{P-x}} |
| Gate (démo promise en M5) | {{« on voit X marcher »}} |
| Date · lieu / environnement | {{date}} · {{env de recette (cf. run/TEMPLATE-ENVIRONNEMENTS)}} |
| Participants | {{commanditaire client, recetteur, dev — casting M0}} |

## 2. Déroulé
| # | Scénario joué | Référence | Résultat |
|---|---|---|---|
| 1 | {{démo de la gate}} | {{US/CA}} | ✅ / ⛔ |
| 2 | {{suites automatisées de la phase}} | `@US-x @RG-x @neg` — rapport : `tracking/{{P-x}}/{{fichier}}` | ✅ / ⛔ |
| 3 | {{non-régression des phases précédentes}} | rapport joint | ✅ / ⛔ |

## 3. Réserves
| # | Description | Qualification | Délai de correction | Porteur |
|---|---|---|---|---|
| R-1 | {{…}} | bloquante / majeure / mineure | {{date}} | {{…}} |

**Règles** : ≥ 1 réserve **bloquante** → recette **ajournée** (la gate ne passe pas, méthode §2.1) ;
majeures/mineures → recette **prononcée avec réserves**, correction due sous le délai indiqué et
re-vérifiée au prochain PV.

## 4. Décision
☐ Recette **prononcée** · ☐ prononcée **avec réserves** (liste ci-dessus) · ☐ **ajournée**
**Garantie** : les corrections d'anomalies sur le périmètre recetté sont dues pendant {{durée}}
après prononciation. Signatures : {{commanditaire}} · {{réalisateur}} — le {{date}}.

## 5. Definition of Done
- [ ] Rapport des suites automatisées **archivé** dans `tracking/{{P-x}}/` (preuve réelle, zéro coche)
- [ ] Toute réserve a une qualification, un délai et un porteur
- [ ] Décision cochée et signée ; réserves du PV précédent re-vérifiées
