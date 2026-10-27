---
id: HOWTO-41
titre: "Salons : faire dialoguer deux sessions, et un humain par mail"
theme: "COL · Collaboration entre sessions et agents"
surface: [salon_worker, salon_mail_worker, SalonService, SalonAttachmentService, SalonNotifyWakeupSource, SalonPollWakeupSource, SalonWakeupConfiguration, SalonMailService, PortalSalonController]
tables: [salon.db_salon]
actions_mcp: 26
routes: ["/hub/salons"]
etat_verifie:
  hub: "3.70.3"
  socle: "5.9.4"
  le: "2026-10-16"
  comment: "lu au code et exécuté en production dans le salon de recette SAL-K5A3"
voisins: [HOWTO-11, HOWTO-16, HOWTO-21, HOWTO-42]
---

# HOWTO 41 — Salons : faire dialoguer deux sessions, et un humain par mail

> **Niveau** : intermédiaire | **Prérequis** : SocleHub Hub ≥ 3.70.1, une clé MCP, PostgreSQL comme source de données (pour le réveil immédiat — voir §2), MinIO et ClamAV provisionnés pour les pièces jointes, James pour l'entrée mail | **Temps estimé** : 20 min

Ce guide montre comment **ouvrir un salon, y faire dialoguer deux sessions MCP, y attacher des
fichiers versionnés, et y faire entrer un humain par courrier électronique**. Les 23 actions du
`salon_worker` et les 3 du `salon_mail_worker` portent déjà d'excellentes descriptions : cette fiche
ne les recopie pas. Elle documente ce qu'elles ne disent pas — la sémantique des curseurs, le
mécanisme de réveil et sa latence réelle, les limites chiffrées, et les sept pièges.

Tout ce qui suit a été **exécuté sur `admin.thesocle.net`** le 2026-10-16 (Hub 3.70.3, socle 5.9.4),
dans le salon de recette `SAL-K5A3` ouvert puis clos pour cette fiche. Les sorties sont copiées
telles quelles.

---

## Questions auxquelles répond cette fiche

1. Comment faire dialoguer deux sessions d'agent sur le même sujet ?
2. Comment une session attend-elle un message sans scruter en boucle, et avec quelle latence ?
3. Pourquoi `salon_wait` me rend-il zéro message alors que le salon en contient deux cents ?
4. Quelle est la différence entre `FROM_START` et `FROM_NOW`, et peut-on changer d'avis après ?
5. Quelles actions font avancer le curseur de lecture, et lesquelles ne le touchent pas ?
6. Comment une veille sait-elle, en un seul appel, où elle en est sur tous les salons ?
7. Comment faire participer un humain qui n'a ni compte ni outil ?
8. Comment déposer un fichier de plus de 8 Mo dans un salon ?
9. Une pièce jointe corrigée écrase-t-elle l'ancienne version ?
10. Une pièce jointe modifiée est-elle repassée à l'antivirus ?
11. Comment supprimer un salon, ou un message que je n'aurais pas dû poster ?
12. Comment paginer correctement une longue lecture sans perdre de messages ?
13. À quoi servent les rôles `QUESTION` et `ANSWER` — sont-ils décoratifs ?
14. Comment savoir si le réveil tourne en mode `notify` ou en mode `poll` ?

## Mots-clés

salon, fil de messages, code de salon, `SAL-XXXX`, curseur de lecture, `read_cursor`, `behind`,
`has_more`, pagination, attente longue, `salon_wait`, `timed_out`, réveil, `LISTEN`/`NOTIFY`,
`pg_notify`, canal `salon_events`, connexion dédiée hors pool Hikari, mode `poll`, `wakeup_mode`,
`FROM_START`, `FROM_NOW`, participant, `SUBSCRIBER`, `CREATOR`, `EXTERNAL`, `SYSTEM`,
rôle de message, `QUESTION`, `ANSWER`, `NOTE`, pièce jointe, `attachment_id`, base64, URL présignée,
dépôt direct, MinIO, bucket `salons`, ClamAV, `scan_status`, versionnement, `salon_attachment_edit`,
`how=replace`, archive zip, adresse mail du salon, relève à la minute, `socle.salon.mail.domain`,
quota mail, clôture, salon non supprimable, nature de salon, `APPLICATION`, `SUPERVISION`,
`CARNET_DE_BORD`, 1 Mo par message, 4 Mo par lecture

---

## 1. Contexte

Un salon est un **fil de messages séquencés, partagé entre plusieurs sessions d'agent**, avec un
curseur de lecture par session. C'est le canal qui permet à deux sessions Claude Code — ou à une
session et un humain — de travailler sur le même sujet sans passer par un fichier ni par le dépôt
git.

Trois propriétés le distinguent d'une simple table de messages :

1. **L'attente est serveur.** `salon_wait` tient la main jusqu'à l'arrivée d'un message —
   **mesuré à moins de 100 ms** après la publication, par `LISTEN`/`NOTIFY` PostgreSQL. Pas de
   scrutation côté agent.
2. **Chaque salon a une adresse mail.** `salon-k5a3@thesocle.net` est créée à l'ouverture : tout
   courrier qui y arrive est versé dans le fil, pièces jointes comprises, avec
   `author_role=EXTERNAL`. Un humain participe depuis son client mail, sans compte ni outil.
3. **Rien ne s'efface.** Un salon ne se supprime pas, il se clôt. Une pièce jointe modifiée
   conserve ses versions antérieures. **C'est la raison de ne jamais y déposer de secret** — c'est
   écrit dans la description de `salon_attach`, et ce n'est pas une précaution de style.

En production : **65 salons ouverts**, 6 natures dont 2 ajoutées après la livraison.

---

## 2. Architecture

**En une phrase, le chemin d'un message.** La session A ouvre le salon et obtient un code court et
une adresse mail ; la session B le rejoint par ce code en choisissant de reprendre l'historique ou
non. Chaque `salon_post` fait deux choses dans la même transaction : il insère le message, et il
émet un `pg_notify` sur le canal `salon_events`. Une **connexion PostgreSQL dédiée, tenue hors du
pool Hikari**, écoute ce canal pour tout le Hub et réveille les attentes `salon_wait` en cours —
mesuré **sous 100 ms**. En parallèle, un humain écrit à l'adresse du salon ; le `salon_mail_worker`
relève **chaque minute** et verse le courrier dans le fil avec `author_role=EXTERNAL`, pièces
jointes comprises. Le schéma ci-dessous détaille ce chemin.

```
  session A (MCP)                 Hub                      session B (MCP)
       │                           │                             │
       │  salon_create ───────────►│                             │
       │  ◄─── SAL-K5A3 + adresse  │                             │
       │       mail du salon       │                             │
       │                           │  ◄───── salon_join(SAL-K5A3,│
       │                           │          mode=FROM_START)   │
       │                           │                             │
       │  salon_post ─────────────►│                             │
       │                           │                             │
       │                     ┌─────┴─────┐                       │
       │                     │ INSERT    │                       │
       │                     │ message   │                       │
       │                     │     +     │                       │
       │                     │ pg_notify │                       │
       │                     │('salon_   │                       │
       │                     │  events') │                       │
       │                     └─────┬─────┘                       │
       │                           │                             │
       │                  ┌────────▼─────────┐                   │
       │                  │ SalonNotifyWakeup│                   │
       │                  │ Source — 1 conn. │                   │
       │                  │ DÉDIÉE, hors pool│                   │
       │                  │ Hikari, LISTEN   │                   │
       │                  │ salon_events     │                   │
       │                  └────────┬─────────┘                   │
       │                           │  réveille les attentes      │
       │                           ├────────────────────────────►│
       │                           │   salon_wait rend la main   │
       │                           │   (mesuré < 100 ms)         │
       │                           │                             │
  ┌────┴───────────────────────────┴──────────────┐              │
  │ humain ──mail──► salon-k5a3@thesocle.net      │              │
  │   SalonMailWorker relève CHAQUE MINUTE        │              │
  │   → message author_role=EXTERNAL + PJ         │              │
  └───────────────────────────────────────────────┘              │
```

### Le réveil : deux modes, et comment savoir lequel tourne

| Mode | Déclenchement | Latence | Quand |
|---|---|---|---|
| `notify` | `pg_notify('salon_events')` sur une **connexion dédiée hors pool Hikari** | **< 100 ms, mesuré** | source PostgreSQL |
| `poll` | scrutation par tranches de `soclehub.salon.poll-slice-ms` (défaut **500 ms**) | 0 à 500 ms | repli, source non PostgreSQL |

Le choix est automatique : `soclehub.salon.wakeup-mode=auto` (défaut) retient `notify` **dès que
l'URL JDBC commence par `jdbc:postgresql:`**, et se replie sinon. Les valeurs `notify` et `poll`
forcent — et demander `notify` sur une source non PostgreSQL produit un WARN puis un repli, pas une
erreur.

```bash
mcp__soclehub__salon_worker__get_status
# → {"state":"running","open_salons":65,"active_waits":0,"wakeup_mode":"notify", …}
```

`wakeup_mode` est la seule façon fiable de savoir lequel tourne. **Ne pas le déduire de la
configuration** : `auto` ne dit pas ce qu'il a choisi.

### Les limites, toutes chiffrées

| Quoi | Limite | Constante |
|---|--:|---|
| Corps d'un message | **1 Mo** (UTF-8, mesuré en octets) | `MAX_BODY_BYTES` |
| Pièce jointe par MCP (base64) | **8 Mo décodés** | `MAX_INLINE_BYTES` |
| Messages par lecture | 200 par défaut, **500 maximum** | `DEFAULT_READ_LIMIT` / `MAX_READ_LIMIT` |
| **Octets** par lecture | **4 Mo** — tronque la page ⚠️ piège 3 | `MAX_READ_BYTES` |
| Attente `salon_wait` | 60 s par défaut, **300 s maximum** | `DEFAULT_WAIT_SECONDS` / `MAX_WAIT_SECONDS` |
| Quota mail du salon | 200 Mo | `socle.salon.mail.quota-mb` |

Le code du salon est un `SAL-` suivi de 4 caractères tirés d'un alphabet de 32 — **sans `I`, `O`,
`0` ni `1`**, pour qu'un humain puisse le recopier d'un coup d'œil. Environ un million de
combinaisons.

---

## 3. Étape 1 — Ouvrir un salon

```bash
mcp__soclehub__salon_worker__salon_create \
  title="Recette HOWTO 41 — salons (doc)" \
  session_name="doc-howto41" \
  topic="Salon ouvert pour vérifier le comportement décrit dans le HOWTO 41." \
  type="AUTRE"
```

Réponse réelle :

```json
{
  "salon_code": "SAL-K5A3", "x_id": 101,
  "type": "AUTRE", "type_label": "Autre", "status": "OPEN",
  "message_count": 1,
  "mail_address": "salon-k5a3@thesocle.net",
  "hint": "Transmettre le code SAL-K5A3 à l'autre session, qui fera salon_join puis salon_read.
           Tout mail envoyé à salon-k5a3@thesocle.net est versé dans le salon (relève chaque minute)."
}
```

Trois choses à noter. Le `topic` **est posté comme message `seq=1`** — ce n'est pas un champ de
métadonnée, c'est le premier message du fil. L'adresse mail est dérivée du code
(`salon-` + code en minuscules + `@` domaine), le domaine venant de `socle.salon.mail.domain` ou, à
défaut, du domaine du Hub **privé de son premier label** — `admin.thesocle.net` devient donc
`thesocle.net`. Et le `type` conditionne la capacité à retrouver le salon plus tard par
`salon_list(type=…)` : le choisir maintenant, car un salon mal typé se perd dans les 65 autres.

Les natures disponibles ne sont pas figées :

```bash
mcp__soclehub__salon_worker__salon_type_list
# APPLICATION (16 salons) · CARNET_DE_BORD (1, ajouté après livraison) · REUNION (1)
# · SUPERVISION · CHANTIER · AUTRE
mcp__soclehub__salon_worker__salon_type_create  code="REVUE_DE_CODE"  label="Revue de code"  color="#7e14ff"
```

Un type livré avec le Hub (`builtin: true`) ne se supprime pas — il se désactive. Un type encore
porté par des salons ne se supprime pas non plus : il faut d'abord les déplacer par `salon_set_type`.

---

## 4. Étape 2 — Rejoindre, écrire, lire

```bash
# La session B rejoint, et choisit de reprendre l'historique
mcp__soclehub__salon_worker__salon_join \
  salon_code="SAL-K5A3"  session_name="session-b"  mode="FROM_START"
```

`FROM_START` (défaut) place le curseur à 0 : la première lecture rejoue tout.
`FROM_NOW` le place au dernier message : la session ne verra que la suite. **Ce choix est fait une
fois, à l'inscription, et ne se reprend pas** — en pratique, `FROM_NOW` par erreur se rattrape avec
`salon_read(since_seq=0)`, qui relit tout sans tenir compte du curseur.

```bash
mcp__soclehub__salon_worker__salon_post \
  salon_code="SAL-K5A3"  session_name="doc-howto41" \
  body="Question de recette : le curseur avance-t-il sur salon_wait ?" \
  role="QUESTION"
# → {"message_seq": 2, "message_role": "QUESTION", "author": "doc-howto41"}
```

Les trois rôles de message portent un sens **fonctionnel, pas décoratif** : `QUESTION` fait lever
le signal « question en attente » que `salon_list` remonte, ce qui permet à une veille de repérer
les salons qui attendent une réponse sans les ouvrir un par un. `ANSWER` avec `reply_to_seq`
rattache la réponse. `NOTE` (défaut) ne signale rien.

```bash
mcp__soclehub__salon_worker__salon_read  salon_code="SAL-K5A3"  since_seq="0"
```

```json
{
  "messages": [
    {"seq":1,"author":"doc-howto41","author_role":"CREATOR","role":"NOTE","body":"Salon ouvert…"},
    {"seq":2,"author":"doc-howto41","author_role":"CREATOR","role":"QUESTION","body":"Question de recette…"}
  ],
  "count": 2, "cursor": 2, "has_more": false
}
```

**La sémantique du curseur est la partie qui se paie cher quand on l'ignore :**

| Appel | Effet sur le curseur |
|---|---|
| `salon_read` **avec** `session_name` | **avance** le curseur de cette session |
| `salon_read` **sans** `session_name` | n'avance rien — lecture d'observation |
| `salon_read` avec `since_seq` | lit au-delà de cette séquence, **en ignorant** le curseur |
| `salon_wait` | **avance** le curseur (il lit, par construction) |
| `salon_post` | **n'avance pas** le curseur de l'auteur — voir piège 2 |
| `salon_list` avec `session_name` | n'avance rien, mais rend `my_cursor` et `my_behind` par salon |

`salon_list(session_name=…)` est l'appel conçu pour une veille : **un seul appel** donne, pour tous
les salons, si la session est membre, où en est son curseur et de combien de messages elle est en
retard. Sans avancer quoi que ce soit.

---

## 5. Étape 3 — Attendre un message

```bash
mcp__soclehub__salon_worker__salon_wait \
  salon_code="SAL-K5A3"  session_name="doc-veilleur"  timeout_seconds="120"
```

Mesure réelle : un `salon_post` lancé **3 secondes** après le début de l'attente l'a fait rendre la
main en **3,075 s** — soit une latence de réveil sous les 100 ms.

```json
{"messages":[{"seq":3,"role":"ANSWER","reply_to_seq":2,"body":"ANSWER : oui…"}],
 "count":1,"cursor":3,"timed_out":false}
```

Sur expiration, `timed_out: true` et `messages: []` — **ce n'est pas une erreur**, c'est le
déroulement normal. Une veille enchaîne les attentes et ne traite que les réveils garnis.

Deux détails d'implémentation qui expliquent le comportement. L'attente **s'inscrit auprès de la
source de réveil avant de lire** : si un message arrive pendant la lecture, le réveil est déjà
armé et n'est pas perdu. Et l'attente est découpée en tranches de 5 secondes, ce qui lui permet de
constater l'expiration même si aucune notification n'arrive jamais.

---

## 6. Étape 4 — Pièces jointes versionnées

Deux voies de dépôt, selon la taille :

```bash
# ≤ 8 Mo — le contenu passe par MCP, en base64
mcp__soclehub__salon_worker__salon_attach \
  salon_code="SAL-K5A3"  session_name="doc-howto41" \
  filename="note.md"  content_base64="$(base64 -w0 note.md)"  content_type="text/markdown"

# > 8 Mo — URL présignée, le fichier ne passe pas par MCP
mcp__soclehub__salon_worker__salon_attach_url  salon_code="SAL-K5A3" …   # → PUT presigné
curl -X PUT --upload-file gros.zip "<url rendue>"
mcp__soclehub__salon_worker__salon_attach_confirm  attachment_id="260"   # mesure, empreinte, scan
```

Réponse réelle du dépôt direct — noter que j'ai volontairement envoyé
`filename="../../etc/note.md"` :

```json
{
  "attachment_id": 259,
  "filename": "note.md",                        ← traversée de chemin neutralisée
  "size_bytes": 20,
  "scan_status": "CLEAN", "scan_detail": "aucune signature détectée",
  "bucket": "salons",
  "object_key": "salons/SAL-K5A3/55df02f2-…-note.md",
  "sha256": "e594387e8b52d38c0ae69575c2e04069743aa50444d97d7a5663a047b9f1973f",
  "version": 1, "edited": false, "kind": "text"
}
```

Le dépôt fait trois choses avant d'accepter : il **écrase les séparateurs de chemin** du nom de
fichier, il **scanne par ClamAV**, et il **empreinte en SHA-256**. La clé d'objet porte un UUID, donc
deux fichiers de même nom ne se télescopent pas.

Une pièce jointe **se corrige sans rien perdre** :

```bash
mcp__soclehub__salon_worker__salon_attachment_read  attachment_id="259"     # texte + n° de version
mcp__soclehub__salon_worker__salon_attachment_edit \
  attachment_id="259"  session_name="doc-veilleur"  text="Note de recette v2 — corrigée."
mcp__soclehub__salon_worker__salon_attachment_versions  attachment_id="259"
```

```json
{"attachment_id":259,"current_version":2,"edited_by":"doc-veilleur","archived_count":1,
 "versions":[{"version":"1","size_bytes":"20","sha256":"e594387e…",
              "replaced_by":"doc-veilleur","replaced_how":"text","archived_at":"2026-10-16 15:45:58"}]}
```

Les trois modes de modification (`how`) ne sont **pas équivalents du point de vue de la sécurité** :

| `how` | Usage | Repassé à l'antivirus ? |
|---|---|:-:|
| `text` (défaut pour un texte) | corriger un markdown, un JSON | ❌ |
| `annotate` | image retouchée | ❌ |
| `replace` | fichier entièrement remplacé | ✅ **le seul** |

Enfin, `salon_attachments_archive` rend **toutes** les pièces d'un salon en un zip, par URL à durée
limitée — la façon de récupérer un chantier terminé en un geste.

---

## 7. Étape 5 — Faire entrer un humain par mail

L'adresse est créée à l'ouverture du salon ; rien à faire. Un courrier envoyé à
`salon-k5a3@thesocle.net` apparaît dans le fil avec `author_role=EXTERNAL`, pièces jointes versées
comme des pièces de salon ordinaires (donc scannées et versionnées).

```bash
mcp__soclehub__salon_mail_worker__get_status                      # relève, quota, dernière erreur
mcp__soclehub__salon_mail_worker__poll_now    salon_code="SAL-K5A3"   # forcer une relève
mcp__soclehub__salon_mail_worker__provision   salon_code="SAL-K5A3"   # recréer la boîte si échec
```

**La relève est cadencée à la minute.** Un humain qui répond ne voit donc pas son message apparaître
instantanément ; `poll_now` sert exactement à ne pas attendre pendant une démonstration. Si
`mail_address` est rendue mais que rien n'arrive jamais, c'est que le provisionnement a échoué :
`get_status` porte la raison, et `provision` rejoue l'opération. La cause la plus fréquente est un
`socle.salon.mail.domain` non réglé sur un Hub dont le domaine n'a qu'un seul label exploitable.

---

## 8. Validation

Le cycle complet, tel qu'il a répondu :

```bash
# 1. ouvrir
salon_create → SAL-K5A3, mail_address rendue, message_count=1

# 2. écrire une question
salon_post role=QUESTION → message_seq=2

# 3. lire sans toucher au curseur
salon_read since_seq=0 (sans session_name) → count=2, has_more=false

# 4. attendre, et être réveillé
salon_wait timeout=120 ‖ salon_post 3 s plus tard → rendu en 3,075 s, timed_out=false

# 5. attacher, corriger, vérifier l'historique
salon_attach ../../etc/note.md → filename=note.md, scan CLEAN, version 1
salon_attachment_edit → version 2, archived_count=1

# 6. clore
salon_close → {"status":"CLOSED","message_count":4}
salon_post   → Error: Salon SAL-K5A3 clos : écriture refusée      ✅
salon_read   → répond, et montre le message SYSTEM de clôture      ✅
```

La clôture **écrit un message `author_role=SYSTEM`** dans le fil (`seq=4` ici) : le salon porte la
trace de sa propre fermeture, lisible comme n'importe quel message.

---

## 9. Pièges courants

### Piège 1 — 🔴 `salon_wait` inscrit la session d'office, et en `FROM_NOW`

**Symptôme** : une session appelle `salon_wait` sur un salon riche de 200 messages, et reçoit
`count: 0, timed_out: true`. Elle conclut que le salon est vide ou que l'attente ne marche pas.

**Cause** : mesurée. `SalonService.await()` inscrit la session absente **comme `SUBSCRIBER` en
`FROM_NOW`**, curseur positionné au dernier message. Dans le salon de recette, `doc-veilleur` n'a
jamais fait `salon_join` ; après un `salon_wait` de 5 s, `salon_participants` le montre ainsi :

```json
{"name":"doc-veilleur","role":"SUBSCRIBER","join_mode":"FROM_NOW","read_cursor":2,"behind":0}
```

Deux messages existaient, elle n'en a vu aucun — et `behind: 0` l'affirme, à juste titre : pour
elle, l'historique n'existe pas.

**Résolution** : **toujours `salon_join` avant `salon_wait`**, en choisissant explicitement le mode.
Si c'est déjà raté, `salon_read(since_seq=0)` relit tout sans tenir compte du curseur. Et noter
qu'on ne peut pas « rejoindre en FROM_START » après coup : l'inscription existe déjà.

### Piège 2 — Écrire ne rattrape pas son propre retard

**Symptôme** : une session poste deux messages et se retrouve `behind: 2` dans
`salon_participants`. Une veille qui déclenche sur `behind > 0` boucle sur ses propres écrits.

**Cause** : `salon_post` n'avance pas le curseur de l'auteur. Mesuré sur le créateur du salon de
recette, après ses deux messages : `{"name":"doc-howto41","read_cursor":0,"behind":2}`.

**Résolution** : une veille doit filtrer sur l'auteur, pas seulement sur `behind`. Ou faire suivre
chaque `salon_post` d'un `salon_read` avec son `session_name`, qui remet le curseur à niveau.

### Piège 3 — Une page de lecture peut être tronquée par les octets, pas par le compte

**Symptôme** : `salon_read(limit=500)` rend `count: 37` et on en conclut que le salon n'a que
37 messages de plus. Des messages sont perdus silencieusement.

**Cause** : la lecture est bornée **deux fois** — par le nombre (500 maximum) *et* par le volume
(`MAX_READ_BYTES` = 4 Mo). Avec des messages volumineux, le budget d'octets saute le premier. Un
message qui dépasse à lui seul les 4 Mo est tout de même rendu, sinon le curseur resterait bloqué
dessus indéfiniment.

**Résolution** : **boucler sur `has_more`**, jamais sur `count < limit`. `has_more` et le curseur
portent le contrat ; `count` ne le porte pas. C'est écrit dans le code, et c'est le seul protocole
de pagination correct ici.

### Piège 4 — `scan_status: CLEAN` sur une pièce modifiée peut être périmé

**Symptôme** : une pièce jointe affiche `scan_status: CLEAN` alors que son contenu a été remplacé
après le scan.

**Cause** : seul `how=replace` repasse à l'antivirus. Un `how=text` ou `how=annotate` **hérite du
verdict de la version précédente**. Mesuré : la version 2 de la pièce 259, modifiée en `how=text`,
affiche `scan_status: CLEAN` et `scan_detail: "aucune signature détectée"` — qui sont les valeurs de
la version 1.

**Résolution** : lire `how` à côté de `scan_status`. Pour une pièce dont le contenu doit être
re-garanti, forcer `how=replace` même pour un texte. Et ne pas fonder une décision de sécurité sur
le `scan_status` d'une pièce `edited: true` sans vérifier comment.

### Piège 5 — Un salon ne se supprime pas

**Symptôme** : on cherche `salon_delete`. Il n'existe pas.

**Cause** : par conception. `salon_close` interdit l'écriture et laisse la lecture — les 65 salons
ouverts et tous les clos restent consultables indéfiniment, pièces jointes et versions comprises.

**Résolution** : accepter que le salon soit un journal, pas un brouillon. **Conséquence pratique :
aucun secret, aucun jeton, aucun mot de passe dans un corps de message ni dans une pièce jointe.**
Un salon de test se clôt, il ne se nettoie pas. Nommer les salons de recette comme tels, pour
qu'ils se distinguent plus tard des vrais.

### Piège 6 — Le mode de réveil n'est pas celui que la configuration laisse croire

**Symptôme** : `soclehub.salon.wakeup-mode=auto` est en place, on suppose `notify`, et les attentes
traînent de quelques centaines de millisecondes.

**Cause** : `auto` ne retient `notify` que si l'URL JDBC commence **exactement** par
`jdbc:postgresql:`. Sur une source H2 — un poste de développement, un test — le repli est
silencieux, en `poll` à 500 ms. Et si `notify` est forcé sur une source non PostgreSQL, le repli est
le même, avec un simple WARN au démarrage que personne ne relit.

**Résolution** : lire `wakeup_mode` dans `salon_worker__get_status`, jamais la configuration.
C'est la seule source de vérité, et elle coûte un appel.

### Piège 7 — L'adresse mail du salon dépend d'un domaine déduit

**Symptôme** : `mail_address` est rendue par `salon_create`, mais aucun courrier n'arrive jamais, et
`salon_mail_worker__get_status` signale `domaine mail inconnu`.

**Cause** : à défaut de `socle.salon.mail.domain`, le domaine est **déduit du domaine du Hub en
retirant son premier label** — `admin.thesocle.net` → `thesocle.net`, ce qui est correct. Mais un
Hub servi sur un domaine à deux labels seulement, ou sur un nom qui n'a pas de zone mail, produit
une adresse syntaxiquement valable et fonctionnellement morte.

**Résolution** : régler `socle.salon.mail.domain` explicitement en production, ne pas se reposer sur
la déduction. Puis vérifier par un vrai envoi suivi de `poll_now` — la présence de `mail_address`
dans la réponse de `salon_create` **ne prouve pas** que la boîte existe.

---

## 10. Pour aller plus loin

- [[CATALOGUE-FONCTIONS-TSH|Catalogue des fonctions mutualisées]] — §11, les 26 actions de collaboration et leur couverture,
- [[howto-16-storage-s3-quotas|HOWTO 16 — Stockage S3 et quotas]] — le bucket `salons`, les URL présignées et leur durée,
- [[howto-21-clamav-mail-scan|HOWTO 21 — ClamAV]] — le scan appliqué à chaque dépôt de pièce jointe,
- [[howto-11-configurer-james-mail|HOWTO 11 — Configurer James]] — la boîte du salon, le quota et la relève,
- `soclehub/src/main/java/eu/lmvi/soclehub/salon/service/SalonService.java` — curseurs, budgets, `await()` : les sept limites chiffrées sont en tête de fichier,
- `soclehub/src/main/java/eu/lmvi/soclehub/salon/notify/SalonWakeupConfiguration.java` — le choix `auto` entre `notify` et `poll`, 61 lignes.
