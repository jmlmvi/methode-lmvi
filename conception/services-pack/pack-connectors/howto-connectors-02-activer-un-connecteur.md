# HOWTO CONNECTORS-02 — Activer un connecteur à la demande

**Niveau :** Débutant
**Cible :** une app qui embarque déjà le pack ([[howto-connectors-01-integrer-le-pack|CONNECTORS-01]])
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:2.0.0`, commit `f3a3e08`
(« chaque connecteur s'active à la demande »), fusionné dans `main` (`9e6d106`)
**Temps estimé :** 5 min par connecteur

---

## 1. Contexte

Jusqu'en 1.2.0, les quatre workers étaient toujours créés. Un connecteur sans clé renvoyait
`isHealthy() = false` en permanence et le superviseur du socle tentait de le redémarrer en boucle
(le README du pack signale en plus une `ClassCastException` à chaque tentative en socle 5.8.9).

La 2.0.0 inverse la règle : **un connecteur n'existe que si on l'allume**. Désactivé, son worker
n'est pas instancié : ni outils MCP, ni ligne au dashboard, ni supervision.

---

## 2. Architecture

```
socle.conn.<c>.enabled ─┬─ false (défaut) ──► aucun bean : worker, controller, auth absents
                        └─ true ──────────► @ConditionalOnProperty satisfait
                                             ├─ notion  : NotionWorker
                                             ├─ gdrive  : GdriveWorker + GoogleAuthService
                                             ├─ stripe  : StripeWorker + StripeWebhookController
                                             └─ hubspot : HubspotWorker

Toujours présents, quel que soit l'interrupteur :
  ConnectorsProperties · ConnectorsActivationReport · PackMigrationRunner · ConnectorLogger
  VaultCredentialResolver · ResilienceFactory · NotionClient · NotionDatabaseService · PropertyConverter
```

Chaque classe conditionnelle porte exactement :

```java
@ConditionalOnProperty(prefix = "socle.conn.notion", name = "enabled", havingValue = "true")
@Component
public class NotionWorker implements Worker, ActionProvider { … }
```

---

## 3. Étape 1 — Allumer

Par variable d'environnement (voie Hub) :

```bash
SOCLE_CONN_NOTION_ENABLED=true
SOCLE_CONN_GDRIVE_ENABLED=false
SOCLE_CONN_STRIPE_ENABLED=true
SOCLE_CONN_HUBSPOT_ENABLED=false
```

Ou dans l'`application.yml` de l'app :

```yaml
socle:
  conn:
    notion:  { enabled: true }
    stripe:  { enabled: true }      # amène aussi POST /api/webhooks/stripe
    gdrive:  { enabled: false }
    hubspot: { enabled: false }
```

`havingValue = "true"` : seule la chaîne `true` active. `yes`, `1`, `on` laissent le connecteur éteint.

---

## 4. Étape 2 — Donner la clé

L'interrupteur ne remplace pas la clé. Un connecteur activé sans clé est créé, mais :

- `isHealthy()` renvoie `false` (c'est `isConfigured()` pour les quatre workers) ;
- chaque action renvoie un échec explicite (`Notion API key missing`, `Stripe secret key missing`,
  `Google credentials not configured`, `HubSpot API key missing`).

| Connecteur | Variable obligatoire | Optionnelles |
|---|---|---|
| notion | `SOCLE_CONN_NOTION_API_KEY` | `SOCLE_CONN_NOTION_VERSION` (`2022-06-28`), `SOCLE_CONN_NOTION_RATE_LIMIT_RPS` (2) |
| gdrive | `SOCLE_CONN_GDRIVE_CREDENTIALS_JSON` | `SOCLE_CONN_GDRIVE_DELEGATED_USER`, `SOCLE_CONN_GDRIVE_RATE_LIMIT_RPS` (8) |
| stripe | `SOCLE_CONN_STRIPE_SECRET_KEY` | `SOCLE_CONN_STRIPE_WEBHOOK_SECRET`, `SOCLE_CONN_STRIPE_RATE_LIMIT_RPS` (80) |
| hubspot | `SOCLE_CONN_HUBSPOT_API_KEY` | `SOCLE_CONN_HUBSPOT_RATE_LIMIT_RPS` (8) |

---

## 5. Étape 3 — Utiliser un connecteur optionnel depuis le code de l'app

Un bean conditionnel injecté en dur fait échouer le démarrage quand le connecteur est éteint.
Passer par `ObjectProvider` :

```java
package eu.lmvi.monapp.billing;

import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.connectors.StripeWorker;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class BillingGateway {

    private final ObjectProvider<StripeWorker> stripe;

    public BillingGateway(ObjectProvider<StripeWorker> stripe) {
        this.stripe = stripe;
    }

    public boolean disponible() {
        StripeWorker w = stripe.getIfAvailable();
        return w != null && w.isConfigured();
    }

    public ActionResult creerClient(String email, String nom) {
        StripeWorker w = stripe.getIfAvailable();
        if (w == null) {
            return ActionResult.ofFailure("Connecteur Stripe désactivé (SOCLE_CONN_STRIPE_ENABLED)");
        }
        return w.executeAction("create_customer",
                ActionParameters.fromMap(Map.of("email", email, "name", nom)),
                ActionContext.internal("billing_gateway"));
    }
}
```

Les services Notion (`NotionClient`, `NotionDatabaseService`) n'ont **pas** d'interrupteur : une app
qui synchronise Notion depuis son code n'a pas besoin d'activer `notion_worker`
([[howto-connectors-05-notion-synchroniser-une-database|CONNECTORS-05]]).

---

## 6. Vérifier

```
[connectors] actifs : notion, stripe — inactifs : gdrive, hubspot (activer : socle.conn.<connecteur>.enabled=true)
[worker:notion_worker] initialized — configured=true
[worker:stripe_worker] initialized — configured=true
```

```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:8080/admin/actions | grep -o '"[a-z]*_worker"' | sort -u
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" -X POST \
  http://localhost:8080/admin/workers/stripe_worker/actions/get_status -d '{}'
# data : {"worker":"stripe_worker","configured":true,"total_calls":…}
```

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Aucune variable | `actifs : aucun` ; `GET /admin/workers/notion_worker/actions` → worker introuvable |
| 2 | `SOCLE_CONN_STRIPE_ENABLED=true` | `stripe_worker` **et** `POST /api/webhooks/stripe` existent |
| 3 | `SOCLE_CONN_GDRIVE_ENABLED=true` sans JSON | worker présent, `configured=false`, `test_connection` en échec explicite |
| 4 | `SOCLE_CONN_NOTION_ENABLED=yes` | Notion reste éteint |
| 5 | `mvn test -Dtest=ConnectorsActivationTest` dans le pack | 5 tests verts |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Activer sans clé | Worker rouge au dashboard, redémarrages du superviseur | Poser la clé, ou laisser le connecteur éteint |
| Injecter `StripeWorker` par constructeur | `NoSuchBeanDefinitionException` au démarrage quand Stripe est éteint | `ObjectProvider<StripeWorker>` |
| Valeur `1`/`yes` | Connecteur éteint malgré la variable | Écrire `true` |
| Chercher un interrupteur pour `NotionClient` | Il n'y en a pas : le client existe toujours | Normal ; seul le worker suit `enabled` |
| Croire que l'interrupteur coupe les migrations | `tr_connector_log` est créée même tout éteint | Comportement voulu : `PackMigrationRunner` n'est pas conditionnel |
| Lire la doc `docs/howto-01-integration.md` du pack | Elle décrit la 1.0.0 : « un provider non configuré : le worker est démarré » | Faux depuis 2.0.0 ; le README et le code font foi |

---

## 9. Pour aller plus loin

- [[howto-connectors-01-integrer-le-pack|CONNECTORS-01 — Intégrer le pack]]
- [[howto-connectors-03-gerer-les-identifiants|CONNECTORS-03 — Identifiants]]
- [[howto-04-mettre-a-jour-une-app|HOWTO 04 — Mettre à jour une app]]
