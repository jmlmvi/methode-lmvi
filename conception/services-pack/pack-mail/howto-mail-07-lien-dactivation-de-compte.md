# HOWTO MAIL-07 — Faire naître un compte IAM par un lien d'activation envoyé par courriel

**Niveau :** Senior
**Cible :** application V005 derrière le proxy du Hub, qui ouvre des comptes à des personnes extérieures
**Versions vérifiées au code (2026-10-28) :** `socle-pack-mail` **1.6.0** (commit `932cf29`, tag `v1.6.0` ; code identique à 1.5.0 `a396ada`) — fonction **nouvelle en 1.4.0**, extraite de Your360 · socle **5.11.0** (minimum 5.10.0) · Spring Boot 4.1.2. ⚠️ En 1.4.0, `SOCLE_MAIL_ACTIVATION_ENABLED=true` faisait échouer le démarrage (`ActivationController` sans constructeur désigné) : corrigé en 1.5.0 · Hub : porte `POST /api/actions/iam_worker/*`
**Prérequis :** [[howto-mail-01-integrer-le-pack|MAIL-01]] ; un compte de service IAM pour l'application et sa clé ([[howto-08-creer-utilisateur-iam|HOWTO 08]]) ; SSO de l'app ([[howto-09-configurer-sso-multi-app|HOWTO 09]])
**Temps estimé :** 45 min

---

## 1. Contexte

Une personne écrit à l'application (MAIL-06) ou est invitée ; elle n'a pas de compte. L'application
lui envoie un **lien unique** ; la personne choisit son mot de passe sur une page publique servie par
le pack ; **le compte naît à cet instant dans l'IAM du Hub**, l'application lui est ouverte avec un
rôle court, et le lien est consommé — une seule fois, sous 7 jours.

| Qui fait quoi | |
|---|---|
| **Hub** — `iam_worker` | possède le compte et le mot de passe (`create_user`, `grant_app_access`) |
| **Hub** — `mail_worker` | envoie le courriel qui porte le lien (`send_templated_email`) |
| **Hub** — proxy | laisse passer `/activation/**` sans session (`sso.publicPaths`) |
| **pack** — `ActivationService` | émet le jeton, garde son empreinte, consomme atomiquement |
| **pack** — `ActivationController` | page `/activation/{jeton}` et `POST /activation` |
| **pack** — `hub_iam_gateway_worker` | client de l'IAM (disjoncteur, reprises, délais) |
| **application** | décide qui inviter, appelle `emettre`, envoie le courriel |

Propriétés tenues par le code :

- **aucun mot de passe émis, envoyé ni stocké** : celui que la personne choisit traverse une fois
  jusqu'à `create_user`, qui le hache ;
- **le jeton n'est pas stocké** (256 bits ; seule son empreinte SHA-256, `jeton_empreinte`) ni journalisé ;
- **consommation atomique** : `UPDATE … SET consomme_le = now() WHERE jeton_empreinte = ? AND
  consomme_le IS NULL AND expire_le > now()`, puis l'appel IAM **dans la même transaction** : si
  l'IAM échoue, rien n'est consommé et le lien reste valable ; un double clic attend le verrou puis
  trouve le lien servi ;
- **jamais `admin`** : `RoleApplicatif` refuse `admin`, `administrateur`, `administrator`,
  `superadmin`, `root`, et exige un nom court (le Hub préfixe en `app:<app>:<rôle>`) ;
- **compte déjà existant** : rattaché à l'application **sans toucher à son mot de passe**.

---

## 2. Architecture

```
 Application                         socle-pack-mail                         Hub
 ───────────                         ───────────────                         ───
 activation.emettre(email, tenant,  → Jeton.neuf() ; INSERT tr_activation
                    role, auteur)      (empreinte, email, tenant, role,
   ◄── LienEmis{lien, expireLe}         expire_le = now() + 7 j)
 send_templated_email(to, lien) ───────────────────────────────────────────► mail_worker
                                                                                 │
 personne ── GET /activation/{jeton} ─► ActivationController                     ▼ courriel
            (public, 10 req/min/IP)      lire() → OUVERT | DEJA_SERVI | PERIME | INCONNU
          ── POST /activation ────────► activer(jeton, mdp, confirmation)
            (jeton dans le CORPS)        BEGIN ; UPDATE … consomme_le … RETURNING
                                           list_users ─────────────────────────► iam_worker
                                           create_user (si absent) ────────────► iam_worker
                                           grant_app_access ───────────────────► iam_worker
                                         COMMIT  (ou ROLLBACK si l'IAM échoue)
          ◄── 303 → <hub>/hub/login?redirect=<app>/
```

---

## 3. Étape 1 — Compte de service et clé IAM

`hub_iam_gateway_worker` appelle `POST <SOCLE_MAIL_HUB_URL>/api/actions/iam_worker/<action>` avec
la clé en `X-Api-Key`. C'est une **clé IAM** (celle du compte de service de l'application), pas la
clé de plateforme du `/mcp` du Hub, que cette porte refuse. Le compte doit pouvoir appeler
`list_users`, `create_user` et `grant_app_access` ([[howto-08-creer-utilisateur-iam|HOWTO 08]]).
Ranger la clé dans Vault (`soclehub/apps/<app>/hub`) et l'injecter en variable.

⚠️ Le Hub n'injecte pas lui-même `SOCLEHUB_API_KEY` dans l'application : l'installation la pose.

## 4. Étape 2 — Configurer

```bash
SOCLE_MAIL_ACTIVATION_ENABLED=true                         # défaut false : ni route, ni worker
SOCLE_MAIL_ACTIVATION_APP_ID=theideabox                    # app_id de grant_app_access
SOCLE_MAIL_ACTIVATION_APP_URL_PUBLIQUE=https://theideabox.thesocle.net
SOCLE_MAIL_ACTIVATION_HUB_URL_PUBLIQUE=https://thesocle.net
SOCLE_MAIL_ACTIVATION_VALIDITE_JOURS=7
SOCLE_MAIL_ACTIVATION_LONGUEUR_MINIMALE=10                 # plancher codé : 8
SOCLE_MAIL_ACTIVATION_ROLE_PAR_DEFAUT=user
SOCLE_MAIL_ACTIVATION_DEBIT_PAR_MINUTE=10
SOCLE_MAIL_HUB_URL=http://soclehub:80                      # soclehub écoute sur 80, pas 8080
SOCLE_MAIL_HUB_API_KEY=<clé IAM du compte de service, depuis Vault>
SOCLE_MAIL_HUB_DELAI_MS=10000
```

```yaml
socle:
  mail:
    app-name: ${SOCLE_MAIL_APP_NAME:TheIdeaBox}           # titre de la page d'activation
    activation:
      enabled: ${SOCLE_MAIL_ACTIVATION_ENABLED:false}
      app-id: ${SOCLE_MAIL_ACTIVATION_APP_ID:}
      app-url-publique: ${SOCLE_MAIL_ACTIVATION_APP_URL_PUBLIQUE:}
      hub-url-publique: ${SOCLE_MAIL_ACTIVATION_HUB_URL_PUBLIQUE:}
      validite-jours: ${SOCLE_MAIL_ACTIVATION_VALIDITE_JOURS:7}
      longueur-minimale: ${SOCLE_MAIL_ACTIVATION_LONGUEUR_MINIMALE:10}
      role-par-defaut: ${SOCLE_MAIL_ACTIVATION_ROLE_PAR_DEFAUT:user}
      debit-par-minute: ${SOCLE_MAIL_ACTIVATION_DEBIT_PAR_MINUTE:10}
    hub:
      url: ${SOCLE_MAIL_HUB_URL:http://soclehub:80}
      api-key: ${SOCLE_MAIL_HUB_API_KEY:}
      delai-ms: ${SOCLE_MAIL_HUB_DELAI_MS:10000}
```

Activée, la fonction **refuse le démarrage** si `APP_ID`, `APP_URL_PUBLIQUE` ou
`HUB_URL_PUBLIQUE` manque (`[pack:mail] activation demandée mais configuration incomplète — manquent : …`).
La clé IAM peut manquer : l'app démarre, la page répond « Activation momentanément indisponible »
(503) et le lien reste valable.

Manifeste de l'app — la page est publique au proxy du Hub (extrait réel de TheIdeaBox) :

```json
"sso": {
  "mode": "required",
  "authIntegration": "soclehub-jwt",
  "publicPaths": ["/activation/**", "/health", "/mcp"]
}
```

## 5. Étape 3 — Émettre le lien et l'envoyer par le Hub

```java
package eu.lmvi.invitation;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.lmvi.socle.pack.mail.domain.activation.ActivationService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

@Component
public class Invitations {

    private final ActivationService activation;     // publié par MailPackConfiguration si enabled=true
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper json = new ObjectMapper();
    private final String hubUrl;
    private final String cleIam;

    public Invitations(ActivationService activation,
                       @Value("${socle.mail.hub.url}") String hubUrl,
                       @Value("${socle.mail.hub.api-key}") String cleIam) {
        this.activation = activation;
        this.hubUrl = hubUrl;
        this.cleIam = cleIam;
    }

    /**
     * Le droit d'inviter se contrôle AVANT cet appel : le service ne connaît pas les rôles métier.
     * @param role rôle COURT ; null = SOCLE_MAIL_ACTIVATION_ROLE_PAR_DEFAUT
     */
    public void inviter(String email, String tenant, String role, String auteur) throws Exception {
        ActivationService.LienEmis lien = activation.emettre(email, tenant, role, auteur);
        // Le jeton en clair ne vit que dans ce courriel : ni journal, ni base, ni réponse d'API.
        String corps = json.writeValueAsString(Map.of(
            "to", lien.email(),
            "template_key", "activation_compte",
            "variables", Map.of("lien", lien.lien(), "expire_le", lien.expireLe().toString())));
        HttpRequest req = HttpRequest.newBuilder(URI.create(hubUrl + "/api/actions/mail_worker/send_templated_email"))
            .timeout(Duration.ofSeconds(10))
            .header("Content-Type", "application/json")
            .header("X-Api-Key", cleIam)
            .POST(HttpRequest.BodyPublishers.ofString(corps))
            .build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() / 100 != 2 || r.body().contains("\"success\":false")) {
            throw new IllegalStateException("envoi du lien " + lien.id() + " refusé par le Hub (HTTP " + r.statusCode() + ")");
        }
    }
}
```

Le gabarit `activation_compte` se dépose une fois au Hub par `mail_worker.upsert_email_template`
(`template_key`, `subject`, corps avec la variable `lien`). Les refus d'émission lèvent
`RefusActivation` : `ADRESSE_INVALIDE`, `TENANT_INVALIDE` (1 à 30 caractères `[A-Za-z0-9_.-]`),
`ROLE_INTERDIT`.

`activation.annuaire().compteParAdresse(email)` dit, avant d'émettre, si l'adresse a déjà un compte.

## 6. Étape 4 — Ce que voit la personne

| Situation | Réponse de la page |
|---|---|
| lien ouvert, IAM joignable | 200, formulaire « choisir mon mot de passe » (adresse affichée) |
| mot de passe vide / trop court / confirmation différente | 422, formulaire avec le message |
| compte créé | **303** vers `<hub>/hub/login?redirect=<app>/` |
| compte existant | 200, « Votre compte existait déjà » — accès ouvert, mot de passe inchangé |
| lien déjà servi | 410, liens « Me connecter » / « Mot de passe oublié » |
| lien expiré | 410, « Mot de passe oublié » / « Me connecter » |
| lien inconnu | 404, les deux liens |
| IAM sans clé, en panne ou en refus | 503, « réessayez dans un moment » — lien conservé |
| plus de 10 requêtes/min depuis une IP | 429, `Retry-After: 60` |

Toutes les réponses portent `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Robots-Tag: noindex, nofollow` et une CSP `default-src 'none'`. La page n'appelle aucune
ressource externe.

---

## 7. Vérifier

```sql
SELECT x_id, email, tenant, role, expire_le, consomme_le, datas->>'compte_iam' AS compte
FROM schema_monapp.tr_activation ORDER BY x_id DESC LIMIT 5;
-- aucune colonne ne contient le jeton ni un mot de passe
```

Journaux attendus (aucun jeton) :
`[activation][emettre] lien 17 ouvert (tenant theideabox, rôle contributeur), expire le …`
`[activation][activer] lien 17 consommé — compte <id> (créé), rôle contributeur sur theideabox`

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Émettre puis ouvrir le lien | formulaire, adresse affichée |
| 2 | Poser un mot de passe de 12 caractères | 303 vers le login du Hub ; compte présent dans l'IAM avec `app:theideabox:contributeur` |
| 3 | Rouvrir le lien | 410 « déjà servi » |
| 4 | Deux `POST` simultanés | un compte, un seul `consomme_le` |
| 5 | Couper le Hub pendant le `POST` | 503 ; `consomme_le` reste NULL ; le lien resservira |
| 6 | `emettre(…, "admin", …)` | refus avant tout appel |
| 7 | 11 requêtes en une minute | la 11ᵉ en 429 |
| 8 | Journaux en TRACE sur `eu.lmvi` | ni jeton, ni empreinte, ni mot de passe, ni clé (test `CaptureJournaux` du pack) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `/activation/**` absent de `sso.publicPaths` | la personne est renvoyée au login, qu'elle ne peut pas passer | Déclarer la route publique dans le manifeste |
| Clé de **plateforme** au lieu d'une clé IAM | 401/403 de `/api/actions`, page en 503 | Clé IAM du compte de service, en `X-Api-Key` |
| `SOCLE_MAIL_HUB_URL=http://soclehub:8080` | délai dépassé, 503 | `soclehub` écoute sur **80** |
| Configuration incomplète avec `ENABLED=true` | démarrage refusé, liste des variables manquantes | Poser les trois variables obligatoires |
| Jeton dans le **chemin** de `GET /activation/{jeton}` | jeton visible dans les journaux d'accès du proxy, en DEBUG `org.springframework.web`, et dans les refus pendant un drain (`GracefulShutdownFilter`) | Le pack ne le journalise pas ; garder `org.springframework.web` au-dessus de DEBUG et traiter les journaux d'accès du proxy comme sensibles. Point ouvert du CHANGELOG |
| Envoyer le lien par `mail_send_worker` | adresse d'un utilisateur, quota consommé | Courriel applicatif → `mail_worker` du Hub |
| Attendre qu'un compte existant reçoive le nouveau mot de passe | mot de passe inchangé | Voulu : la page oriente vers « mot de passe oublié » |
| Rôle long (`app:theideabox:contributeur`) passé à `emettre` | refus | Rôle **court** ; le Hub préfixe |
| Plusieurs instances de l'app | limite de débit par IP comptée par instance | `LimiteurParCle` est en mémoire |
| IP du visiteur | toutes les requêtes comptées sous l'IP du proxy | `X-Forwarded-For` n'est cru que d'un pair listé dans `SOCLE_MAIL_ACTIVATION_PROXIES_DE_CONFIANCE` (réseaux privés par défaut) |
| Interopérabilité avec le vrai IAM | — | Les tests du pack éprouvent le client contre un serveur HTTP local qui imite la porte `/api/actions` ; l'essai contre l'IAM réel reste à faire en recette (CHANGELOG) |

---

## 10. Pour aller plus loin

- [[howto-08-creer-utilisateur-iam|HOWTO 08]] — comptes, rôles, clés IAM
- [[howto-34-gerer-les-tenants-iam|HOWTO 34]] — le tenant passé à `emettre`
- [[howto-09-configurer-sso-multi-app|HOWTO 09]] — modes SSO, chemins publics
- [[howto-mail-06-relever-une-boite-applicative|MAIL-06]] — d'où vient souvent l'adresse invitée
