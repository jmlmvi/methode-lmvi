# HOWTO MAIL-05 — Épurer des messages stockés (citations, en-têtes recopiés, signatures)

**Niveau :** Confirmé
**Cible :** application V005 qui stocke le corps de courriels en PostgreSQL
**Versions vérifiées au code (2026-10-28) :** `socle-pack-mail` **1.5.0** (commit `a396ada`, tag `v1.5.0`) · règles d'épuration **version 1** (`LecteurMessage.VERSION`) · jsoup 1.17.2 · socle **5.10.0** · Spring Boot 4.1.2. ⚠️ En 1.4.0, `mail_epuration_worker` n'était jamais créé dans une app (condition évaluée avant le DataSource) : corrigé en 1.5.0
**Prérequis :** [[howto-mail-01-integrer-le-pack|MAIL-01]] ; une table de messages dont l'app remplit le corps texte et/ou HTML
**Temps estimé :** 30 min

---

## 1. Contexte

Un fil de discussion recopie sous chaque réponse tout l'historique, les en-têtes « De : … Envoyé :
… » et les signatures. Pour afficher, chercher ou faire lire un message à un LLM, seul compte **ce
que l'auteur a écrit**. `mail_epuration_worker` le calcule et l'écrit dans des colonnes **dérivées** :
le corps d'origine n'est jamais modifié.

C'est la fonction la plus découplée du pack : elle ne dépend d'**aucun schéma** du pack. Elle
travaille sur la table que l'application décrit (« carte »), ou sur le stockage que l'application
fournit (port `DepotMessages`).

| Ce que le pack fournit | Ce que l'application fournit |
|---|---|
| le moteur : règles T1..T5 (texte), H1..H9 (HTML, jsoup), garde-fous G1..G4 | les corps de messages (le pack ne les importe pas : MAIL-02 n'écrit pas de corps) |
| l'action de lot bornée, rejouable, versionnée | la carte des colonnes, ou son propre `DepotMessages` |
| `SignatureParser` pour tirer entreprise et fonction de la signature isolée | le contexte tenant si ses tables sont sous RLS (`FournisseurTenant`) |

Ce qui est écrit, par message :

| Colonne (défaut) | Contenu |
|---|---|
| `corps_epure` | ce que l'auteur a écrit |
| `signature_epuree` | la signature, extraite (pas jetée) |
| `epuration_regle` | règle qui a coupé : `T1`..`T5`, `H1`..`H9` ; `G1` écarté (trop retiré), `G2` exception |
| `epuration_epure` | vrai si le corps a été réduit |
| `epuration_confiance_signature` | 1.0 séparateur RFC 3676 `-- `, 0.6 heuristique, 0 aucune |
| `epuration_version`, `epuration_date`, `epuration_taille_origine`, `epuration_taille_finale` | traçabilité et rejeu |

La partie citée n'est pas stockée : elle se reconstruit depuis l'original.

---

## 2. Architecture

```
 epurer_messages(limite?, version_cible?, forcer?, tenant?, user_id?)
        │  (action SYNC, délai 20 min ; rend la main après 25 s, le lot continue)
        ▼
 EpurationWorker ── un seul lot à la fois (sinon « deja_en_cours »)
        │  fil dédié « mail-epuration »
        ▼
 FournisseurTenant.executerDans(tenant, user, …)     ← défaut : mono-tenant, n'établit rien
        │
        ▼
 DepotMessages.aEpurer(limite, version, forcer)      ← défaut : DepotMessagesJdbc + CarteMessages
        │    WHERE <actif> AND (<version> IS NULL OR <version> < ?) ORDER BY <id> LIMIT ?
        ▼
 LecteurMessage.depuis(corpsTexte, corpsHtml) → Lecture
        ▼
 DepotMessages.enregistrer(id, lecture, version, date)   (n'écrit que colonnesEcrites())
```

---

## 3. Étape 1 — Décrire la table (aucune ligne de Java)

Les défauts décrivent la table `tr_email_import` du pack après `V004`. Une application n'indique que
ce qui diverge chez elle :

```yaml
socle:
  mail:
    schema: schema_monapp
    epuration:
      enabled: true                     # worker publié (il reste passif)
      heuristique-signature: true       # détection SANS séparateur « -- » : faillible
      proportion-minimale: 0.15         # G1 — en dessous, le nettoyage est écarté
      carte:
        table: tr_message               # défaut tr_email_import
        id: x_id
        corps-texte: corps_texte
        corps-html: corps_html
        corps-epure: corps_epure
        signature: signature_epuree
        version: epuration_version
        regle: epuration_regle
        epure: epuration_epure
        date: epuration_date
        taille-origine: epuration_taille_origine
        taille-finale: epuration_taille_finale
        confiance-signature: epuration_confiance_signature
        actif: x_active                 # "" = pas de filtre (traite aussi les lignes inactives)
```

La carte est **validée au démarrage** : un nom de colonne invalide fait échouer le démarrage, pas le
premier lot. Les colonnes doivent exister ; sur une table de l'application, les créer comme le fait
`V004` :

```sql
ALTER TABLE schema_monapp.tr_message
    ADD COLUMN IF NOT EXISTS corps_epure                   TEXT,
    ADD COLUMN IF NOT EXISTS signature_epuree              TEXT,
    ADD COLUMN IF NOT EXISTS epuration_version             INTEGER,
    ADD COLUMN IF NOT EXISTS epuration_regle               VARCHAR(10),
    ADD COLUMN IF NOT EXISTS epuration_epure               BOOLEAN,
    ADD COLUMN IF NOT EXISTS epuration_date                TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS epuration_taille_origine      INTEGER,
    ADD COLUMN IF NOT EXISTS epuration_taille_finale       INTEGER,
    ADD COLUMN IF NOT EXISTS epuration_confiance_signature REAL;
CREATE INDEX IF NOT EXISTS idx_tr_message_epuration_version
    ON schema_monapp.tr_message (epuration_version);
```

Mêmes types que `V004__epuration_des_messages.sql` du pack.

## 4. Étape 2 — Tables sous RLS : publier un `FournisseurTenant`

Sans contexte, un lot lancé par MCP sur des tables filtrées par RLS **ne voit aucune ligne** et
rapporte « 0 traité » — un silence qui ressemble à « tout est à jour ». L'application publie son
fournisseur ; le `@ConditionalOnMissingBean` du pack s'efface.

Les variables de session doivent vivre sur **la connexion du lot** : on ouvre donc une transaction
autour du travail (le `JdbcTemplate` du dépôt reprend la connexion liée au fil par le gestionnaire de
transactions sur le même `DataSource`), et `set_config(…, true)` les limite à cette transaction.

```java
package eu.lmvi.tenant;

import eu.lmvi.socle.pack.mail.port.FournisseurTenant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.function.Supplier;

@Component
public class TenantDuLot implements FournisseurTenant {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public TenantDuLot(JdbcTemplate jdbc, PlatformTransactionManager tm) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(tm);
    }

    /** Hors requête (MCP, poller) il n'y a pas de tenant courant : l'appelant le passe en paramètre. */
    @Override
    public String tenantCourant() {
        return null;
    }

    @Override
    public <T> T executerDans(String tenant, String utilisateur, Supplier<T> travail) {
        return tx.execute(statut -> {
            // is_local = true : effacé à la fin de la transaction, ne fuit pas sur le fil suivant
            jdbc.queryForObject("SELECT set_config('app.current_tenant_id', ?, true)",
                                String.class, tenant == null ? "" : tenant);
            jdbc.queryForObject("SELECT set_config('app.current_user_id', ?, true)",
                                String.class, utilisateur == null ? "" : utilisateur);
            return travail.get();
        });
    }
}
```

Adapter les noms de variables (`app.current_tenant_id`, `app.current_user_id`) à ceux que lisent
**les politiques de l'application** : le pack n'en crée aucune.

## 5. Étape 3 — Lancer le lot

```bash
curl -s https://monapp.thesocle.net/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"mail_epuration_worker__epurer_messages",
                 "arguments":{"limite":500,"tenant":"lmvi","user_id":"alice"}}}'
```

```json
{"statut":"termine","traites":500,"epures":47,"ecartes":453,"vides":0,"echecs":0,
 "deja_a_jour":0,"restants":17675,"version_cible":1,"duree_ms":8123}
```

| Paramètre | Défaut | Rôle |
|---|---|---|
| `limite` | 500 (max 5 000) | messages traités au plus par appel |
| `version_cible` | `LecteurMessage.VERSION` (1) | ne traite que les lignes de version absente ou inférieure |
| `forcer` | `false` | retraite même les lignes à jour — rattrapage après incident seulement |
| `tenant`, `user_id` | `FournisseurTenant` | contexte du lot |

Rattrapage : rappeler l'action tant que `restants > 0`. Au-delà de 25 s, la réponse est
`{"statut":"en_cours"}` et le lot continue ; suivre avec `mail_epuration_worker__epuration_status`.

## 6. Étape 4 — Exploiter la signature isolée (facultatif)

`SignatureParser` tire **entreprise** et **fonction** d'une signature. Il est dans le domaine du
pack, mais **aucun composant du pack ne l'appelle** : c'est à l'application de le brancher là où
elle tient ses contacts.

```java
package eu.lmvi.contacts;

import eu.lmvi.socle.pack.mail.domain.contact.SignatureParser;
import eu.lmvi.socle.pack.mail.domain.epuration.LecteurMessage;
import eu.lmvi.socle.pack.mail.domain.epuration.Lecture;
import org.springframework.stereotype.Component;

@Component
public class EnrichissementContact {

    private final LecteurMessage lecteur;              // bean publié par MailPackConfiguration
    private final SignatureParser signatures = new SignatureParser();

    public EnrichissementContact(LecteurMessage lecteur) {
        this.lecteur = lecteur;
    }

    /** Entreprise et fonction de l'AUTEUR : on part de la signature déjà isolée par l'épuration. */
    public SignatureParser.Signature depuisMessage(String corpsTexte, String corpsHtml) {
        Lecture l = lecteur.depuis(corpsTexte, corpsHtml);
        return signatures.depuis(l);                   // vide() si rien de fiable
    }
}
```

Partir de la `Lecture` évite d'attribuer à l'expéditeur la signature de son correspondant, restée
dans la partie citée.

## 7. Variante — stockage hors carte

Épuration rangée en JSONB, ou dans une table séparée : publier son propre
`eu.lmvi.socle.pack.mail.port.DepotMessages` (`aEpurer`, `enregistrer`, `dejaAJour`, `restants`).
Le dépôt JDBC du pack ne se crée plus. Contrat : ne jamais écrire le corps d'origine, et rendre liste
vide ou zéro plutôt qu'une exception sur une ligne absente.

---

## 8. Vérifier

```sql
SELECT epuration_regle, count(*), round(avg(epuration_taille_finale::numeric
       / NULLIF(epuration_taille_origine,0)), 2) AS part_gardee
FROM schema_monapp.tr_message WHERE epuration_version = 1 GROUP BY 1 ORDER BY 2 DESC;
```

## 9. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Lot de 500 | `traites` = 500 (ou moins), colonnes dérivées remplies, corps d'origine intacts |
| 2 | Relancer | `traites` = 0, `deja_a_jour` augmente |
| 3 | `forcer: true` | les mêmes lignes retraitées |
| 4 | Deux appels simultanés | le second rend `statut: deja_en_cours` |
| 5 | Tables sous RLS, sans `FournisseurTenant` | `traites: 0` alors que des lignes existent — le piège §4 |
| 6 | Journaux | aucun contenu de message, seulement identifiants, longueurs, règles |

---

## 10. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Épurer la table de l'import du pack | `vides` partout | L'import n'écrit aucun corps : l'épuration vise une table dont **l'application** remplit le corps |
| RLS sans contexte | « 0 traité », `restants: 0` | `FournisseurTenant` qui pose les variables dans une transaction (§4) |
| `SET` hors transaction | variables perdues entre deux requêtes | `set_config(…, true)` dans un `TransactionTemplate` |
| Colonne mal nommée dans la carte | démarrage refusé | Voulu : corriger la carte |
| `actif: ""` | lignes désactivées épurées aussi | Choix conscient pour une table sans `x_active` |
| Lot appelé sans borne | délai MCP | `limite` plafonnée à 5 000 ; rappeler l'action |
| `forcer` en routine | retraitement complet à chaque appel | Réservé au rattrapage |
| Croire que la signature alimente `db_contact` (README 1.2.0) | entreprise/fonction jamais remplies par le pack | Brancher `SignatureParser` côté application (§6) |
| `SOCLE_MAIL_EPURATION_ENABLED=false` | plus de worker | Voulu, pour une app qui n'épure pas |

---

## 11. Pour aller plus loin

- `socle-pack-Mail/docs/ARCHITECTURE-HEXAGONALE.md` — les deux niveaux de découplage
- `socle-pack-Mail/docs/CONVERGENCE-SDR2.md` — origine du moteur (APP-18 SDR2)
- [[howto-mail-06-relever-une-boite-applicative|MAIL-06]] — une autre conversion de corps (`TexteHtml`), qui ne retire rien
