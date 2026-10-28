# HOWTO tenant-05 — Lire l'équipe du tenant

**Niveau :** Débutant
**Cible :** `socle-pack-tenant` 0.7.0 (tag `v0.7.0`, commit `7235f83`, socle 5.11.0 — minimum 5.10.0 — / Boot 4.1.2 ; code identique à 0.6.0 `c3b70e3` ; API identique à 0.5.0) — `TenantMembres`, `model.Membre` (`ville` ajoutée en 0.5.0, `membresDe(slug)` ajoutée en 0.5.0)
**Hub :** ≥ 3.63.0 (`GET /api/iam/tenant/{slug}/membres`, conforme au contrat depuis le 2026-10-02)
**Vérifié au code :** 2026-10-28
**Prérequis :** [[howto-tenant-01-integrer-le-pack|tenant-01]], [[howto-tenant-02-poser-le-tenant-courant|tenant-02]] ; membres saisis au Hub (`iam_worker.upsert_tenant_membre`)
**Temps estimé :** 15 min

---

## 1. Contexte

Une page « équipe », la signature d'un courriel, l'en-tête d'un bilan qui nomme le consultant : ces
données vivent au Hub, dans `iam.db_tenant_membres`. La personne elle-même reste dans `iam.users` ;
la fiche membre ne porte que ce que l'IAM ne porte pas — fonction, bio, citation, photo, CV.

Clé `(tenant, login)` : la même personne présente dans deux tenants a deux fiches membres.

Cas réel : `APP-28-Your360`, `EquipeDuTenant`.

---

## 2. Architecture

```
TenantMembres
 ├─ membres()          tenant du MDC ─┐
 ├─ membre(login)      filtre         ├─► FicheService.membres(slug)
 ├─ parRole(role)      filtre         │     1. entree(slug)  ← exige la fiche (cache ou Hub)
 └─ membresDe(slug)    autre tenant  ─┘     2. membres déjà dans l'entrée ? → servis
                                            3. sinon GET /membres, rangés dans l'entrée de cache

model.Membre : login, prenom, nom, fonction, telephone, email, bioCourte, citation, ville,
               photoUrl (signée), roles (List<String>), cv
               cv : formations[diplome, etablissement, annee], certifications[intitule, annee],
                    experiences[poste, employeur, debut, fin, missions], specialites, langues
               nomComplet() · aRole(role) · Experience.enCours() (fin == null)
```

---

## 3. Étape 1 — Page équipe

```java
package eu.lmvi.equipe;

import eu.lmvi.socle.pack.tenant.api.TenantMembres;
import eu.lmvi.socle.pack.tenant.model.Membre;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class EquipeController {

    private final TenantMembres equipe;

    public EquipeController(TenantMembres equipe) {
        this.equipe = equipe;
    }

    @GetMapping("/api/equipe")
    public List<Map<String, Object>> equipe() {
        return equipe.membres().stream().map(EquipeController::vue).toList();
    }

    @GetMapping("/api/equipe/{login}")
    public Map<String, Object> membre(@PathVariable String login) {
        return equipe.membre(login).map(EquipeController::vue)
                .orElse(Map.of("erreur", "membre inconnu dans ce tenant"));
    }

    private static Map<String, Object> vue(Membre m) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("login", m.login());
        v.put("nom", m.nomComplet());
        v.put("fonction", m.fonction() == null ? "" : m.fonction());
        v.put("ville", m.ville() == null ? "" : m.ville());
        v.put("photo_url", m.photoUrl() == null ? "" : m.photoUrl());
        v.put("roles", m.roles());
        v.put("specialites", m.cv() == null ? List.of() : m.cv().specialites());
        return v;
    }
}
```

## 4. Étape 2 — Signature de courriel

```java
public String signature(String loginExpediteur) {
    Membre m = equipe.membre(loginExpediteur)
            .orElseThrow(() -> new IllegalStateException(
                    loginExpediteur + " n'est pas membre du tenant courant"));
    return m.nomComplet() + "\n" + m.fonction() + "\n" + profil.fiche().nomAffiche()
            + (m.telephone() == null ? "" : "\n" + m.telephone());
}
```

## 5. Étape 3 — Filtrer par rôle

```java
List<Membre> consultants = equipe.parRole("consultant");
```

⚠️ **Les rôles ne sont pas normalisés au Hub** (contrat §4, relevé du 2026-10-16) : le tenant `lmvi`
sert `dirigeant` / `collaborateur`, les cabinets RealWorks `cabinet_admin` / `consultant`. Sur
`lmvi`, `parRole("consultant")` rend une liste vide. Déclarer dans l'app la liste des rôles
acceptés plutôt qu'une seule valeur.

## 6. Étape 4 — L'équipe d'un autre tenant

```java
List<Membre> autres = equipe.membresDe("altitude");
```

Rend une liste vide si `slug` est vide, ou si le Hub est muet sur `/membres` alors que la fiche est
connue. **Mais** lève `TenantSansFiche` quand la fiche du slug n'est ni servie ni en cache (404,
refus 403, Hub muet) : la méthode passe par `entree(slug)`. La javadoc annonce « jamais une
exception » ; le code en lève une dans ce cas. L'entourer :

```java
List<Membre> autres;
try {
    autres = equipe.membresDe("altitude");
} catch (TenantSansFiche e) {
    autres = List.of();
}
```

Une app multi-tenant doit en outre annoncer le tenant de l'appel (`envoyer-tenant-actif`,
[[howto-tenant-06-servir-plusieurs-tenants|tenant-06]]).

---

## 7. Vérifier

```bash
curl -s -H "X-API-Key: $APIM_KEY" \
  https://admin.thesocle.net/api/iam/tenant/atelier-des-parcours/membres | head -c 600
```

Attendu : `{"slug":…,"membres":[{"login":…,"prenom":…,"nom":…,"roles":["…"],"cv":{…}}]}` — `roles`
en **tableau**, `cv` en **objet**. Puis :

```bash
curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/mcp_proxy_worker/mcp_proxy_invoke \
  -d '{"tool":"monapp__tenant_fiche_worker__list_fiches_cache","params":"{}"}'
```

Attendu après un appel à `/api/equipe` : `"membres_charges": true` sur la ligne du tenant.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `membres()` sur un tenant à 4 membres | 4 éléments, ordre servi par le Hub |
| 2 | `membre(login)` d'un autre tenant | `Optional.empty()` |
| 3 | `nomComplet()` sans prénom ni nom | le login |
| 4 | Expérience avec `fin: null` | `enCours()` vrai |
| 5 | `membresDe(slug)` sur un tenant sans fiche | `TenantSansFiche` (à entourer) |
| 6 | Membre modifié au Hub | visible quand l'`ETag` de la fiche change (l'équipe est rechargée avec une nouvelle fiche, gardée sur un `304`) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Rôles supposés uniformes | `parRole` vide sur certains tenants | liste de rôles acceptés par l'app |
| `membresDe` sans `try` | une page de supervision en 500 pour un slug sans fiche | entourer `TenantSansFiche` |
| Attendre `liens` (LinkedIn, site) | le Hub les sert, `Membre` ne les modélise pas (0.7.0 compris) | demander l'évolution du pack (PACK FIRST), pas un second client |
| Membre modifié au Hub, fiche inchangée | ancienne équipe tant que l'`ETag` de la fiche ne change pas (l'équipe vit dans l'entrée de la fiche) | `refresh_fiche slug=…` ; le contrat demande au Hub de changer l'`ETag` sur `upsert_tenant_membre` |
| `photoUrl` stockée | URL signée expirée | la relire à chaque rendu |
| Hub muet sur `/membres` | liste vide (WARN), pas d'erreur | voir le bandeau de fraîcheur (tenant-07) |

---

## 10. Pour aller plus loin

- [[howto-tenant-03-lire-la-fiche-societe|tenant-03]] — la fiche
- [[howto-08-creer-utilisateur-iam|HOWTO 08]] — la personne côté IAM
- `socle-pack-tenant/docs/CONTRAT-REST.md` §4 et `docs/ECARTS-HUB-MEMBRES.md`
