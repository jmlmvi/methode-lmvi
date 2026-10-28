# HOWTO COM-03 — Déclarer des types de notification et leurs gabarits

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-comm` **2.2.0** (branche `main`, commit `227fe5e`, tag `v2.2.0`, code identique à 2.1.0 — commit `ba69578` ; Spring Boot 4.1.2, socle 5.11.0, minimum 5.10.0) — comportement identique à 2.1.0, à 2.0.0 (socle 5.8.6-5.9.x, Boot 4.0.6) et à 1.1.0, dernière version Boot 3
**Vérifié au code le :** 2026-10-28 (comportement SQL rejoué en JDBC sur PostgreSQL 17 le même jour)
**Prérequis :** [[howto-com-01-integrer-le-pack|COM-01]]
**Temps estimé :** 20 min

---

## 1. Contexte

Un **type** de notification est une ligne de `z_notification_config` : canaux, fenêtre
anti-doublon, priorité par défaut, activation. Un **gabarit** est une ligne de
`z_notification_template` par `(type, canal, langue)` : sujet et corps avec des variables `{…}`.

Les deux sont **en base, dans le schéma de l'app**, et **mis en cache** au démarrage par
`NotificationConfigService` et `TemplateService`. Ce HOWTO décrit comment une app déclare ses
propres types sans casser ce cache, au modèle de **BingFetch** (`BINGFETCH_ALERTE`) et
**UniqPersonnality** (8 types `UNIQP_*`).

---

## 2. Architecture

```
z_notification_config  (x_partition, notification_type) UNIQUE
  notification_type │ channels (jsonb) │ throttle_minutes │ priority_default │ enabled │ x_active

z_notification_template (x_partition, notification_type, channel, language) UNIQUE
  subject_template (≤500) │ body_template (TEXT, NOT NULL) │ x_active

Résolution d'un gabarit — TemplateService.resolve(partition, type, canal, langue) :
  1. (partition, type, canal, langue)
  2. (NULL,      type, canal, langue)
  3. (partition, type, canal, "fr")
  4. (NULL,      type, canal, "fr")
  5. aucun → sujet = data.subject (ou le type), corps = data.body (ou "")

Résolution d'une config — NotificationConfigService.resolve(partition, type) :
  (partition, type) puis (NULL, type)
```

Seules les lignes `x_active = true` sont chargées.

---

## 3. Étape 1 — Déclarer un type au démarrage de l'app

La voie fiable : un `ApplicationRunner` qui insère **sans doublon** puis recharge le cache.
Code réel de BingFetch, généralisé :

```java
package eu.lmvi.monapp.notification;

import eu.lmvi.socle.pack.comm.notify.NotificationConfigService;
import eu.lmvi.socle.pack.comm.notify.TemplateService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@Order(20)
public class TypesDeNotification implements ApplicationRunner {

    static final String TYPE = "ORDER_SHIPPED";

    private final JdbcTemplate jdbc;
    private final NotificationConfigService config;
    private final TemplateService gabarits;

    public TypesDeNotification(JdbcTemplate jdbc, NotificationConfigService config, TemplateService gabarits) {
        this.jdbc = jdbc;
        this.config = config;
        this.gabarits = gabarits;
    }

    @Override
    public void run(ApplicationArguments args) {
        // NOT EXISTS, et non ON CONFLICT : x_partition est NULL, et NULL ≠ NULL pour un index unique.
        jdbc.update("""
                INSERT INTO z_notification_config (x_partition, x_createdBy, notification_type, channels,
                       throttle_minutes, priority_default, enabled, description)
                SELECT NULL, 'monapp', ?, '["EMAIL","SMS","IN_APP"]'::jsonb, 0, 'HIGH', true, 'Commande expédiée'
                 WHERE NOT EXISTS (SELECT 1 FROM z_notification_config
                                    WHERE x_partition IS NULL AND notification_type = ?)""",
                TYPE, TYPE);

        gabarit(TYPE, "EMAIL", "fr", "[{app_name}] Votre commande {order_id} est en route",
                "Bonjour {recipient_name},\n\nVotre commande n° {order_id} a été expédiée.\nSuivi : {tracking_url}\n\n— {app_name}");
        gabarit(TYPE, "SMS", "fr", null, "{app_name} : commande {order_id} expédiée. Suivi : {tracking_url}");
        gabarit(TYPE, "IN_APP", "fr", "Commande expédiée", "Commande n° {order_id} en route");

        config.reload();
        gabarits.reload();
    }

    private void gabarit(String type, String canal, String langue, String sujet, String corps) {
        jdbc.update("""
                INSERT INTO z_notification_template (x_partition, x_createdBy, notification_type, channel, language,
                       subject_template, body_template)
                SELECT NULL, 'monapp', ?, ?, ?, ?, ?
                 WHERE NOT EXISTS (SELECT 1 FROM z_notification_template
                                    WHERE x_partition IS NULL AND notification_type = ? AND channel = ? AND language = ?)""",
                type, canal, langue, sujet, corps, type, canal, langue);
    }
}
```

Le `JdbcTemplate` de l'app pointe sur le schéma de l'app (`search_path` / `currentSchema`) : les
noms de table se passent sans préfixe. Le `\n` d'un text block Java **est** un saut de ligne.

---

## 4. Étape 2 — Écrire un gabarit

Moteur : `eu.lmvi.socle.pack.comm.service.TemplateRenderer`.

| Syntaxe | Effet |
|---|---|
| `{order_id}` | valeur de `data.order_id` (motif `[a-zA-Z0-9_.]+`) |
| `{client.nom}` | clé imbriquée : `data.client` doit être une `Map` |
| variable absente | remplacée par une **chaîne vide**, sans erreur |
| `{{}` | produit `{}` littéral |

Variables toujours présentes : `{recipient}`, `{recipient_name}` (= `recipient` si non fourni),
`{app_name}` (= `socle.comm.app-name`), `{notification_type}`, `{priority}`, et `{x_partition}`
quand une partition est passée.

Aucun échappement HTML n'est appliqué : une valeur saisie par un utilisateur et insérée dans un
corps HTML doit être échappée par l'app avant l'appel.

Un corps est envoyé en HTML par le canal EMAIL dès qu'il **commence par `<`** ou contient
`<html`, `<p>` ou `<br` ; sinon en texte (COM-04).

---

## 5. Étape 3 — Modifier un type en exploitation

Par l'action `notify_worker__update_config` (`type` + `config: {channels, throttle_minutes,
priority_default, enabled}`), qui fait un upsert puis recharge le cache des configs :

```bash
curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"notify_worker__update_config",
        "arguments":{"type":"ORDER_SHIPPED",
                     "config":{"channels":["EMAIL","IN_APP"],"throttle_minutes":0,
                               "priority_default":"NORMAL","enabled":true}}}}'
```

⚠️ En mono-tenant (partition `NULL`), cet upsert **insère une nouvelle ligne à chaque appel** :
`ON CONFLICT (x_partition, notification_type)` ne se déclenche jamais sur `NULL`. Le cache garde
alors l'une des lignes, sans ordre garanti. Préférer un `UPDATE` SQL suivi d'un rechargement :

```sql
UPDATE schema_monapp.z_notification_config
   SET channels = '["EMAIL","IN_APP"]'::jsonb, throttle_minutes = 0
 WHERE x_partition IS NULL AND notification_type = 'ORDER_SHIPPED';
```

puis `NotificationConfigService.reload()` depuis l'app (aucune action MCP ne recharge, voir pièges).

Lecture : `notify_worker__get_config` avec `type`. Sans `type`, l'action rend un échec
« Listing all configs not implemented ».

---

## 6. Vérifier

```sql
-- Doublons sur partition NULL (doit rendre 0 ligne)
SELECT notification_type, count(*) FROM schema_monapp.z_notification_config
 WHERE x_partition IS NULL GROUP BY notification_type HAVING count(*) > 1;

-- Gabarits seedés par le pack : sauts de ligne réels ou « \n » littéraux ?
SELECT notification_type, channel, position(E'\\n' IN body_template) > 0 AS backslash_n_litteral
  FROM schema_monapp.z_notification_template;
```

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Redémarrer deux fois l'app | une seule ligne par type (`NOT EXISTS`) |
| 2 | `send_notification` avec `language:"en"` sans gabarit `en` | gabarit `fr` utilisé |
| 3 | Gabarit avec `{inconnu}` | remplacé par vide, envoi réussi |
| 4 | `get_config type=ORDER_SHIPPED` | canaux et priorité attendus |

Tests du pack : `TemplateRendererTest` (5 cas : simple, imbriqué, absent, échappement, vide).

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `ON CONFLICT` sur `x_partition` NULL | doublons de config/gabarit, résolution aléatoire | `INSERT … WHERE NOT EXISTS (… x_partition IS NULL …)` |
| `update_config` en mono-tenant | une ligne de plus à chaque appel | `UPDATE` SQL + `reload()` |
| Gabarits seedés par V999 | les courriels montrent `\n` en clair : le SQL écrit `'…\n…'` sans `E''`, PostgreSQL stocke backslash + `n` (vérifié : `length('a\nb') = 4`) | réécrire les gabarits utilisés avec de vrais sauts de ligne (text block Java, ou `E'…'` en SQL) |
| Gabarit ajouté en SQL à chaud | jamais utilisé | `TemplateService.reload()` ; l'action `reload_config` du README n'existe pas, et `update_config` ne recharge que les configs |
| `get_config` sans `type` | échec « not implemented » | toujours passer `type` |
| Valeur utilisateur dans un corps HTML | injection HTML dans le courriel | échapper avant l'appel |
| Sujet > 500 caractères | échec d'insertion au journal (colonne `subject VARCHAR(500)`) | tronquer le sujet |
| `notification_type` > 50 caractères | échec d'insertion (`VARCHAR(50)`) | noms courts, préfixés de l'app |

---

## 9. Pour aller plus loin

- [[howto-com-02-envoyer-une-notification-multicanal|COM-02 — Envoyer une notification]]
- [[howto-com-04-envoyer-des-courriels-smtp-brevo-hub|COM-04 — Courriels]]
- [[howto-com-05-journal-rejeu-et-anti-doublon|COM-05 — Journal et anti-doublon]]
