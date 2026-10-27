# HOWTO 23 — Administrer NATS JetStream depuis le Hub

**Niveau :** Senior
**Hub :** SocleHub 3.12.1
**Prérequis :** container `soclehub-nats` running, `NATS_URL` configuré dans `.env`, accès admin au Hub
**Temps estimé :** 30 min (découverte) à 2 h (création de pipelines complexes)

> Référence framework : [[53-nats-worker|NatsWorker + NatsProvisionWorker]] — `NatsProvisionWorker` (priorité 32) crée les streams natifs en `initialize()`, `NatsWorker` (priorité 33) expose **12 actions** d'administration. Le bean `natsConnection` (`NatsConfiguration`) est `@Nullable` : si NATS est down au boot, les workers partent en mode dégradé. Voir aussi [[46-clamav-scanguard|ClamAvWorker]] (producteur `notify.alert.virus`) et [[10-iam-worker|IamWorker]] (producteur `audit.iam.*`).

---

## 1. Contexte

Le Hub utilise NATS JetStream comme bus d'événements asynchrone à persistance configurable. JetStream est embarqué dans NATS Server 2.x ; chaque message est routé vers un *stream* par sujet (subject pattern), conservé selon la *retention policy* (limits, workqueue, interest), puis consommé par 0..N *consumers* (push ou pull).

Au démarrage du Hub, `NatsProvisionWorker` (priority 32) crée 5 streams obligatoires :

| Stream | Subjects | Retention | Max age | Usage |
|---|---|---|---|---|
| `MAIL_SCAN` | `mail.scan.>` | WorkQueue | 7 j | Demandes scan antivirus différé |
| `MAIL_EVENTS` | `mail.events.>` | Limits | 30 j | Audit envois/réceptions James |
| `APP_EVENTS` | `app.events.>` | Limits | 30 j | Lifecycle apps : install/start/stop/uninstall |
| `AUDIT` | `audit.>` | Limits | 90 j | Log d'audit IAM (login, role change, etc.) |
| `NOTIFICATIONS` | `notify.>` | WorkQueue | 7 j | Alertes utilisateurs (virus, quota, cert expiry) |

`NatsWorker` (priority 33) expose 12 actions MCP/REST pour l'administration : créer/lister/purger/supprimer un stream, peek/get/delete un message, lister les consumers, publier, et obtenir les infos compte. Ce HOWTO couvre les opérations courantes.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                       SocleHub Hub (port 443)                          │
│                                                                        │
│   ┌────────────────────────┐         ┌─────────────────────────────┐  │
│   │ NatsProvisionWorker    │ ──init─►│  soclehub-nats:4222         │  │
│   │ (priority 32, PASSIVE) │         │  (NATS server + JetStream)  │  │
│   │ Creates 5 core streams │         │  --js --store_dir /data     │  │
│   └────────────────────────┘         └────────┬────────────────────┘  │
│                                                │                       │
│   ┌────────────────────────┐                   ▼                       │
│   │ NatsWorker             │       Streams                             │
│   │ (priority 33, PASSIVE) │       ├─ MAIL_SCAN       (WQ, 7 j)         │
│   │ 12 admin actions       │       ├─ MAIL_EVENTS     (Limits, 30 j)   │
│   │ via MCP/REST           │       ├─ APP_EVENTS      (Limits, 30 j)   │
│   └─────────┬──────────────┘       ├─ AUDIT           (Limits, 90 j)   │
│             │                       └─ NOTIFICATIONS   (WQ, 7 j)        │
│             ▼                                                          │
│        admins / scripts                                                │
│                                                                        │
│   Producers : MailAttachmentWorker (notify.alert.virus),               │
│               IamWorker (audit.iam.login),                             │
│               DockerWorker (app.events.lifecycle), etc.                │
│                                                                        │
│   Consumers : à créer selon besoins métier (UI notif, exporters,…)     │
└────────────────────────────────────────────────────────────────────────┘
```

Vocabulaire :
- **Subject** = sujet pub/sub, hiérarchie `.` (ex. `app.events.lifecycle`).
- **Stream** = persistance de N subjects, paramétrable.
- **Consumer** = abonnement persistant, conserve un offset.
- **Retention WorkQueue** = supprimé après ack du 1er consumer (file de tâches).
- **Retention Limits** = conservé jusqu'à `max_age` ou `max_msgs` (audit).

---

## 3. Étape 1 — Vérifier l'état NATS

```bash
# 1. Status global
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/get_status \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Attendu :
# {
#   "data": {
#     "connected": true,
#     "server_id": "NDXxxx",
#     "server_name": "soclehub-nats",
#     "version": "2.10.x",
#     "url": "nats://localhost:4222"
#   }
# }

# 2. Lister tous les streams
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/list_streams \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Attendu : 5 streams (MAIL_SCAN, MAIL_EVENTS, APP_EVENTS, AUDIT, NOTIFICATIONS)
# Format :
# {
#   "data": {
#     "count": 5,
#     "streams": [
#       { "name": "AUDIT", "subjects": ["audit.>"], "messages": 14823,
#         "bytes": 4287562, "consumers": 0, "max_age_days": 90 }
#     ]
#   }
# }

# 3. Account info (limites JetStream)
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/get_account_info \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Attendu :
# {
#   "data": {
#     "memory_used": 0,
#     "storage_used": 5142183,
#     "streams_count": 5,
#     "consumers_count": 0,
#     "limits": { "max_memory": -1, "max_storage": -1, "max_streams": -1 }
#   }
# }
```

---

## 4. Étape 2 — Créer un nouveau stream métier

Cas d'école : créer un stream `BILLING_EVENTS` pour un module facturation, retention 365 j.

```bash
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/create_stream \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stream_name": "BILLING_EVENTS",
    "subjects": "billing.>",
    "max_age_days": "365"
  }'

# Réponse :
# {
#   "data": {
#     "stream_name": "BILLING_EVENTS",
#     "subjects": ["billing.>"],
#     "retention": "Limits",
#     "max_age_days": 365,
#     "created": true
#   }
# }
```

Plusieurs subjects (séparés par virgule) :

```bash
curl ... create_stream -d '{
  "stream_name": "ORDERS",
  "subjects": "orders.created,orders.updated,orders.cancelled",
  "max_age_days": "30"
}'
```

**Points clés :**

- Le worker NATS expose `RetentionPolicy.Limits` par défaut. Pour WorkQueue, modifier le worker (action `create_stream` ne supporte pas le choix actuellement).
- `subjects` accepte des wildcards : `billing.*` (1 token), `billing.>` (≥1 token).

---

## 5. Étape 3 — Publier un message

```bash
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/publish_message \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "billing.invoice.created",
    "payload": "{\"invoice_id\":\"INV-2026-0042\",\"amount_eur\":1850.00,\"customer\":\"alice@thesocle.net\"}"
  }'

# Réponse :
# { "data": { "subject": "billing.invoice.created", "stream": "BILLING_EVENTS", "seq": 1, "duplicate": false } }
```

Le `seq` est le numéro de séquence absolu dans le stream — utile pour relire un message précis.

---

## 6. Étape 4 — Lire les messages (peek)

`peek_messages` lit les N derniers messages du stream **sans les consommer** (pas d'ack). Pratique pour debug.

```bash
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/peek_messages \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "BILLING_EVENTS", "count": "10" }' | jq

# Réponse :
# {
#   "data": {
#     "stream": "BILLING_EVENTS",
#     "count": 1,
#     "messages": [
#       {
#         "seq": 1,
#         "subject": "billing.invoice.created",
#         "data": "{\"invoice_id\":\"INV-2026-0042\",...}",
#         "timestamp": "2026-04-28T09:15:32Z"
#       }
#     ]
#   }
# }
```

Récupérer un message précis par séquence :

```bash
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/get_message \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "AUDIT", "seq": "12000" }' | jq
```

---

## 7. Étape 5 — Lister les consumers d'un stream

```bash
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/list_consumers \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "NOTIFICATIONS" }' | jq

# Réponse type :
# {
#   "data": {
#     "stream": "NOTIFICATIONS",
#     "count": 2,
#     "consumers": [
#       {
#         "name": "ui-notifier",
#         "filter_subject": "notify.alert.>",
#         "delivered": 142,
#         "ack_pending": 3,
#         "num_pending": 0,
#         "durable": true
#       }
#     ]
#   }
# }
```

`num_pending > 0` indique des messages non encore livrés au consumer (lag).

---

## 8. Étape 6 — Cas d'usage : audit log

Le stream `AUDIT` reçoit toutes les actions sensibles IAM. Pour exploiter :

### 8.1 Producteurs (côté Hub, automatique)

`IamWorker` publie sur `audit.iam.<event>` :
- `audit.iam.login.success`
- `audit.iam.login.failed`
- `audit.iam.user.created`
- `audit.iam.role.assigned`
- `audit.iam.api_key.revoked`

Format payload JSON :

```json
{
  "event": "user.created",
  "actor_email": "admin@thesocle.net",
  "target_email": "bob@thesocle.net",
  "ip": "203.0.113.42",
  "user_agent": "curl/8.0",
  "timestamp": "2026-04-28T10:42:11Z"
}
```

### 8.2 Consumer custom (export SIEM)

Pour exporter vers un SIEM externe, créer un script Python qui pull en boucle :

```python
#!/usr/bin/env python3
import asyncio
import json
from nats.aio.client import Client as NATS

async def main():
    nc = NATS()
    await nc.connect("nats://soclehub-nats:4222")
    js = nc.jetstream()

    # Pull consumer durable
    sub = await js.pull_subscribe("audit.>", "siem-exporter", stream="AUDIT")

    while True:
        try:
            msgs = await sub.fetch(batch=10, timeout=5)
            for m in msgs:
                payload = json.loads(m.data.decode())
                print(f"[AUDIT] {payload['timestamp']} {payload['event']} actor={payload['actor_email']}")
                # POST to SIEM here
                await m.ack()
        except asyncio.TimeoutError:
            continue

asyncio.run(main())
```

### 8.3 Requêtes ad hoc

```bash
# Tous les login échoués des dernières 24h
curl ... peek_messages -d '{"stream_name":"AUDIT","count":"100"}' \
  | jq '.data.messages[] | select(.subject=="audit.iam.login.failed") | .data | fromjson'
```

---

## 9. Étape 7 — Cas d'usage : notification dispatch

Architecture : `MailAttachmentWorker` publie sur `notify.alert.virus`, un worker frontend consomme le stream et pousse en WebSocket vers le portail de l'utilisateur connecté.

```bash
# 1. Vérifier le stream NOTIFICATIONS
curl ... peek_messages -d '{"stream_name":"NOTIFICATIONS","count":"5"}' | jq

# 2. Tester en publiant manuellement
curl ... publish_message -d '{
  "subject": "notify.user.alice@thesocle.net",
  "payload": "{\"type\":\"info\",\"title\":\"Test\",\"body\":\"Notification de test\"}"
}'

# 3. Côté UI : créer un consumer push WebSocket
#    (à implémenter dans un nouveau worker NotificationDispatchWorker)
```

---

## 10. Étape 8 — Purger ou supprimer

```bash
# Purger (vide le contenu, garde le stream)
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/purge_stream \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "BILLING_EVENTS" }'

# Réponse : { "data": { "stream": "BILLING_EVENTS", "purged": 1042 } }

# Supprimer un message précis (rare, RGPD oubli)
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/delete_message \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "AUDIT", "seq": "98765" }'

# Supprimer le stream entièrement (PERTE DE DONNÉES)
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/delete_stream \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "TEMP_STREAM" }'
```

---

## 11. Étape 9 — Détail d'un stream

```bash
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/get_stream_info \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "AUDIT" }' | jq

# Réponse :
# {
#   "data": {
#     "name": "AUDIT",
#     "config": {
#       "subjects": ["audit.>"],
#       "retention": "Limits",
#       "max_age_seconds": 7776000,
#       "max_msgs": -1,
#       "max_bytes": -1,
#       "storage": "File"
#     },
#     "state": {
#       "messages": 14823,
#       "bytes": 4287562,
#       "first_seq": 1,
#       "last_seq": 14823,
#       "consumer_count": 1
#     }
#   }
# }
```

---

## 12. Validation

```bash
# 1. Les 5 streams natifs sont créés au boot
docker logs soclehub --tail=500 2>&1 | grep "step:provision"
# Attendu : 5 lignes "Created stream X" ou "Stream X already exists"

# 2. Test cycle complet : publish → peek → delete
SUBJECT="test.howto23.$(date +%s)"
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/create_stream \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{"stream_name":"TEST_HOWTO","subjects":"test.>","max_age_days":"1"}'

curl -sk -X POST https://thesocle.net/api/actions/nats_worker/publish_message \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d "{\"subject\":\"$SUBJECT\",\"payload\":\"hello\"}"

curl -sk -X POST https://thesocle.net/api/actions/nats_worker/peek_messages \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{"stream_name":"TEST_HOWTO","count":"1"}' | jq '.data.messages[0].data'
# Attendu : "hello"

curl -sk -X POST https://thesocle.net/api/actions/nats_worker/delete_stream \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{"stream_name":"TEST_HOWTO"}'
```

---

## 13. Pièges courants

### Piège 1 — `create_stream` retourne « stream subjects overlap »

**Cause :** un stream existant utilise déjà un subject matchant. NATS impose des subjects uniques par stream.
**Résolution :**

```bash
# Identifier le conflit
curl ... list_streams | jq '.data.streams[] | {name, subjects}'

# Choisir un subject pattern non-overlap : préfixer avec un namespace
# INCORRECT : créer un stream "BILLING" avec subject "events.>"
#             alors que MAIL_EVENTS contient déjà "mail.events.>"
# CORRECT : "billing.>" ou "myapp.events.>"
```

### Piège 2 — Messages disparaissent du stream WorkQueue

**Cause :** retention `WorkQueue` supprime le message dès qu'**un** consumer ack. Si vous avez 2 consumers durables qui veulent chacun le message, switcher en `Limits`.
**Résolution :** soit changer la retention (delete + recreate), soit créer un seul consumer fan-out qui dispatch en RAM.

### Piège 3 — `publish_message` succès mais `peek_messages` retourne 0

**Cause :** le subject publié ne match aucun stream — NATS Core (non-JetStream) accepte la publi mais elle n'est pas persistée.
**Résolution :** vérifier qu'un stream couvre le subject :

```bash
# Pour subject "myapp.foo", il faut un stream avec subject "myapp.foo" ou "myapp.>"
curl ... list_streams | jq '.data.streams[] | select(.subjects[] | contains("myapp"))'
```

### Piège 4 — Stream sature le disque (`storage_used` proche limit)

**Cause :** `max_age_days` trop élevé ou aucune limite max_bytes.
**Résolution :** purge ou recréer avec limits :

```bash
# Pour ajuster max_age sans recréer, utiliser nats-cli (pas exposé via worker)
docker exec soclehub-nats nats stream update AUDIT --max-age=30d
```

### Piège 5 — Consumer durable disparaît après restart NATS

**Cause :** consumer créé avec `MemoryStorage` au lieu de `FileStorage`.
**Résolution :** toujours créer durable + file storage côté client :

```python
# CORRECT
sub = await js.pull_subscribe("audit.>", "myconsumer", stream="AUDIT",
                               config=ConsumerConfig(durable_name="myconsumer",
                                                     ack_policy="explicit"))
```

### Piège 6 — `ack_pending` qui ne descend jamais à 0

**Cause :** le consumer crash après réception, n'envoie pas `m.ack()`. Les messages sont redelivrés indéfiniment.
**Résolution :** vérifier le code consumer, ajouter try/except autour du traitement :

```python
async for msg in messages:
    try:
        process(msg)
        await msg.ack()
    except Exception:
        await msg.nak()  # négatif ack — redelivery
```

### Piège 7 — `purge_stream` détruit aussi les messages des consumers en cours

**Cause :** purge = `DELETE all messages`, indépendamment des acks. Les consumers verront `num_pending = 0` brusquement.
**Résolution :** ne jamais purger un stream actif sans coordonner avec les consumers.

### Piège 8 — `NATS connection is null` au boot du Hub

**Cause :** `soclehub-nats` n'écoute pas encore quand le Hub démarre. `NatsConfiguration` retourne `@Nullable` → tous les workers NATS partent en mode dégradé.
**Résolution :** ajouter `depends_on: [soclehub-nats]` + healthcheck dans docker-compose. Si déjà fait : `docker compose restart soclehub`.

### Piège 9 — `delete_message` retourne 200 mais `seq` reste lisible

**Cause :** la suppression est asynchrone côté store JetStream. Le sequence n'est pas réutilisé mais l'état met quelques secondes à se propager.
**Résolution :** attendre 1 s, retry. Pour suppression définitive (RGPD), purger le stream entier.

### Piège 10 — Messages > 1 MB rejetés par NATS

**Cause :** `max_payload` NATS par défaut = 1 MB. Au-dessus, `publish` retourne `Maximum Payload Exceeded`.
**Résolution :** augmenter dans `nats-server.conf` :

```conf
max_payload: 8MB
```

Et `docker restart soclehub-nats`. Pour des payloads > 8 MB, stocker en MinIO et publier seulement la référence.

---

## 14. Pour aller plus loin

- Voir [[53-nats-worker|fiche NatsWorker]] pour les 12 actions `nats_worker/*` et le détail des streams natifs
- Voir `howto-21-clamav-mail-scan.md` §9 (consommation `notify.alert.virus`)
- Doc NATS : https://docs.nats.io/nats-concepts/jetstream
- Source `eu.lmvi.soclehub.worker.NatsWorker` et `NatsProvisionWorker`
