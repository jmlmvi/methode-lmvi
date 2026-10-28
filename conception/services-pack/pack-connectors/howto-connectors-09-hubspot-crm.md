# HOWTO CONNECTORS-09 — HubSpot : contacts, entreprises et deals

**Niveau :** Intermédiaire
**Cible :** app qui alimente ou consulte un CRM HubSpot
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:2.0.0` — `HubspotWorker` (12 actions),
HubSpot CRM API v3, jeton Private App en `Authorization: Bearer`
**Temps estimé :** 20 min

---

## 1. Contexte

`hubspot_worker` couvre les trois objets CRM les plus utilisés. Les propriétés sont transmises
**telles quelles** à HubSpot (noms internes HubSpot : `firstname`, `dealstage`, `amount`…), toutes
converties en **chaînes**.

| Action | Paramètres | Appel HubSpot |
|---|---|---|
| `create_contact` | `email`, `firstname?`, `lastname?`, `properties?` | `POST /crm/v3/objects/contacts` |
| `get_contact` | `contact_id` | `GET /crm/v3/objects/contacts/{id}` |
| `search_contacts` | `query`, `limit?` (10, max 100) | `POST /crm/v3/objects/contacts/search` (recherche plein texte) |
| `update_contact` | `contact_id`, `properties` | `PATCH /crm/v3/objects/contacts/{id}` |
| `create_deal` | `name`, `stage`, `amount?`, `contact_id?` | `POST /crm/v3/objects/deals` + association deal→contact (type 3) |
| `get_deal` | `deal_id` | `GET /crm/v3/objects/deals/{id}` |
| `list_deals` | `stage?`, `limit?` | `GET /deals` ou `POST /deals/search` filtré `dealstage EQ` |
| `update_deal` | `deal_id`, `properties` | `PATCH /crm/v3/objects/deals/{id}` |
| `create_company` | `name`, `domain?`, `properties?` | `POST /crm/v3/objects/companies` |
| `search_companies` | `query`, `limit?` | `POST /crm/v3/objects/companies/search` |
| `test_connection`, `get_status` | — | `GET /contacts?limit=1` / local |

Chaque réponse rend `id` et `properties` (map brute HubSpot).

---

## 2. Architecture

```
app ──► HubspotWorker ─► RateLimiter (socle.conn.hubspot.rate-limit-rps = 8)
                      ─► ResilienceFactory.execute("hubspot")
                      ─► OkHttp  Authorization: Bearer pat-…  ──► api.hubapi.com/crm/v3/…
                      ─► ConnectorLogger ──► tr_connector_log (connector=hubspot)
```

---

## 3. Étape 1 — Private App HubSpot

Settings → Integrations → Private Apps → créer l'app, scopes au minimum
`crm.objects.contacts.read/write`, `crm.objects.companies.read/write`, `crm.objects.deals.read/write`.

```bash
SOCLE_CONN_HUBSPOT_ENABLED=true
SOCLE_CONN_HUBSPOT_API_KEY=pat-eu1-xxxxxxxx
```

---

## 4. Étape 2 — Pousser un prospect et son deal depuis l'app

```java
package eu.lmvi.monapp.crm;

import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.connectors.HubspotWorker;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class HubspotProspects {

    private final ObjectProvider<HubspotWorker> hubspot;

    public HubspotProspects(ObjectProvider<HubspotWorker> hubspot) {
        this.hubspot = hubspot;
    }

    /** Crée (ou retrouve) le contact puis ouvre un deal associé. Renvoie l'id du deal. */
    @SuppressWarnings("unchecked")
    public String ouvrirDeal(String email, String prenom, String nom, String intitule, double montant) {
        HubspotWorker w = hubspot.getIfAvailable();
        if (w == null) throw new IllegalStateException("hubspot_worker inactif");
        ActionContext ctx = ActionContext.internal("hubspot_prospects");

        ActionResult found = w.executeAction("search_contacts",
                ActionParameters.fromMap(Map.of("query", email, "limit", 1)), ctx);
        String contactId;
        List<Map<String, Object>> res = found.success()
                ? (List<Map<String, Object>>) found.getData("results") : List.of();
        if (!res.isEmpty()) {
            contactId = String.valueOf(res.get(0).get("id"));
        } else {
            ActionResult c = w.executeAction("create_contact", ActionParameters.fromMap(Map.of(
                    "email", email, "firstname", prenom, "lastname", nom,
                    "properties", Map.of("lifecyclestage", "lead"))), ctx);
            if (!c.success()) throw new IllegalStateException("HubSpot contact : " + c.error());
            contactId = c.getDataString("id");
        }

        ActionResult d = w.executeAction("create_deal", ActionParameters.fromMap(Map.of(
                "name", intitule, "stage", "appointmentscheduled",
                "amount", montant, "contact_id", contactId)), ctx);
        if (!d.success()) throw new IllegalStateException("HubSpot deal : " + d.error());
        return d.getDataString("id");
    }
}
```

---

## 5. Étape 3 — Opérations en REST

```bash
W=http://localhost:8080/admin/workers/hubspot_worker/actions
H=(-H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json")

curl -s "${H[@]}" -X POST $W/search_companies -d '{"query":"acme","limit":5}'
curl -s "${H[@]}" -X POST $W/list_deals -d '{"stage":"presentationscheduled","limit":50}'
curl -s "${H[@]}" -X POST $W/update_deal -d '{"deal_id":"1234567","properties":{"dealstage":"closedwon"}}'
```

---

## 6. Vérifier

```bash
curl -s "${H[@]}" -X POST $W/test_connection -d '{}'
# data : {"connected":true}
```

```sql
SELECT action, status, latency_ms, error_message FROM schema_monapp.tr_connector_log
WHERE connector = 'hubspot' ORDER BY x_id DESC LIMIT 10;
```

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `create_contact` | `id` renvoyé ; contact visible dans HubSpot |
| 2 | `create_deal` avec `contact_id` | Deal associé au contact dans HubSpot |
| 3 | `list_deals` avec `stage` | `deals[]` + `total` |
| 4 | `create_contact` sur un email existant | Échec `HTTP 409: Contact already exists…` |
| 5 | Jeton sans scope deals | Échec `HTTP 403` sur `create_deal` |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Recréer un contact existant | `HTTP 409` ; et l'échec compte pour le circuit breaker | `search_contacts` avant `create_contact` |
| Valeurs non textuelles | Tout part en chaîne (`p.put(k, v.toString())`) ; une liste devient `"[a, b]"` | Pour une case à cocher multiple, envoyer `"a;b"` (format HubSpot) |
| Valeur `null` dans `properties` | Envoyée comme `""` : **efface** la propriété HubSpot | Retirer la clé plutôt que la mettre à `null` |
| `stage` libellé (« Rendez-vous fixé ») | `HTTP 400` | Identifiant interne du stage du pipeline (`appointmentscheduled`…) |
| Pipeline non par défaut | Deal créé dans le pipeline par défaut | Ajouter `"pipeline"` via `update_deal` ou hors pack |
| `list_deals` sans `stage` | Une page de `limit` éléments, **sans curseur** | Pagination absente : hors pack au-delà de 100 deals |
| `search_contacts` | Recherche plein texte HubSpot, pas un filtre exact sur l'email | Vérifier `properties.email` du résultat |
| Associations autres que deal→contact | Non proposées | API HubSpot directe |
| `amount` | Paramètre `DOUBLE` ; HubSpot le stocke en texte | Lire `properties.amount` comme chaîne |

---

## 9. Pour aller plus loin

- [[howto-connectors-03-gerer-les-identifiants|CONNECTORS-03 — Identifiants]]
- [[howto-connectors-10-resilience-et-journal-des-appels|CONNECTORS-10 — Résilience et journal]]
