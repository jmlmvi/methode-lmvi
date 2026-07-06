<!-- KIT-VERSION: 1.5.0 -->
# Audit trail métier — {{nom du chantier}}

> Template du **registre des événements auditables** (pilier conformité). « Qui a fait quoi,
> quand » **opposable** — distinct des logs techniques (TechDB) qui, eux, sont volatils et
> orientés diagnostic. Se conçoit en **M1** (les événements viennent des US/RG), s'implémente
> comme une brique M6.

## 1. Registre des événements auditables
| Événement métier | Déclencheur (US/RG) | Tracé (qui · quoi · avant → après) | Rétention | Qui peut consulter |
|---|---|---|---|---|
| {{ex. commit d'une proposition}} | {{US F1 / RG-A6}} | user, objet, horodatage, delta | {{durée}} | {{rôle(s) — matrice d'habilitations}} |

**Choisir peu et bien** : on audite les événements à valeur probante (validations, écritures,
suppressions logiques, accès sensibles), pas chaque clic.

## 2. Implémentation (référence plateforme, décidée en M6)
- Table applicative `tr_audit_*` (standard THESOCLE : `x_partition`, immuable — INSERT only,
  jamais UPDATE/DELETE) ; l'identité vient des en-têtes SSO (`X-SSO-User`), jamais d'une saisie.
- La consultation est une capacité à part entière : ligne dans la matrice d'habilitations
  (souvent rôle admin/auditeur seul) + US dédiée si le client doit la voir en UI.
- Rétention/purge alignées sur le volet RGPD si des données personnelles y figurent.

## 3. Preuve
Chaque événement du registre a **≥ 1 test** : l'action déclenche l'écriture d'audit (`@RG-x` ou
`@US-x`), et un test négatif prouve qu'un rôle non habilité ne lit pas le journal.

## 4. Definition of Done
- [ ] Chaque événement tracé remonte à une US ou une RG (zéro invention)
- [ ] Immuabilité et identité SSO garanties par conception (pas par discipline)
- [ ] Consultation dans la matrice d'habilitations + tests (écriture et lecture interdite)
- [ ] Cohérence RGPD (rétention) vérifiée
