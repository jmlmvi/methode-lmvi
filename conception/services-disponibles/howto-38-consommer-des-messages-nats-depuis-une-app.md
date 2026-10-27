# HOWTO 38 — Consommer des messages NATS depuis une application

**Niveau :** Confirmé
**Hub :** SocleHub 3.23.0
**Prérequis :** container `soclehub-nats` running ; clé APIM (`api:nats:*`) ou clé Hub ; un producteur alimentant le flux
**Temps estimé :** 45 min

> Spec de référence : [SPEC-NATS-GET.md](../../nats/SPEC-NATS-GET.md)
> Côté producteur : [[howto-37-publier-des-messages-nats-depuis-une-app|HOWTO 37]]
> Administration des streams : [[howto-23-nats-streams|HOWTO 23]]

---

## 1. Contexte

Une application qui doit recevoir un flux d'événements crée un **consumer durable** sur un stream
JetStream. « Durable » est le mot important : c'est ce qui permet de reprendre exactement là où on
s'était arrêté après un redémarrage.

Ce HOWTO décrit la voie recommandée, où stream, sujet et consumer sont **dérivés et provisionnés
automatiquement** par le socle NATS du Hub.

Cas de référence : **APP-18-SDR** consomme les articles diffusés par RssArchiver sur
`rss.diffusion.sdr`.

> ⚠️ **`socle-pack-nats` n'existe pas.** Le composant a été intégré à **TheSocleHub**
> (`eu.lmvi.soclehub.nats`), livré en 3.23.0 : on consomme par **action MCP** ou par **HTTP via
> APIM**, pas par dépendance Maven.
>
> ⚠️ **SDR n'a toujours aucun code de consommation** (pas de `io.nats:jnats` au `pom.xml`). Le
> backlog qui lui est destiné sur `rss.diffusion.sdr` continue d'expirer au fil des 7 jours de
> rétention. C'est le travail qui reste à faire.

> ⚠️ **Correction de documentation** — `APP-18-SDR/contexteSDR260720.md` mentionne un sujet
> `sdr.articles`. C'est **faux**. Le sujet réel est `rss.diffusion.sdr`, dans le stream
> `RSS_DIFFUSION`.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  soclehub-nats — stream RSS_DIFFUSION                        │
│  subjects rss.diffusion.>  ·  Limits  ·  maxAge 7 j          │
│                                                              │
│   durable sdr_rss_diffusion          ──▶ rss.diffusion.sdr   │
│   durable supervision_rss_diffusion  ──▶ rss.diffusion.sdr   │
│        même cible, curseurs indépendants  = FAN-OUT          │
│   durable crm_rss_diffusion          ──▶ rss.diffusion.crm   │
└────────────────────────┬─────────────────────────────────────┘
                         │ pull — fetch(50, 2s)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Application consommatrice (ex. SDR)                         │
│                                                              │
│  domain: rss · channel: diffusion                            │
│  target: sdr   (ce qu'on lit)                                │
│  consumer: sdr (qui lit — porte le curseur)                  │
│                                                              │
│  ┌────────────────────────────────────────────┐              │
│  │ 1. ensureStream()   — crée si absent       │              │
│  │ 2. ensureConsumer() — crée si absent,      │              │
│  │                       sinon curseur gardé  │              │
│  │ 3. fetch → traiter → ack()                 │              │
│  └────────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Comprendre `target` et `consumer`

Aucune dépendance Maven : le composant vit dans le Hub. Mais il y a **deux identifiants distincts**,
et les confondre est l'erreur qui a coûté une révision de spec.

| Entrée | Répond à | Détermine |
|---|---|---|
| `target` | « qu'est-ce que j'écoute ? » | le sujet : `<domain>.<channel>.<target>` |
| `consumer` | « qui suis-je ? » | le durable, donc **mon curseur** |

| Élément | Formule | Résultat |
|---|---|---|
| Stream | `UPPER(<domain>_<channel>)` | `RSS_DIFFUSION` |
| Sujet écouté | `<domain>.<channel>.<target>` — **la cible** | `rss.diffusion.sdr` |
| Durable | `<consumer>_<domain>_<channel>` — **l'identité** | `sdr_rss_diffusion`, `supervision_rss_diffusion`… |
| DLQ | `<sujet>.dlq` | `rss.diffusion.sdr.dlq` |

Sans `target`, il vaut `consumer` — le comportement d'origine.

> 🔒 **Le `consumer` ne doit jamais venir de la requête d'un client.** Il détermine le curseur : un
> appelant libre de le nommer peut nommer *celui d'un autre* et faire avancer sa position. Les
> messages ainsi acquittés deviennent invisibles à leur véritable destinataire, sans erreur ni
> trace. Sur la voie APIM, l'identité est prise dans `X-APIM-Tenant-Id`, que `ApimFilter` supprime
> des requêtes entrantes avant de le poser lui-même — il n'est pas forgeable.

Configuration du flux, côté Hub :

```yaml
socle:
  nats:
    ack-wait-seconds: 60   # DOIT rester > au timeout de fetch (voir §11)
    max-deliver: 5
    flows:
      rss-sdr:
        domain: rss
        channel: diffusion
        target: sdr        # ce qu'on écoute
        consumer: sdr      # identité par défaut hors APIM
```

---

## 4. Étape 2 — Consommer

**Voie A — action MCP/REST.** Le Worker consommateur appelle le Hub :

```bash
# 1. récupérer un lot (messages NON ackés)
curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/socle_consume \
  -d '{"domain":"rss","channel":"diffusion","consumer":"sdr","target":"sdr",
       "max":"50","timeout_seconds":"2"}'

# 2. accuser réception APRÈS traitement
curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/socle_ack \
  -d '{"ack_token":"$JS.ACK.RSS_DIFFUSION.sdr_rss_diffusion.1.6084.…","type":"ack"}'
```

Chaque message porte son `ack_token` — le sujet `$JS.ACK.…` de JetStream, renvoyé tel quel.
**Aucun état n'est conservé côté Hub** : rien à perdre s'il redémarre.

**Voie B — HTTP via APIM**, pour un consommateur hors du réseau Docker :

```
GET  https://api.thesocle.net/nats/v1/flows/rss-sdr/messages?max=50
POST https://api.thesocle.net/nats/v1/flows/rss-sdr/ack   { "ack_tokens": [...] }
```

Le squelette du Worker, côté application :

```java
@Component
public class RssNatsSubscriber extends AbstractEventDrivenWorker {

    @Override
    public void doWork() {
        for (var m : hub.socleConsume("rss", "diffusion", "sdr", "sdr", 50)) {
            try {
                service.ingest(m.payload());          // idempotent sur article_id
                hub.socleAck(m.ackToken(), "ack");    // APRÈS traitement
            } catch (TransientException e) {
                hub.socleAck(m.ackToken(), "nak", 30);   // réessayer plus tard
            } catch (InvalidPayloadException e) {
                hub.socleAck(m.ackToken(), "term");       // abandon définitif → DLQ
            }
        }
    }
}
```

Invariants V005 à respecter : appel **borné** — jamais `while(true)`, jamais `new Thread()`, jamais
`@Scheduled` ; `kvBus.sub()` uniquement dans `initialize()` ; aucun `throws Exception` sur les
méthodes de l'interface `Worker`.

Un message ayant atteint `maxDeliver` n'est **pas** retourné : le Hub l'envoie en DLQ et le termine,
ce qui casse la boucle de redélivrance sans que l'appelant s'en occupe.

---

## 5. Étape 3 — Comprendre l'ack

C'est le point le plus souvent mal compris.

**L'ack fait avancer le curseur du consumer, il ne vide pas la queue.** Le stream est en rétention
`Limits` (pas `WorkQueue`) : les messages restent 7 jours, ackés ou non. Chaque consommateur a son
propre curseur et ne gêne pas les autres.

**Acker après traitement, jamais avant.** Un ack anticipé transforme le moindre crash en perte
définitive.

**Trois issues possibles, jamais le silence :**

| Situation | Appel | Effet |
|---|---|---|
| Traitement réussi | `ack()` | Curseur avance |
| Panne transitoire (dépendance down) | `nak(delay)` | Redélivrance après `delay` |
| Message empoisonné (payload illisible) | `term()` | Abandon définitif, pas de boucle |

Ne rien appeler = redélivrance après `ackWait` (**60 s**), jusqu'à `maxDeliver` (5), puis DLQ. C'est
un filet de sécurité, pas une stratégie : le Hub loggue en `WARN` tout message atteignant la limite.

**JetStream garantit at-least-once, jamais exactly-once.** Un message *sera* redélivré un jour. Le
consommateur **doit** être idempotent : clé métier stable (`article_id`) + contrainte d'unicité en
base.

---

## 6. Étape 4 — Plusieurs consommateurs

Deux mécanismes à ne pas confondre. Ce qui les distingue tient en une ligne : **c'est `target` qui
dit ce qu'on lit, et `consumer` qui dit qui lit.**

| Besoin | Réglage | Effet |
|---|---|---|
| **Fan-out** — N applications reçoivent chacune tout | même `target`, `consumer` **distincts** | chaque message livré à chacune, ack indépendants |
| **Scale-out** — N instances se partagent la charge | même `target` **et** même `consumer` | chaque message livré à **une seule** instance |

Deux conteneurs SDR avec la même configuration partagent `sdr_rss_diffusion` : **scaler fonctionne
sans rien configurer**. Un superviseur qui veut observer le même flux prend `target=sdr` mais
`consumer=supervision` : il obtient `supervision_rss_diffusion`, son propre curseur, et ne prend
aucun message à SDR.

> ⚠️ **Ce que la première version de la spec affirmait était faux.** Elle promettait le fan-out par
> « durables distincts » seuls — alors que le sujet écouté était lui aussi dérivé du nom du
> consommateur. Une seconde application n'écoutait donc pas le même sujet : elle n'écoutait rien.
> Constaté en live : un `consumer=probe` retournait **0 message** quand `rss.diffusion.sdr` en
> contenait plus de 6000.

> 🔒 **Corollaire opérationnel.** On ne peut pas inspecter un flux « comme si on était son
> destinataire » sans hériter de son curseur. Pour regarder `rss.diffusion.sdr` sans perturber SDR :
> garder `target=sdr` et prendre un `consumer` à soi. Utiliser `consumer=sdr` créerait le durable
> que SDR utilisera, et le moindre `ack` de test lui rendrait des messages **définitivement
> invisibles**.

---

## 7. Étape 5 — Vérifier

```bash
# Le durable existe-t-il ?
curl -s -H "X-Api-Key: $HUB_KEY" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/list_consumers \
  -d '{"stream_name":"RSS_DIFFUSION"}'
```

Attendu : `sdr_rss_diffusion` avec `num_pending` qui décroît à mesure du traitement.

```bash
# Que contient la DLQ ?
curl -s -H "X-Api-Key: $HUB_KEY" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/peek_messages \
  -d '{"stream_name":"RSS_DIFFUSION","count":"20"}'
```

⚠️ La DLQ vit dans le même stream et subit donc la **même rétention de 7 jours**. Sans surveillance,
les échecs s'effacent d'eux-mêmes. À brancher sur la supervision.

---

## 8. Étape 6 — Le format reçu

Enveloppe `sdr.article.multipart.v1` :

```json
{ "schema": "sdr.article.multipart.v1",
  "article_id": 94787,
  "published_at": "2026-07-20T18:44:55Z",
  "parts": { "article": {...}, "summary": {...}, "score": {"value": 78.0, "factors": {...}},
             "fivew1h": {...}, "kew": {...}, "translation": {...},
             "bibliographic": {...}, "primary_topic": "..." } }
```

Règles de lecture :

- `article` et `score` sont **toujours** présents ;
- **une partie absente est omise, jamais `null`** — c'est ce qui permet de distinguer « pas produit »
  de « produit vide ». Ne pas traiter l'absence comme une valeur vide ;
- `score.value` sur 0..100 ;
- dates ISO-8601 UTC ;
- `article_id` est la clé d'idempotence.

Le format est **versionné** : tout changement cassant donnera `…v2`. Le consommateur doit vérifier
`schema` et rejeter (`term()`) une version inconnue plutôt que de deviner.

---

## 9. Variante — consommateur hors du réseau Docker

Si l'application ne peut pas être sur `docker_soclehub-net`, le port 4222 lui est inaccessible.

APIM ne sait pas proxifier NATS : c'est une passerelle **HTTP**
(`target_backend_type` ∈ {`hub_container`, `minihub_container`}). Il faut exposer une **API HTTP de
consommation** adossée au durable :

```
GET  /<slug>/v1/messages?max=50   → { messages: [ { seq, headers, payload, ack_token } ] }
POST /<slug>/v1/ack               → { ack_tokens: [...] }
```

L'`ack_token` est le `replyTo` JetStream (`$JS.ACK.…`) renvoyé tel quel : l'ack consiste à publier
dessus. Aucun état côté serveur, rien à perdre au redémarrage du Hub. `ackWait` est porté à **60 s**
pour absorber la latence HTTP.

Le `target` vient du flux déclaré, le `consumer` de `X-APIM-Tenant-Id` : **ni l'un ni l'autre n'est
fourni par le client**. Un lot d'ack partiellement en échec répond **`207`**, jamais `200` — un échec
partiel ne doit pas se lire comme un succès.

Gain : clé révocable par consommateur, quotas, audit, refacturation.

> **Deux idées reçues, démenties par le code du Hub :** `provision_api` **ne redémarre pas le Hub**
> (activation à chaud par `catalog.reload()`), et **aucun module JDM/Janino n'est nécessaire** — le
> routage APIM est natif, les points de décision sont des politiques optionnelles.
>
> **Limite :** APIM ne vérifie qu'un seul `required_scope` par API publiée. Lecture et écriture ne
> sont donc pas cloisonnées : l'API `nats` porte `api:nats:*`.

---

## 10. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Démarrer l'app | Durable créé, visible dans `list_consumers` |
| 2 | Redémarrer l'app | **Aucun rejeu** — curseur préservé |
| 3 | `kill -9` en cours de traitement | Message redélivré, pas perdu |
| 4 | Payload invalide | DLQ après `term()`, pas de boucle infinie |
| 5 | Scaler à 2 instances | Chaque message traité **une seule** fois |
| 6 | Redémarrage complet du socle | Aucune perte, aucun doublon en base |
| 7 | Arrêter `soclehub-nats` | L'app démarre en dégradé, ne plante pas |
| 8 | Deux `consumer` distincts, même `target` | Chacun reçoit **le même** message (`seq` identique) |
| 9 | `ack` de l'un, rien pour l'autre | Le second reçoit toujours son message : curseurs indépendants |

Tests automatisés correspondants : `SocleNatsIntegrationTest` (12 tests contre un JetStream réel)
dans le dépôt `soclehub`, dont `fanOutGivesEachConsumerTheWholeFlow` et `maxDeliverExceededGoesToDlq`.

---

## 11. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Consumer **éphémère** au lieu de durable | Rejeu complet ou perte à chaque redémarrage | Toujours un `durable` nommé |
| `ack()` avant traitement | Perte définitive au moindre crash | Acker **après** |
| Pas d'idempotence | Doublons en base après redélivrance | Contrainte d'unicité sur `article_id` |
| Confondre ack et purge | « La queue ne se vide pas » | Rétention `Limits` : l'ack déplace un curseur, c'est normal |
| `peek_messages` pris pour un consumer | Messages jamais consommés, `num_pending` stable | Diagnostic uniquement |
| Recréer le durable à chaque démarrage | Rejeu massif | `ensureConsumer()` ne touche pas un durable existant |
| Partie absente traitée comme vide | Données fausses en aval | Omis ≠ vide |
| DLQ non surveillée | Échecs effacés après 7 jours | Brancher la supervision |
| Sujet `sdr.articles` (doc SDR obsolète) | Aucun message reçu | Le sujet est `rss.diffusion.sdr` |
| **Confondre `target` et `consumer`** | **Aucun message : on écoute un sujet à son propre nom** | `target` = ce qu'on lit, `consumer` = qui lit |
| **`consumer` accepté depuis la requête client** | **Un appelant fait avancer le curseur d'un autre ; pertes invisibles** | L'identité vient de `X-APIM-Tenant-Id`, jamais du corps |
| **`ackWait` ≤ timeout de `fetch`** | **Chaque message apparaît deux fois dans le même lot** | Garder `ack-wait-seconds` > timeout (60 s / 2 s) |
| Tester avec le `consumer` du vrai destinataire | Son backlog devient invisible | Prendre un `consumer` à soi, même `target` |

---

## 12. Pour aller plus loin

- [[howto-37-publier-des-messages-nats-depuis-une-app|HOWTO 37]] — le côté producteur
- [[howto-23-nats-streams|HOWTO 23]] — administration des streams
- [[howto-30-publier-une-api-apim|HOWTO 30]] — publier une API APIM
- [IMPLEMENTATION-TSH.md](../../nats/IMPLEMENTATION-TSH.md) — ce qui a réellement été livré, et pourquoi hors pack
