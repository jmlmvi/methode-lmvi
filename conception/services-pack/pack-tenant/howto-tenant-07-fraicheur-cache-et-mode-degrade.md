# HOWTO tenant-07 — Fraîcheur, cache et mode dégradé

**Niveau :** Confirmé
**Cible :** `socle-pack-tenant` ≥ 0.2.1 (séparation `revalidation` / `fraicheur-max`) — documenté sur 0.6.0 (comportement identique à 0.5.0)
**Hub :** ≥ 3.63.0 (`ETag` + `304` sur `If-None-Match`, mesurés le 2026-10-02)
**Vérifié au code :** 2026-10-28 (`FicheService`, `FicheCache`, `TenantFicheWorker`, `ModeDegradeTest`)
**Prérequis :** [[howto-tenant-01-integrer-le-pack|tenant-01]]
**Temps estimé :** 20 min

---

## 1. Contexte

Le pack lit la fiche **quasi en direct** et tient debout quand le Hub tombe. Trois mécanismes :

1. **Revalidation par `ETag`** — au-delà de `revalidation` (30 s), la fiche est redemandée avec
   `If-None-Match` ; un `304` coûte quelques octets et remet sa fraîcheur à jour.
2. **Cache LRU** de `cache-max` entrées (200), clé = slug. Ce n'est plus un accélérateur mais un
   **filet** : il sert la dernière fiche connue quand le Hub se tait.
3. **Signalement de l'âge** — au-delà de `fraicheur-max` (1 h), `perimee()` devient vrai et le
   bandeau Thymeleaf s'affiche.

Deux propriétés, et pas une seule : une valeur courte pour lire en direct ferait crier « données
vieilles » au premier hoquet réseau ; une valeur longue ferait traîner une raison sociale fausse
pendant des heures. Arbitrage du 2026-10-03, appliqué en 0.2.1 (`docs/ECART-CONTRAT-KVBUS.md`).

**Ce que le Hub doit tenir, et rien d'autre** : servir l'`ETag` sur `/fiche`, répondre `304`, et
changer l'`ETag` à chaque écriture (`upsert_tenant_fiche`, `set_tenant_logo`, `import_tenant`,
`upsert_tenant_membre`). Aucun événement à publier.

---

## 2. Architecture — l'arbre de décision de `FicheService.entreeOptionnelle(slug)`

```
fiche en cache et âge ≤ revalidation ? ──oui──► servie, AUCUN appel réseau
        │ non
        ▼
GET /fiche  (If-None-Match: <etag> si connue)
   ├─ 304 ──────────► entrée « confirmée » maintenant (âge remis à 0), servie
   ├─ 200 + ETag ───► nouvelle entrée (équipe à recharger), servie
   ├─ 404 ──────────► cache vidé pour ce slug → Optional.empty → TenantSansFiche
   ├─ 200 sans raison_sociale ──► FicheInvalide (jamais absorbée)
   └─ 401 / 403 / 5xx / timeout / connexion refusée  (HubIndisponible)
          ├─ cache présent ─► servie telle quelle, WARN « servie depuis le cache, âge … »
          │                    perimee() vrai si âge > fraicheur-max → bandeau
          └─ cache vide ────► ERROR, Optional.empty → TenantSansFiche
```

`TenantFicheWorker` (PASSIVE) complète :

- **préchargement** au `start()` des tenants déjà vus — leur liste est mémorisée dans le KvBus local,
  clé `socle.tenant.vus` (CSV, bornée par `cache-max`), écrite à chaque nouveau tenant et au `stop()` ;
- **abonnement** `tenant.fiche.modifiee` sur le KvBus local, dans `initialize()`. Le KvBus V005 en
  mémoire est intra-process : le Hub, autre JVM, ne l'alimente pas. L'abonnement est inerte par
  défaut et ne sert que si les instances partagent un jour un KvBus adossé à Redis.

---

## 3. Étape 1 — Régler

```yaml
socle:
  tenant:
    revalidation: ${SOCLE_TENANT_REVALIDATION:30s}     # quand rappeler le Hub
    fraicheur-max: ${SOCLE_TENANT_FRAICHEUR_MAX:1h}    # quand avertir
    cache-max: ${SOCLE_TENANT_CACHE_MAX:200}           # tenants gardés
    read-timeout: ${SOCLE_TENANT_READ_TIMEOUT:5s}      # connect/read/write ; appel complet ≤ 2×
    prechargement: ${SOCLE_TENANT_PRECHARGEMENT:true}
```

Repères :

- `revalidation` borne la charge : au pire `cache-max` revalidations par fenêtre, pour l'essentiel
  des `304`. Le Hub et les apps vivent sur la même machine ; 30 s est un défaut prudent, non mesuré.
- `read-timeout` est **le budget ajouté à une requête** quand la revalidation tombe sur un Hub lent :
  jusqu'à 2 × 5 s. Le baisser pour une page interactive.
- `cache-max` ≥ nombre de tenants servis, sinon l'éviction LRU fait repayer un aller-retour.

## 4. Étape 2 — Afficher l'état à l'utilisateur

```java
package eu.lmvi.web;

import eu.lmvi.socle.pack.tenant.api.TenantProfile;
import eu.lmvi.socle.pack.tenant.api.TenantSansFiche;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class FraicheurController {

    private final TenantProfile profil;

    public FraicheurController(TenantProfile profil) {
        this.profil = profil;
    }

    @GetMapping("/api/societe/fraicheur")
    public Map<String, Object> fraicheur() {
        try {
            return Map.of(
                    "obtenue_le", profil.fraicheur().toString(),
                    "age", profil.age().toString(),
                    "perimee", profil.perimee());
        } catch (TenantSansFiche e) {
            return Map.of("perimee", false, "erreur", e.getMessage());
        }
    }
}
```

En Thymeleaf : `${#tenant.perimee}` (ne lève jamais) et `${#tenant.age}` (tenant-04).

## 5. Étape 3 — Agir sur le cache par action MCP

Actions de `tenant_fiche_worker` (toutes `SYNC`) :

| Action | Paramètre | Effet |
|---|---|---|
| `get_status` | — | `abonne_kvbus`, `fiches_en_cache`, `cache_max`, `invalidations`, `prechargees`, `revalidation`, `fraicheur_max`, `read_timeout`, `configure` |
| `list_fiches_cache` | — | par tenant : `nom`, `age`, `perimee`, `etag`, `membres_charges` |
| `refresh_fiche` | `slug` | vide fiche **et** logo en cache, redemande sans `ETag`, rend `nom`, `etag`, `confirmee_le` |
| `invalidate_fiche` | `slug` | vide fiche et logo, sans recharger |

```bash
curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/mcp_proxy_worker/mcp_proxy_invoke \
  -d '{"tool":"monapp__tenant_fiche_worker__list_fiches_cache","params":"{}"}'
```

Ou directement sur l'app, par `POST /mcp` avec `MCP_API_KEY` (relever d'abord le nom exact de
l'outil par `"method":"tools/list"` — la forme ci-dessous n'a pas été mesurée sur une app) :

```bash
curl -s https://monapp.thesocle.net/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Accept: application/json, text/event-stream" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"tenant_fiche_worker__refresh_fiche","arguments":{"slug":"altitude"}}}'
```

---

## 6. Vérifier

```bash
# L'ETag est servi, et le 304 répond
ETAG=$(curl -s -D - -o /dev/null -H "X-API-Key: $APIM_KEY" \
  https://admin.thesocle.net/api/iam/tenant/atelier-des-parcours/fiche | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $APIM_KEY" -H "If-None-Match: $ETAG" \
  https://admin.thesocle.net/api/iam/tenant/atelier-des-parcours/fiche
# → 304
```

---

## 7. Validation

Tests du pack qui le prouvent (`ModeDegradeTest`, Hub réellement absent : un port où rien n'écoute) :

| Test | Prouve |
|---|---|
| `ficheFraicheEnCacheServieSansAppelReseau` | aucun appel sous `revalidation` |
| `hubMuetEtFichePerimeeServieAvecSonAge` | filet + âge |
| `auDelaDeLIntervalleDeRevalidationLaFicheEstQuandMemeServieEtSansBandeau` | 10 min : Hub rappelé, échec, fiche servie, pas de bandeau |
| `auDelaDeLaToleranceDePeremptionLeBandeauApparait` | 2 h : bandeau |
| `hubMuetEtCacheVideArreteLApplication` | `TenantSansFiche` |
| `ficheDeRendOptionalVideQuandLeHubEstMuet` | `ficheDe` ne lève pas |

Côté app :

| # | Test | Attendu |
|---|---|---|
| 1 | Corriger la raison sociale au Hub | visible en ≤ `revalidation` |
| 2 | Arrêter le Hub, recharger une page déjà vue | servie, WARN dans les journaux |
| 3 | Attendre > `fraicheur-max` Hub arrêté | bandeau |
| 4 | Redémarrer l'app Hub arrêté | les tenants déjà vus sont absents du cache (le préchargement échoue) → `TenantSansFiche` |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Croire que `fraicheur-max` décide du rappel | modification au Hub vue « trop tard » ou bandeau intempestif | `revalidation` décide du rappel, `fraicheur-max` de l'avertissement |
| Se fier au défaut `24h` du README / du manifeste ≤ 0.5.0 | attente erronée | code : 1 h — README et manifeste corrigés en 0.6.0 |
| Compter sur l'événement `tenant.fiche.modifiee` | rien ne se passe à la modification | la revalidation `ETag` est le mécanisme ; `refresh_fiche` pour forcer |
| Un `403` (grant manquant) lu comme une panne du Hub | mode dégradé permanent sur un tenant | tenant-06 |
| Premier démarrage, Hub muet | aucune fiche, `TenantSansFiche` : le cache est en mémoire, rien n'est persisté | prévoir l'écran d'absence ; le préchargement ne recharge qu'un Hub joignable |
| `FicheInvalide` attendue en mode dégradé | exception même avec une fiche en cache | c'est voulu : corriger la saisie au Hub |
| `read-timeout` élevé sur une page interactive | page bloquée jusqu'à 2 × le délai quand le Hub rame | baisser le délai |
| `isHealthy()` pris pour la santé du Hub | worker vert, Hub absent | la santé du worker = démarré ; regarder `list_fiches_cache` (`age`, `perimee`) |

---

## 9. Pour aller plus loin

- `socle-pack-tenant/docs/ECART-CONTRAT-KVBUS.md` — pourquoi aucun événement
- `socle-pack-tenant/docs/CONTRAT-REST.md` §2 et §5
- [[howto-20-configurer-cache|HOWTO 20]] — le cache du Hub (sans rapport avec celui-ci)
