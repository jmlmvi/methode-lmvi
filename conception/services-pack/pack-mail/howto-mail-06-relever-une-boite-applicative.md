# HOWTO MAIL-06 — Relever la boîte d'une application et traiter chaque courriel reçu

**Niveau :** Confirmé
**Cible :** application V005 qui reçoit des demandes par courriel (idées, tickets, candidatures…)
**Versions vérifiées au code (2026-10-28) :** `socle-pack-mail` **1.4.0** — fonction **nouvelle en 1.4.0**, présente dans la copie de travail, **non commitée** (base `24bc50a`) · socle **5.9.5** · `jakarta.mail` 2.0.1 · tests GreenMail 2.0.1
**Prérequis :** [[howto-mail-01-integrer-le-pack|MAIL-01]] ; une boîte pour l'application sur le James du Hub ([[howto-11-configurer-james-mail|HOWTO 11]])
**Temps estimé :** 40 min

---

## 1. Contexte

Une application a une adresse — `theideabox@thesocle.net` — et veut traiter ce qui y arrive. Le pack
relève la boîte toutes les 5 s, remet chaque **non-lu** à l'application par un port, et ne marque le
message lu que si l'application l'a pris en charge ou explicitement écarté. Aucun message n'est
perdu parce que son traitement a échoué.

Cas de référence : **APP-98 TheIdeaBox** (chantier P-2, décision D-P12) — l'idée envoyée par
courriel devient une fiche.

| Qui fait quoi | |
|---|---|
| **Hub** — `james_worker` | héberge la boîte, DKIM, MX, quotas ; garde son mot de passe dans Vault |
| **Hub** — `mail_attachment_worker` | scanne les pièces jointes de toutes les boîtes James ([[howto-21-clamav-mail-scan\|HOWTO 21]]) |
| **pack** — `boite_applicative_worker` + `imap_gateway_worker` | relève, remet, marque |
| **application** — `ReceptionCourrier` | décide : prendre, ignorer, réessayer ; garantit l'idempotence |
| **Hub** — `mail_worker` | envoie l'accusé de réception de l'application |

`mail_attachment_worker` et le pack relèvent tous deux la boîte en lecture sans marquer : ils ne se
gênent pas. Le pack **ne lit aucune pièce jointe** et n'en transmet aucune.

---

## 2. Architecture

```
 soclehub-james:993 (IMAPS)  ◄── boîte theideabox@thesocle.net
        ▲
        │  imap_gateway_worker (AbstractGatewayWorker)
        │   disjoncteur 5 échecs / 60 s · 2 reprises 500 ms→2 s · 5 req/s
        │   refus d'authentification : jamais rejoué
        │
 boite_applicative_worker — cycle toutes les SOCLE_MAIL_BOITE_INTERVALLE_MS (5 000)
   1. EXAMINE (READ_ONLY) + recherche des non-lus, BODY.PEEK      ← lire ne marque jamais
      au plus SOCLE_MAIL_BOITE_LOT (20) messages, hors mis de côté
   2. pour chaque CourrierRecu → ReceptionCourrier.recevoir() (l'application)
        ACCEPTE ─┐
        IGNORE  ─┴─► à marquer
        A_REESSAYER / exception / null ─► mis de côté SOCLE_MAIL_BOITE_REESSAI_APRES_MS (60 000)
   3. seconde connexion READ_WRITE : \Seen par UID, si UIDVALIDITY inchangée
```

Garantie : **au moins une fois**. Un arrêt entre le verdict et le marquage fait représenter le
message : l'application dédoublonne sur `Message-ID`.

`CourrierRecu` (record) : `uid`, `uidValidity`, `messageId`, `expediteur` (adresse), `nomExpediteur`,
`objet`, `corpsTexte` (**entier** ; à défaut de partie texte, le HTML converti en texte — alors
`corpsDepuisHtml = true`), `date`, `autoSubmitted`, `precedence`, `listId`, `returnPath`. Aucun autre
en-tête.

---

## 3. Étape 1 — Créer la boîte sur le Hub et garder son secret

```bash
# Boîte de l'application (James du Hub)
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/james_worker/create_mailbox \
  -d '{"user":"theideabox","domain":"thesocle.net","quota_mb":1024}'

# Mot de passe généré et rangé par le Hub dans Vault : soclehub/james/users/theideabox@thesocle.net
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/james_worker/set_mailbox_password \
  -d '{"user":"theideabox","domain":"thesocle.net"}'
```

La réponse de `set_mailbox_password` montre le mot de passe **une seule fois** ; il reste lisible
dans Vault (clé `password`). Il parvient à l'application par variable d'environnement.

## 4. Étape 2 — Configurer la relève

```bash
SOCLE_MAIL_BOITE_HOTE=soclehub-james            # vide ou absent = fonction absente
SOCLE_MAIL_BOITE_PORT=993
SOCLE_MAIL_BOITE_SSL=true
SOCLE_MAIL_BOITE_UTILISATEUR=theideabox@thesocle.net
SOCLE_MAIL_BOITE_MOT_DE_PASSE=<Vault soclehub/james/users/theideabox@thesocle.net, clé password>
SOCLE_MAIL_BOITE_DOSSIER=INBOX
SOCLE_MAIL_BOITE_SSL_TRUST=soclehub-james       # certificat interne de James accepté
SOCLE_MAIL_BOITE_VERIFIER_NOM_SERVEUR=false     # le certificat porte le nom PUBLIC, pas « soclehub-james »
```

Équivalent `application.yml` explicite :

```yaml
socle:
  mail:
    boite:
      hote: ${SOCLE_MAIL_BOITE_HOTE:}
      port: ${SOCLE_MAIL_BOITE_PORT:993}
      ssl: ${SOCLE_MAIL_BOITE_SSL:true}
      utilisateur: ${SOCLE_MAIL_BOITE_UTILISATEUR:}
      mot-de-passe: ${SOCLE_MAIL_BOITE_MOT_DE_PASSE:}
      dossier: ${SOCLE_MAIL_BOITE_DOSSIER:INBOX}
      ssl-trust: ${SOCLE_MAIL_BOITE_SSL_TRUST:}
      verifier-nom-serveur: ${SOCLE_MAIL_BOITE_VERIFIER_NOM_SERVEUR:true}
      delai-connexion-ms: ${SOCLE_MAIL_BOITE_DELAI_CONNEXION_MS:10000}
      delai-lecture-ms: ${SOCLE_MAIL_BOITE_DELAI_LECTURE_MS:20000}
      intervalle-ms: ${SOCLE_MAIL_BOITE_INTERVALLE_MS:5000}
      lot: ${SOCLE_MAIL_BOITE_LOT:20}
      reessai-apres-ms: ${SOCLE_MAIL_BOITE_REESSAI_APRES_MS:60000}
```

Les trois workers n'existent que si `hote` est **non vide** (condition `BoiteApplicativeDesignee`,
qui traite une valeur vide comme absente — un gabarit qui pose `SOCLE_MAIL_BOITE_HOTE=` ne crée rien).

## 5. Étape 3 — Implémenter `ReceptionCourrier`

Table de l'application, avec l'unicité qui rend la livraison idempotente :

```sql
CREATE TABLE IF NOT EXISTS schema_monapp.tr_demande_recue (
    x_id           BIGSERIAL PRIMARY KEY,
    x_dateCreated  TIMESTAMPTZ NOT NULL DEFAULT now(),
    message_id     VARCHAR(998) NOT NULL,
    expediteur     VARCHAR(320),
    objet          TEXT,
    corps          TEXT NOT NULL,
    recu_le        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tr_demande_recue_message_id
    ON schema_monapp.tr_demande_recue (message_id);
```

```java
package eu.lmvi.reception;

import eu.lmvi.socle.pack.mail.domain.model.CourrierRecu;
import eu.lmvi.socle.pack.mail.port.ReceptionCourrier;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.util.Optional;

@Component
public class ReceptionDemandes implements ReceptionCourrier {

    private static final Logger log = LogManager.getLogger(ReceptionDemandes.class);

    private final JdbcTemplate jdbc;
    private final String adresseApplication;

    public ReceptionDemandes(JdbcTemplate jdbc,
                             @Value("${socle.mail.boite.utilisateur}") String adresseApplication) {
        this.jdbc = jdbc;
        this.adresseApplication = adresseApplication;
    }

    @Override
    public Verdict recevoir(CourrierRecu c) {
        // Courrier automatique (répondeur, liste, retour d'erreur, sa propre adresse) : on n'en veut pas.
        Optional<String> auto = c.motifAutomatique(adresseApplication);
        if (auto.isPresent()) {
            log.info("[reception] uid={} ignoré : {}", c.uid(), auto.get());
            return Verdict.IGNORE;
        }
        // Sans Message-ID, pas de dédoublonnage possible : clé de repli stable par boîte.
        String cle = c.messageId() != null ? c.messageId() : "uid:" + c.uidValidity() + ":" + c.uid();
        try {
            int n = jdbc.update("""
                INSERT INTO schema_monapp.tr_demande_recue (message_id, expediteur, objet, corps, recu_le)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (message_id) DO NOTHING""",
                cle, c.expediteur(), c.objet(), c.corpsTexte(),
                c.date() == null ? null : Timestamp.from(c.date()));
            if (n == 0) log.info("[reception] uid={} déjà reçu — doublon", c.uid());
            return Verdict.ACCEPTE;          // reçu maintenant ou avant : dans les deux cas, pris en charge
        } catch (DataAccessException e) {
            log.warn("[reception] uid={} base indisponible ({}) — à réessayer",
                     c.uid(), e.getClass().getSimpleName());
            return Verdict.A_REESSAYER;
        }
    }
}
```

`recevoir` est appelé sur le fil de relève, un message à la fois : il doit rendre la main vite. Un
traitement long (analyse par LLM, accusé) se fait **après**, à partir de la table — par exemple un
worker de l'application qui lit les lignes nouvelles. Ne pas journaliser le corps.

---

## 6. Vérifier

```bash
curl -s https://monapp.thesocle.net/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"boite_applicative_worker__get_status","arguments":{}}}'
```

```json
{"actif":true,"raison_inactif":"","boite":"theideabox@thesocle.net@soclehub-james/INBOX",
 "intervalle_ms":5000,"derniere_releve_reussie":"2026-10-28T09:12:05Z","releves_reussies":731,
 "releves_echouees":0,"non_lus_vus":0,"messages_remis":12,"acceptes":11,"ignores":1,
 "a_reessayer":0,"en_attente_de_reessai":0,"erreurs_application":0,"marques_lus":12,
 "marquages_echoues":0,"derniere_erreur":""}
```

Journal au démarrage :
`[worker:boite_applicative_worker][step:initialize] relève de BoiteApplicative[theideabox@thesocle.net@soclehub-james:993/INBOX, ssl=true, motDePasse=***] toutes les 5000 ms, lot de 20`.
L'état du disjoncteur IMAP se lit dans les statistiques de `imap_gateway_worker`.

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Envoyer un courriel à la boîte | ligne dans `tr_demande_recue` en ≤ 5 s, message marqué lu |
| 2 | Réponse automatique (`Auto-Submitted: auto-replied`) | `ignores` +1, marqué lu, aucune ligne |
| 3 | Base de l'app arrêtée | `a_reessayer` +1, message **non lu**, représenté ~60 s après le retour |
| 4 | Redémarrer entre verdict et marquage | message représenté, `ON CONFLICT` l'absorbe |
| 5 | Mauvais mot de passe | `releves_echouees` monte, **un seul** essai par relève, disjoncteur ouvert après 5 échecs |
| 6 | Pas de bean `ReceptionCourrier` | ERROR au démarrage « aucune implémentation de ReceptionCourrier publiée », `actif: false` |
| 7 | Message HTML seul | `corpsTexte` lisible, `corpsDepuisHtml: true` |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `VERIFIER_NOM_SERVEUR` laissé à `true` vers `soclehub-james` | échec TLS à chaque relève | `ssl.trust` fait accepter le certificat, **pas son nom** : `SOCLE_MAIL_BOITE_VERIFIER_NOM_SERVEUR=false` |
| App hors du réseau `docker_soclehub-net` | `soclehub-james` ne résout pas | Joindre le réseau du Hub, ou viser le nom public de James avec vérification du nom |
| Hôte posé, mot de passe absent | ERROR « boîte désignée mais relève DÉSACTIVÉE — configuration incomplète : SOCLE_MAIL_BOITE_MOT_DE_PASSE » | Injecter le secret ; l'app démarre quand même, worker désactivé |
| `ReceptionCourrier` non idempotent | doublons après un redémarrage | Unicité sur `Message-ID` (au moins une fois, pas exactement une fois) |
| Traitement long dans `recevoir` | relève suivante retardée, lot bloqué | Enregistrer et rendre la main ; traiter ensuite |
| Rendre `A_REESSAYER` pour un message définitivement invalide | il revient toutes les minutes, sans fin | `IGNORE` (et journaliser) pour ce qui ne passera jamais |
| Changer `SOCLE_MAIL_BOITE_INTERVALLE_MS` à chaud | pas d'effet | Lu au démarrage (planification à taux fixe), plancher 1 000 ms |
| Message lu dans un client mail avant la relève | jamais remis | Le pack ne relève que les **non-lus** : réserver la boîte à l'application |
| UIDVALIDITY change (boîte recréée) | WARN, rien n'est marqué, messages représentés | Attendu ; l'idempotence absorbe |
| Attendre les pièces jointes | absentes de `CourrierRecu` | Voulu ; le scan reste au Hub (HOWTO 21) |
| Ordre des protections de la passerelle | reprises **à l'extérieur** du disjoncteur, contraire à UC-RES-04 | Suit `AbstractGatewayWorker.executeProtected` ; reprises bornées à 2. Point ouvert remonté au socle |

---

## 9. Pour aller plus loin

- [[howto-11-configurer-james-mail|HOWTO 11]] — la boîte côté Hub
- [[howto-21-clamav-mail-scan|HOWTO 21]] — antivirus des pièces jointes, même boîte
- [[howto-mail-07-lien-dactivation-de-compte|MAIL-07]] — ouvrir un compte à l'expéditeur
- `APP-98-TheIdeaBox/docs/chantier/` — décisions D-P11 / D-P12
