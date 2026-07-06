<!-- KIT-VERSION: 1.4.0 -->
# Habilitations — {{nom du chantier}}

> Template de la **matrice d'habilitations** (s'écrit en **M1**, le métier la signe ; se mappe en
> **M6** vers l'IAM). Doctrine : RBAC gros grain = IAM Hub (rôles/scopes `manifest.json`) ;
> conditions fines = RG de type `droit_acces` appliquées dans le code. L'app ne gère JAMAIS
> l'authentification (SSO proxy Hub, contrat d'architecture §5).

## 1. Des acteurs (M0) aux rôles métier
Un **acteur** est un persona ; un **rôle** est une habilitation. Une personne cumule des rôles.

| Rôle métier | Description | Acteurs M0 typiques |
|---|---|---|
| `{{role_1}}` | {{ce qu'il permet}} | {{acteur(s)}} |
| `{{role_admin}}` | administre le tenant (toujours en définir un) | {{…}} |

## 2. Matrice rôle × US (l'artefact signé)
Légende : ✅ autorisé · ⛔ interdit (→ **test négatif 403**) · ⚠️ conditionnel → RG `droit_acces`.

| US | {{role_1}} | {{role_2}} | {{role_admin}} |
|----|:---:|:---:|:---:|
| {{A1}} | ✅ | ⛔ | ✅ |
| {{B5}} | ⚠️ → {{RG-x}} | ⛔ | ✅ |

> Brouillon générable : `matrice-habilitations.generated.md` (✅ dérivés des acteurs du YAML,
> `?` à qualifier à la main). **Aucune cellule ne reste en `?`** — c'est la DoD.

## 3. Mapping technique (rempli en M6)
| Rôle métier | Rôle/scopes IAM (`manifest.json`) | Notes |
|---|---|---|
| `{{role_1}}` | `{{app}}.{{scope}}` | |
| *(agents/API)* | compte de service `{{svc}}` | jamais un compte humain |

- **Routes & SSO** : `{{route}}` → mode `{{none/optional/required}}` (par route, côté proxy Hub).
- **Tenant** : isolation par `x_partition` (= `X-SSO-Tenant`) ; **jamais** de requête cross-tenant.

## 4. Arbitrages types à passer en M4 (cocher = tranché)
- [ ] Granularité : rôles seuls ou permissions fines ? (défaut : rôles + RG `droit_acces`)
- [ ] Qui administre le tenant côté client ? Délégation possible ?
- [ ] Visibilité entre rôles (ex. un rôle voit-il les objets des autres ?)
- [ ] Données personnelles visibles par rôle (pont pilier conformité / RGPD)

## 5. Definition of Done
- [ ] Chaque US a une ligne ; **aucune cellule en `?`**
- [ ] Chaque ⚠️ pointe une RG `droit_acces` existante
- [ ] Chaque ⛔ a un **test négatif** planifié (`@US-x @neg`) + test d'étanchéité cross-tenant
- [ ] Mapping M6 complet (rôles → scopes, routes → mode SSO, compte de service)
- [ ] **Signée** par le métier (relecture M1 requise)
