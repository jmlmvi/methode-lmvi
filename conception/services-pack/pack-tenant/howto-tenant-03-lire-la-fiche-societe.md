# HOWTO tenant-03 — Lire la fiche société du tenant

**Niveau :** Débutant
**Cible :** `socle-pack-tenant` 0.6.0 (API identique à 0.5.0) — `TenantProfile`, `model.Fiche`
**Hub :** ≥ 3.63.0 (`GET /api/iam/tenant/{slug}/fiche`, `mention_legale` composée par le Hub)
**Vérifié au code :** 2026-10-28
**Prérequis :** [[howto-tenant-01-integrer-le-pack|tenant-01]], [[howto-tenant-02-poser-le-tenant-courant|tenant-02]] ; fiche saisie au Hub (`iam_worker.upsert_tenant_fiche` ou `import_tenant`)
**Temps estimé :** 15 min

---

## 1. Contexte

Un pied de page de facture, un en-tête de courriel, la page « mentions légales » : tous demandent la
même société. La fiche est portée par le Hub (`iam.db_tenant_fiches`) et saisie **une fois**, par
l'administration. L'application la lit par `TenantProfile`, qui la sert depuis le cache du pack.

Cas réel : `APP-28-Your360`, `SocieteDuTenant` — depuis sa bascule P5, Your360 n'a plus aucune
colonne de société et compose ses cabinets à partir de la fiche.

---

## 2. Architecture

```
TenantProfile                         model.Fiche (record immuable)
 ├─ fiche()        tenant du MDC       ├─ slug, raisonSociale (obligatoire), nomCommercial
 ├─ ficheDe(slug)  autre tenant        ├─ signature, metier, anneeCreation, effectif
 ├─ fraicheur()    Instant             ├─ identiteLegale : formeJuridique, enseigneDe (slug),
 ├─ age()          Duration            │    siren, siret, tva, naf, capitalEuros, rcs, representant
 └─ perimee()      > fraicheur-max     ├─ coordonnees : adresse, codePostal, ville, pays,
                                       │    telephone, email, siteWeb
                                       ├─ dirigeant : prenom, nom, qualite, email, telephone,
                                       │    iamLogin, roles
                                       ├─ editeur : raisonSociale, forme, siren, tva, siege,
                                       │    directeurPublication, hebergeur, role
                                       ├─ marque  (tenant-04)   ├─ domaine : nom, hotes, courrier
                                       ├─ mentionLegale         └─ datas  (champs libres)
                                       ├─ nomAffiche()          nomCommercial sinon raisonSociale
                                       └─ mentionAImprimer()    mention_legale du Hub, sinon repli
```

---

## 3. Étape 1 — Lire la fiche du tenant courant

```java
package eu.lmvi.document;

import eu.lmvi.socle.pack.tenant.api.TenantProfile;
import eu.lmvi.socle.pack.tenant.model.Coordonnees;
import eu.lmvi.socle.pack.tenant.model.Fiche;
import eu.lmvi.socle.pack.tenant.model.IdentiteLegale;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
public class PiedDePage {

    private final TenantProfile profil;

    public PiedDePage(TenantProfile profil) {
        this.profil = profil;
    }

    /** Les lignes de pied de page d'un document émis au nom du tenant courant. */
    public List<String> lignes() {
        Fiche f = profil.fiche();                       // lève TenantSansFiche si rien à servir
        List<String> lignes = new ArrayList<>();
        lignes.add(f.mentionAImprimer());               // composée par le Hub, jamais recomposée ici

        Coordonnees c = f.coordonnees();
        if (c != null && c.adresse() != null) {
            lignes.add(c.adresse() + ", " + c.codePostal() + " " + c.ville());
        }
        IdentiteLegale l = f.identiteLegale();
        if (l != null && l.naf() != null) {
            lignes.add("Code NAF " + l.naf());
        }
        if (profil.perimee()) {
            lignes.add("Informations de société au " + profil.fraicheur());
        }
        return lignes;
    }
}
```

**`mentionAImprimer()` et non une concaténation maison.** Pour une enseigne,
`identiteLegale().enseigneDe()` est un **slug** de tenant (la porteuse), pas un nom imprimable :
seul le Hub, qui lit la fiche de la porteuse, sait composer la ligne. Le pack rend `mention_legale`
telle quelle ; quand le Hub ne la sert pas, il replie sur « raison sociale — forme — SIREN », repli
**incomplet pour une enseigne**. `IdentiteLegale.mentionComplete()` est déprécié.

---

## 4. Étape 2 — Lire la fiche d'un autre tenant

```java
Optional<Fiche> porteuse = profil.ficheDe(fiche.identiteLegale().enseigneDe());
```

`ficheDe` ne lève pas : `Optional.empty()` si le Hub n'en sert pas, refuse l'accès, ou ne répond
pas avec un cache vide. Côté Hub l'accès est contrôlé et tracé dans le journal du tenant consulté.
Une clé ordinaire ne lit que **le tenant de son propriétaire** : pour lire d'autres slugs, voir
[[howto-tenant-06-servir-plusieurs-tenants|tenant-06]].

---

## 5. Étape 3 — Les champs libres (`datas`)

Tout champ de premier niveau de la charge qui n'est pas une colonne connue part dans
`Fiche.datas()` (une `Map<String, Object>` immuable), avec le contenu du bloc `datas` servi par le
Hub. Exemple réel des cabinets RealWorks : `zone`, `ton`, `symbole`.

```java
Object zone = profil.fiche().datas().get("zone");   // "Nantes et Loire-Atlantique, …" ou null
```

Ajouter une donnée d'entreprise côté Hub ne demande donc **aucune** version du pack.

---

## 6. Ce que lève la lecture

| Exception | Quand | Que faire |
|---|---|---|
| `TenantSansFiche` (`tenantNonResolu()` = vrai) | aucun tenant dans le MDC | corriger le point d'entrée (tenant-02) |
| `TenantSansFiche` (slug renseigné) | le Hub répond 404, ou est muet et le cache est vide | dire « société non renseignée » ; **ne pas** y substituer des valeurs par défaut |
| `FicheInvalide` | le Hub répond 200 mais sans `raison_sociale`, ou une charge non objet | défaut de saisie au Hub ; **jamais** rattrapée en mode dégradé, y compris par `ficheDe` |

Un 401, un 403, un 5xx ou un timeout ne lèvent rien tant qu'une fiche est en cache : elle est servie
avec son âge ([[howto-tenant-07-fraicheur-cache-et-mode-degrade|tenant-07]]).

---

## 7. Vérifier

```bash
# La fiche telle que le Hub la porte (action d'administration du Hub)
curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/iam_worker/get_tenant_fiche \
  -d '{"slug":"atelier-des-parcours"}'

# La même, vue par la route que lit le pack — 401 sans clé prouve que la route est servie
curl -s -o /dev/null -w '%{http_code}\n' https://admin.thesocle.net/api/iam/tenant/atelier-des-parcours/fiche
curl -s -D - -H "X-API-Key: $APIM_KEY" https://admin.thesocle.net/api/iam/tenant/atelier-des-parcours/fiche | head -20
```

Attendu : `401`, puis `200` avec un en-tête `ETag` et `raison_sociale` dans le corps.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `profil.fiche().raisonSociale()` | non nul, identique à `get_tenant_fiche` |
| 2 | Tenant enseigne : `mentionAImprimer()` | nomme la société porteuse |
| 3 | Fiche supprimée au Hub, puis revalidation | `TenantSansFiche` (le 404 vide le cache) |
| 4 | `raison_sociale` vidée au Hub | `FicheInvalide`, visible, pas de pied de page vide |
| 5 | Champ libre ajouté à `datas` côté Hub | lisible dans `Fiche.datas()` après ≤ `revalidation` |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Recomposer la mention légale | un slug imprimé sur une facture, ou la porteuse absente | `mentionAImprimer()` |
| Attraper `TenantSansFiche` pour mettre des valeurs par défaut | un document émis au nom d'une société inventée | laisser remonter, ou afficher l'absence |
| `ficheDe(autre)` avec une clé ordinaire | `Optional.empty()` sans erreur | tenant-06 |
| Traiter `null` et `""` différemment | champ « vide » affiché | le pack lit les deux comme « non renseigné » |
| Attendre `fiche()` dans une action ou un cron sans MDC | `TenantSansFiche: aucun tenant résolu` | tenant-02 §4-§5 |
| Lire `effectif` / `capitalEuros` comme `int` | `NullPointerException` à l'unboxing | ce sont des `Integer`, souvent `null` |

---

## 10. Pour aller plus loin

- [[howto-tenant-04-rendre-la-marque|tenant-04]] — couleurs, logo, dialecte Thymeleaf
- [[howto-tenant-07-fraicheur-cache-et-mode-degrade|tenant-07]] — quand la fiche est servie du cache
- [[howto-34-gerer-les-tenants-iam|HOWTO 34]] — le tenant côté Hub
- `socle-pack-tenant/docs/CONTRAT-REST.md` §2 — la charge exacte
