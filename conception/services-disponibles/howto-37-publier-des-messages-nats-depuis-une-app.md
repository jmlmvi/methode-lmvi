# HOWTO 37 — Publier des messages NATS depuis une application

**Niveau :** Confirmé
**Hub :** SocleHub 3.23.0
**Prérequis :** container `soclehub-nats` running ; clé APIM (`api:nats:*`) ou clé Hub selon la voie choisie
**Temps estimé :** 20 min

> Spec de référence : [SPEC-NATS-PUSH.md](../../nats/SPEC-NATS-PUSH.md)
> Côté consommateur : [[howto-38-consommer-des-messages-nats-depuis-une-app|HOWTO 38]]
> Administration des streams : [[howto-23-nats-streams|HOWTO 23]]

---

## 1. Contexte

Une application qui veut diffuser des événements vers d'autres applications du socle publie sur NATS
JetStream. Historiquement, chaque producteur gérait lui-même trois choses : le nom du stream, le nom
du sujet, et l'hypothèse que le stream existait déjà.

Ce HOWTO décrit la voie recommandée, où **ces trois points sont automatiques** : l'appelant désigne
un domaine, un canal et une cible ; le socle NATS du Hub dérive le sujet, le stream et la DLQ, et
provisionne ce qui manque.

Cas de référence : **APP-12-RssArchiver** diffuse ses articles vers `crm` et `sdr`.

> ⚠️ **`socle-pack-nats` n'existe pas.** La spec le prescrivait ; le composant a finalement été
> intégré à **TheSocleHub** (`eu.lmvi.soclehub.nats`), livré en 3.23.0. Une application ne peut donc
> pas l'embarquer par dépendance Maven : elle publie par **action MCP** ou par **HTTP via APIM**.
> Les §3 à §6 décrivent ces deux voies, en service aujourd'hui. Le §7 documente le fonctionnement
> **actuel** de RssArchiver, qui n'a pas encore migré.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Application productrice (ex. RssArchiver)                   │
│                                                              │
│   voie A — MCP/REST            voie B — HTTP/APIM            │
│   socle_publish(               POST /nats/v1/flows/          │
│     domain=rss,                       rss-sdr/publish        │
│     channel=diffusion,         { "payload": … }              │
│     target=sdr, payload)       (domain/channel/target        │
│                                 imposés par le flux)         │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  TheSocleHub — eu.lmvi.soclehub.nats                         │
│  1. dérive  sujet = rss.diffusion.sdr                        │
│             stream = RSS_DIFFUSION                           │
│  2. ensureStream() — crée si absent, ne modifie JAMAIS       │
│  3. js.publish() → PublishAck (stream + seq + duplicate)     │
│  4. échec → repli unique sur rss.diffusion.sdr.dlq           │
└────────────────────────┬─────────────────────────────────────┘
                         │ nats://soclehub-nats:4222
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  soclehub-nats — stream RSS_DIFFUSION                        │
│  subjects rss.diffusion.>  ·  Limits  ·  maxAge 7 j          │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Choisir sa voie

Aucune dépendance Maven à ajouter : le composant vit dans le Hub.

| | Voie A — MCP / REST | Voie B — HTTP / APIM |
|---|---|---|
| Pour qui | tout appelant pouvant joindre le Hub | producteur externe, hors `docker_soclehub-net` |
| Endpoint | `POST /api/actions/nats_worker/socle_publish` | `POST https://api.thesocle.net/nats/v1/flows/{flow}/publish` |
| Auth | clé Hub (`X-Api-Key`) | clé APIM `apim_<env>_<40hex>`, scope `api:nats:*` |
| Qui choisit le sujet | l'appelant, via `domain`/`channel`/`target` | **le serveur**, via le flux déclaré |
| Gouvernance | — | quotas, audit, refacturation, clé révocable |

**Aucun sujet, aucun nom de stream à saisir.** Ils sont dérivés :

| Élément | Formule | Résultat |
|---|---|---|
| Sujet | `<domain>.<channel>.<target>` | `rss.diffusion.sdr` |
| DLQ | `<sujet>.dlq` | `rss.diffusion.sdr.dlq` |
| Stream | `UPPER(<domain>_<channel>)` | `RSS_DIFFUSION` |

Pour la voie B, le flux se déclare côté Hub (`application.yml`) — c'est ce qui rend le sujet
non négociable par le client :

```yaml
socle:
  nats:
    flows:
      rss-sdr:
        domain: rss
        channel: diffusion
        target: sdr
        schema: sdr.article.multipart.v1
```

Réglages de provisionnement, côté Hub également :

```yaml
socle:
  nats:
    auto-provision: true   # false = création de streams réservée à l'exploitation
    max-age-days: 7
```

---

## 4. Étape 2 — Publier

**Voie A — action MCP/REST :**

```bash
curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/socle_publish \
  -d '{"domain":"rss","channel":"diffusion","target":"sdr",
       "payload":"{\"id\":94787,…}",
       "msg_id":"rss-article-94787",
       "schema":"sdr.article.multipart.v1",
       "tenant":"lmvi"}'
```

```json
{"subject":"rss.diffusion.sdr","stream":"RSS_DIFFUSION","seq":6247,
 "duplicate":false,"dlq":false,"status":"published"}
```

**Voie B — HTTP via APIM :**

```bash
curl -s -H "Authorization: Bearer $APIM_KEY" -H "Content-Type: application/json" \
  -X POST https://api.thesocle.net/nats/v1/flows/rss-sdr/publish \
  -d '{"payload":"{\"id\":94787,…}","msg_id":"rss-article-94787"}'
```

Le client ne fournit **ni** `domain`, **ni** `channel`, **ni** `target` : ils viennent du flux.
Envoyer un champ `subject` est refusé en `400`.

Trois points non négociables :

- **`js.publish()`, jamais `Connection.publish()`.** Le second (NATS core) ne retourne aucun
  `PublishAck` : un échec de persistance passe inaperçu et l'application croit avoir livré. C'est
  la correction centrale apportée par le socle NATS.
- **`msg_id` avec un identifiant métier stable.** Il devient le header `Nats-Msg-Id` et active la
  déduplication JetStream (fenêtre 2 min) : un rejeu du même message est ignoré côté serveur.
  Sans lui, la déduplication est désactivée et le Hub loggue un `WARN`.
- **Traiter `duplicate: true` comme un succès, pas comme un échec.** Cela signifie que le message
  était déjà persisté ; `seq` désigne alors l'original. Le republier serait inutile.

---

## 5. Étape 3 — Vérifier

```bash
# Le stream a-t-il été créé ?
curl -s -H "X-Api-Key: $HUB_KEY" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/get_stream_info \
  -d '{"stream_name":"RSS_DIFFUSION"}'
```

Attendu : `subjects: ["rss.diffusion.>"]`, `retention: limits`, `max_age_seconds: 604800`.

```bash
# Les messages arrivent-ils ?
curl -s -H "X-Api-Key: $HUB_KEY" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/peek_messages \
  -d '{"stream_name":"RSS_DIFFUSION","count":"5"}'
```

`peek_messages` lit **sans consommer** (consumer éphémère puis `nak()`). C'est un outil de
diagnostic : il ne fait pas avancer le curseur d'un consommateur et plafonne à 100 messages.

---

## 6. Étape 4 — Gérer les échecs

Le Hub tente le sujet principal, puis **une seule fois** la DLQ, puis remonte l'échec. La réponse
porte `dlq: true` quand le message a atterri en rebut : c'est un succès de transport, pas un succès
métier — à tracer comme tel.

```java
var r = publier(article, cible);          // action MCP ou HTTP
if (r.dlq()) {
    tracer(article.id(), cible, "dlq");   // à reprendre, le destinataire ne l'aura pas
} else {
    tracer(article.id(), cible, "delivered", r.seq());
}
```

Le socle **ne fait ni retry ni backoff** — invariant V005 : la résilience appartient au Worker
appelant, pas à la bibliothèque. La table de traçabilité (`tr_diffusion` chez RssArchiver) reste à la
charge de l'application.

> ⚠️ **Piège corrigé, à connaître si vous republiez vous-même en DLQ.** La DLQ est un sujet du
> **même** stream, donc soumise à la **même fenêtre de déduplication**. Une copie DLQ qui reprend le
> `Nats-Msg-Id` d'origine est vue comme un doublon : JetStream l'acquitte **sans la stocker**. Ack
> positif, log de succès, DLQ vide. Le Hub dérive donc l'identifiant en `<msg_id>.dlq`. Si vous
> écrivez votre propre repli, faites de même.

---

## 7. Fonctionnement actuel de RssArchiver (avant migration)

Ce qui tourne en production aujourd'hui, à connaître pour transmettre le dossier.

**Deux publieurs, un seul format.** Ils doivent produire exactement le même message, d'où la classe
commune `eu.lmvi.diffusion.ArticleEnvelope` :

| Publieur | Rôle |
|---|---|
| `RssDiffusionSinkHandler` | voie principale — publie en sortie de pipeline |
| `DiffusionWorker` | rattrapage périodique (`RSS_DIFFUSION_INTERVAL_MIN`, lots `RSS_DIFFUSION_BATCH`) |

⚠️ Piège : toute évolution de format doit être faite dans `ArticleEnvelope`, **jamais** dans l'un des
deux appelants.

**Routage par table.** `schema_rssarchiver.db_queue` (`x_active = true AND status = 'active'`) :

| x_partition | api_name | subject | dlq_subject | payload_format |
|---|---|---|---|---|
| lmvi | crm | `rss.diffusion.crm` | `rss.diffusion.crm.dlq` | *(flat)* |
| lmvi | sdr | `rss.diffusion.sdr` | `rss.diffusion.sdr.dlq` | `multipart` |

**Deux formats de payload :**

- `flat` — `{id, title, url, summary, datas}` : contrat historique de `crm`, **ne pas modifier**.
- `multipart` — enveloppe versionnée `sdr.article.multipart.v1` :

```json
{ "schema": "sdr.article.multipart.v1",
  "article_id": 94787,
  "published_at": "2026-07-20T18:44:55Z",
  "parts": { "article": {...}, "summary": {...}, "score": {"value": 78.0, "factors": {...}},
             "fivew1h": {...}, "kew": {...}, "translation": {...},
             "bibliographic": {...}, "primary_topic": "..." } }
```

Contrats : `article` et `score` toujours présents ; **une partie absente est omise, jamais `null`**
(pour distinguer « pas produit » de « produit vide ») ; `score.value` sur 0..100 ; dates ISO-8601 UTC.

**Idempotence** : `schema_rssarchiver.tr_diffusion` (`id_article` × `api_name`). 93 560 lignes en
`status='skipped'`, `cascade_level='backfill'` neutralisent l'historique — les consommateurs
démarrent au présent.

**Écart connu, TOUJOURS PRÉSENT au 2026-07-21** : les deux publieurs appellent
`Connection.publish(subject, payload)`, donc en NATS **core**, sans `PublishAck`. Les messages
atterrissent dans le stream parce que `rss.diffusion.>` les couvre, mais un échec JetStream serait
invisible — l'application marquerait `delivered` un message perdu.

La correction existe côté Hub depuis la 3.23.0 ; **RssArchiver n'a pas encore migré**. La migration
consiste à remplacer les deux `Connection.publish` par un appel `socle_publish` et à exploiter le
`seq` retourné (SPEC-NATS-PUSH §7).

---

## 8. Variante — producteur hors du réseau Docker

Si le producteur ne peut pas être sur `docker_soclehub-net` (autre VPS, minihub, poste de dev), le
port 4222 lui est inaccessible : il n'est pas publié sur l'hôte.

C'est la **voie B**, déjà publiée et en service :

```
POST https://api.thesocle.net/nats/v1/flows/{flow}/publish
Authorization: Bearer apim_<env>_<40hex>
```

**Impératif de conception, respecté :** le sujet est **imposé par l'API publiée**, jamais reçu du
client. Un endpoint acceptant un `subject` arbitraire donnerait au porteur de la clé le droit
d'écrire sur `audit.>` et d'y forger de faux événements. Ici un champ `subject` est rejeté en `400`.

Gain : clé révocable par consommateur, quotas, audit, refacturation — ce que le token NATS global,
unique et sans permission par sujet, ne permet pas.

> **Deux idées reçues, démenties par le code du Hub :**
> `provision_api` **ne redémarre pas le Hub** (activation à chaud par `catalog.reload()` ; seul un
> certificat ACME pour un hostname nouveau peut le secouer). Et **aucun module JDM/Janino n'est
> nécessaire** : le routage APIM est natif, les points de décision sont des politiques optionnelles.
>
> **Limite :** APIM ne vérifie qu'un seul `required_scope` par API publiée, et deux préfixes
> externes retomberaient sur le même contrôleur. Lecture et écriture ne sont donc **pas**
> cloisonnées — l'API `nats` porte `api:nats:*`.

---

## 9. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Supprimer le stream, redémarrer l'app | Stream recréé, `subjects=["rss.diffusion.>"]` |
| 2 | Publier un message | Log avec `stream` + `seq` non nuls |
| 3 | Publier deux fois le même `Nats-Msg-Id` en < 2 min | `messages` n'augmente que de 1 |
| 4 | Arrêter `soclehub-nats`, redémarrer l'app | L'app démarre ; publications en erreur explicite |
| 5 | Stream existant avec sujets divergents | Log `WARN`, stream **non modifié** |
| 6 | Forcer un échec, puis relire la DLQ | Le message **est présent** — pas seulement acquitté |
| 7 | Envoyer `{"subject":"audit.forge"}` sur la voie B | `400`, refus explicite |

Tests automatisés correspondants : `SocleNatsIntegrationTest` (12 tests contre un JetStream réel) et
`SocleNatsSubjectsTest` dans le dépôt `soclehub`.

```bash
docker run -d --rm --name nats-itest -p 14222:4222 nats:2-alpine -js
mvn test -Dtest=SocleNatsIntegrationTest
```

---

## 10. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `Connection.publish()` au lieu de `js.publish()` | Aucun `PublishAck` ; pertes silencieuses | Passer par `socle_publish` |
| **Copie DLQ avec le `Nats-Msg-Id` d'origine** | **Ack positif, DLQ vide : perte totale et silencieuse** | **Dériver `<msg_id>.dlq`** |
| Traiter `duplicate: true` comme un échec | Republication en boucle d'un message déjà persisté | C'est un succès ; `seq` désigne l'original |
| Publier sans `msg_id` | Aucune déduplication ; doublons au moindre rejeu | Toujours un identifiant métier stable |
| Attendre un pack Maven `socle-pack-nats` | Il n'existe pas | Action MCP ou HTTP/APIM |
| Conteneur hors `docker_soclehub-net` | `soclehub-nats` ne résout pas | Voie B (APIM), ou `--network docker_soclehub-net` |
| Croire que `peek_messages` consomme | Messages relus indéfiniment | C'est du diagnostic : pas d'ack, ≤ 100 messages |
| Modifier `ArticleEnvelope` dans un seul publieur | Formats divergents entre voie principale et rattrapage | Modifier `ArticleEnvelope`, jamais les appelants |
| Sujet en dur dans le code | Divergence avec la convention | Laisser le Hub dériver |

---

## 11. Pour aller plus loin

- [[howto-38-consommer-des-messages-nats-depuis-une-app|HOWTO 38]] — le côté consommateur
- [[howto-23-nats-streams|HOWTO 23]] — administration des streams
- [[howto-30-publier-une-api-apim|HOWTO 30]] — publier une API APIM
- [IMPLEMENTATION-TSH.md](../../nats/IMPLEMENTATION-TSH.md) — ce qui a réellement été livré, et pourquoi hors pack
