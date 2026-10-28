# HOWTO COM-04 — Envoyer des courriels : Hub, James ou Brevo

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-comm` **2.2.0** (branche `main`, commit `227fe5e`, tag `v2.2.0`, code identique à 2.1.0 — commit `ba69578` ; Spring Boot 4.1.2, socle 5.11.0, minimum 5.10.0) — comportement identique à 2.1.0, à 2.0.0 (socle 5.8.6-5.9.x, Boot 4.0.6) et à 1.1.0, dernière version Boot 3 · `mail_worker` lu dans `soclehub` 3.73.0 (commit `35fdcd0`)
**Vérifié au code le :** 2026-10-28
**Prérequis :** [[howto-com-01-integrer-le-pack|COM-01]] ; James provisionné ([[howto-11-configurer-james-mail|HOWTO 11]]) ou clé IAM du Hub
**Temps estimé :** 20 min

---

## 1. Contexte

Le canal `EMAIL` du pack (`eu.lmvi.socle.pack.comm.notify.EmailChannel`) a trois fournisseurs,
choisis par `socle.comm.email.provider` :

| Fournisseur | Transport | Qui porte la réputation d'envoi |
|---|---|---|
| `hub` | `POST {hub}/api/actions/mail_worker/send_email` | le Hub (relais configuré par l'exploitation, journal central `mail_worker/list_logs`) |
| `smtp` | SMTP Jakarta Mail vers un serveur | celui qu'on vise — sur la plateforme : **James** (`soclehub-james`, DKIM du domaine) |
| `brevo` | API Brevo `/smtp/email` avec une clé propre à l'app | l'app, avec sa clé Brevo |

**Règle de routage du dépôt : le courriel est un service rendu par le Hub.** Une app ne monte pas
son propre relais. Concrètement :

| Besoin de l'app | Voie |
|---|---|
| un courriel transactionnel isolé, sans gabarit par type ni autre canal | **pas de pack** : appeler `mail_worker/send_email` ou `send_templated_email` du Hub ([[howto-11-configurer-james-mail|HOWTO 11]]) |
| plusieurs canaux, types et gabarits en base, boîte in-app, journal rejouable | **pack**, fournisseur `hub` (BingFetch) ou `smtp` vers James (UniqPersonnality) |
| clé Brevo propre à l'app | à éviter sur la plateforme : elle contourne le relais et le journal du Hub |

---

## 2. Architecture

```
NotifyWorker ─► EmailChannel.send(to, subject, body)
                   │
                   ├─ provider=hub ──► POST http://soclehub:80/api/actions/mail_worker/send_email
                   │                    X-Api-Key: <clé IAM>
                   │                    {to, subject, html, text, app_id, from}
                   │                    Hub : expéditeur = noreply@<zone Cloudflare par défaut>
                   │
                   ├─ provider=smtp ─► soclehub-james:25 (réseau Docker, sans auth, DKIM par James)
                   │
                   └─ provider=brevo ► https://api.brevo.com/v3/smtp/email  (api-key)
```

Corps : envoyé en HTML s'il commence par `<` ou contient `<html`, `<p>`, `<br` ; sinon en texte.
Avec `hub`, un texte est converti en HTML (échappement `& < >`, `\n` → `<br>`) car le
`mail_worker` exige `html`.

---

## 3. Étape 1 — Fournisseur `hub` (recommandé)

```yaml
socle:
  comm:
    schema: ${DATABASE_SCHEMA:schema_monapp}
    app-name: MonApp
    email:
      provider: hub
      from-name: MonApp              # sans effet avec "hub" (voir pièges)
      timeout-seconds: 30
      hub:
        url: ${SOCLEHUB_URL:}        # http://soclehub:80 — le Hub écoute sur 80 en interne
        api-key: ${SOCLEHUB_API_KEY:}
        app-id: monapp               # rangé dans le journal du mail_worker
```

Variables du conteneur :

```bash
SOCLEHUB_URL=http://soclehub:80
SOCLEHUB_API_KEY=<clé IAM d'un compte autorisé sur mail_worker>
```

Le canal est **disponible** dès que `hub.url` est non vide ; la clé n'est ajoutée en `X-Api-Key`
que si elle est non vide. Le résultat suit la réponse du Hub : HTTP non-2xx ou `success:false`
→ `FAILED`, jamais un succès apparent.

Contrôle direct de la porte avant de brancher l'app :

```bash
curl -s -X POST http://soclehub:80/api/actions/mail_worker/send_email \
  -H "X-Api-Key: $SOCLEHUB_API_KEY" -H "Content-Type: application/json" \
  -d '{"to":"moi@example.com","subject":"essai","html":"<p>essai</p>","app_id":"monapp"}'
# attendu : un succès dont la donnée porte {"to":…,"subject":…,"status":"sent"} (MailWorker.handleSendEmail)
```

---

## 4. Étape 2 — Fournisseur `smtp` vers James

Configuration réelle d'UniqPersonnality (James sur le réseau Docker de confiance, port 25 sans
authentification ; James signe DKIM pour le domaine) :

```yaml
socle:
  comm:
    schema: ${DATABASE_SCHEMA:schema_uniqpersonnality}
    app-name: UniqPersonnality
    log-content: false
    retry:
      auto-enabled: false
    email:
      provider: ${UNIQP_COURRIEL_FOURNISSEUR:smtp}
      from-name: UniqPersonnality
      from-email: ${UNIQP_COURRIEL_EXPEDITEUR:noreply@thesocle.net}
      smtp:
        host: ${UNIQP_SMTP_HOTE:soclehub-james}
        port: ${UNIQP_SMTP_PORT:25}
        start-tls: ${UNIQP_SMTP_STARTTLS:false}
```

Sans `smtp.user`, le pack pose `mail.smtp.auth=false`. Avec un utilisateur, il s'authentifie
(soumission 587 + STARTTLS). `from-email` doit appartenir à un domaine que James sert et signe.
Le canal est disponible dès que `smtp.host` est renseigné ; `provider_message_id` = `Message-ID`.

---

## 5. Étape 3 — Envoyer

Le fournisseur est transparent pour l'appelant ([[howto-com-02-envoyer-une-notification-multicanal|COM-02]]).
Envoi d'essai, repris de BingFetch (`Alertes.essayer`) :

```java
List<ChannelResult> r = notify.sendNotification(null, null, "MONAPP_ALERTE", destinataire,
        Map.of("subject", "[MonApp] essai du canal d'alerte",
               "body", "Ce courriel prouve que les alertes vous parviennent.\n\nhttps://monapp.thesocle.net"),
        List.of("EMAIL"), null, "fr", null);
String etat = r.isEmpty() ? "aucun canal" : r.get(0).success() ? "envoye" : r.get(0).error();
```

---

## 6. Vérifier

```bash
# Côté app : la ligne EMAIL du journal
psql "$DB" -c "SELECT status, error_message, provider_message_id FROM schema_monapp.tr_notification_log
               WHERE channel='EMAIL' ORDER BY x_dateCreated DESC LIMIT 5;"

# Côté Hub (fournisseur hub) : le journal central filtré par app
curl -s -X POST https://admin.thesocle.net/api/actions/mail_worker/list_logs \
  -H "X-Api-Key: $HUB_IAM_KEY" -H "Content-Type: application/json" \
  -d '{"app_id":"monapp","limit":5}'
```

Et surtout : **ouvrir la boîte du destinataire réel**. Un `SENT` signifie « remis au relais »,
pas « reçu ».

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `hub.url` vide | canal EMAIL absent de `channels_available`, ligne `FAILED` « Channel EMAIL unavailable » |
| 2 | Clé IAM fausse | `FAILED`, message « Hub mail_worker HTTP 401 … » |
| 3 | Corps texte avec `<` | reçu échappé, sauts de ligne conservés |
| 4 | Corps commençant par `<div>` | reçu en HTML tel quel |
| 5 | SMTP James, domaine signé | en-tête `DKIM-Signature` présent à la réception |

Tests du pack : `EmailHubHtmlTest` (conversion texte → HTML).

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `from-email` / `from-name` avec `hub` | ignorés : le `mail_worker` impose `noreply@<zone Cloudflare par défaut du Hub>` | accepter l'expéditeur du Hub, ou passer en `smtp` vers James pour choisir l'adresse |
| `hub.url` sur le port 8080 | connexion refusée | le Hub écoute sur **80** en interne : `http://soclehub:80` |
| `provider_message_id` vide avec `hub` | aucun identifiant à rapprocher | le Hub ne rend pas d'id ; rapprocher par `app_id` + horodatage dans `list_logs` |
| Clé APIM au lieu de clé IAM | 401 | `/api/actions` du Hub prend une clé **IAM** en `X-Api-Key` |
| Détection HTML naïve | un texte commençant par `<` part en HTML ; un HTML commençant par une espace et sans `<p>`/`<br>`/`<html` part en texte | normaliser le corps avant l'appel |
| Pas de pièce jointe ni de copie | aucun paramètre pour `cc`, `bcc`, pièces jointes | `james_worker/send_via_james` ou un client dédié côté app |
| Port 25 de James depuis l'extérieur du réseau Docker | refus ou relais ouvert | James en `smtp` seulement depuis `docker_soclehub-net` |
| `EmailChannel` sans circuit breaker | un relais lent bloque l'appelant jusqu'à `timeout-seconds` (30 s) par envoi | réduire `timeout-seconds` ; envoyer hors du fil de la requête HTTP |
| Clé Brevo propre à l'app | envois hors du journal et de la réputation du Hub | fournisseur `hub` |

---

## 9. Pour aller plus loin

- [[howto-11-configurer-james-mail|HOWTO 11 — James : envoyer et recevoir]]
- [[howto-com-05-journal-rejeu-et-anti-doublon|COM-05 — Journal, rejeu, contenu non conservé]]
- [[howto-com-03-types-et-gabarits|COM-03 — Gabarits]]
