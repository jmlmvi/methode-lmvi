# HOWTO MAIL-04 — Générer un courriel contextualisé par IA (avec socle-pack-ai)

**Niveau :** Confirmé
**Cible :** application V005 qui embarque `socle-pack-mail` et `socle-pack-ai`
**Versions vérifiées au code (2026-10-28) :** `socle-pack-mail` **1.5.0** (commit `a396ada`, tag `v1.5.0`) · `socle-pack-ai` **2.8.0** · socle **5.10.0** · Spring Boot 4.1.2 — comportement inchangé depuis 1.4.0
**Prérequis :** [[howto-mail-01-integrer-le-pack|MAIL-01]], [[howto-ai-01-integrer-le-pack|HOWTO AI-01]] (un fournisseur LLM configuré), un référentiel contacts ([[howto-mail-02-importer-une-boite-utilisateur|MAIL-02]])
**Temps estimé :** 30 min

---

## 1. Contexte

`mail_generation_worker` rédige un courriel **pour un contact précis** du référentiel, à propos d'un
contenu (article, événement, offre), dans le ton de la relation. Il rend aussi une **explication**
(pourquoi ce contact, pourquoi ce contenu, quel ton) et un score de pertinence. Le brouillon est
rangé dans `tr_mail_propose` pour validation humaine, puis envoyé par MAIL-03.

Le pack ne parle à aucun LLM lui-même : il assemble le contexte et délègue à
`eu.lmvi.socle.pack.ai.GenerationWorker.generateOne(partition, promptId, contexte, options)`. Le
choix du fournisseur, la cascade de repli, les quotas et la résilience appartiennent au pack-ai.

> **Recouvrement avec le Hub.** Le Hub expose une passerelle IA (`agentia_worker`,
> [[howto-27-configurer-agentia-gateway|HOWTO 27]]). Le pack-ai peut la viser comme fournisseur ; le
> pack-mail n'en sait rien et n'a rien à configurer pour cela.

---

## 2. Architecture

```
 generate_mail(user_id, contact_id, content_ref, slots?, options?)
        │
        ▼
 MailContextBuilder.build()            (lit via CarteTables)
   contact   ← db_contact       WHERE x_id = ? AND owner_user_id = ?
   history   ← tr_email_import  N derniers sujets (SOCLE_MAIL_GENERATION_MAX_HISTORY_ENTRIES = 5)
   from_*, language, tone ← z_mail_config (ton du contact, sinon preferred_tone)
   content.*, slots_section
        │
        ▼
 GenerationWorker (pack-ai) — prompt « contextual_mail » (z_config_ia du schéma IA)
        │  texte du LLM
        ▼
 extraction du premier « { » au dernier « } » → subject, body, explanation,
                                                matching_score, matching_factors
        │
        ▼
 INSERT tr_mail_propose (status = 'proposed', body = body_original)   ← sauf « preview »
```

Variables offertes au prompt : `{contact.first_name}`, `{contact.last_name}`, `{contact.company}`,
`{contact.job_title}`, `{contact.civility}`, `{contact.proximity_score}`,
`{contact.exchange_count}`, `{history}`, `{from_name}`, `{from_email}`, `{language}`, `{tone}`,
`{content.title}`, `{content.summary}`, `{content.url}`, `{slots_section}`.

---

## 3. Étape 1 — Poser le prompt là où le pack-ai le lit

Le pack-ai lit ses prompts dans **`${SOCLE_AI_SCHEMA}.z_config_ia`**
(`PromptResolverService`, `active = true AND x_active = true`). La migration `V999` du pack-mail,
elle, écrit dans **`public.z_config_ia`**, et seulement si une table `z_config_ia` est visible dans
`information_schema` au moment où elle passe. Trois cas :

| Situation | Effet de `V999` |
|---|---|
| `SOCLE_AI_SCHEMA=public`, tables IA déjà créées | prompt posé — rien à faire |
| tables IA pas encore créées quand `V999` passe (base neuve, pack-mail balayé avant pack-ai) | rien n'est posé, **mais `V999` est inscrite comme jouée** : elle ne repassera jamais |
| `SOCLE_AI_SCHEMA` ≠ `public`, tables IA déjà créées | le test trouve la table, l'`INSERT` vise `public.z_config_ia` qui n'existe pas → migration en échec → **l'application ne démarre pas** |

La voie déterministe : l'application pose le prompt elle-même dans le schéma IA et neutralise `V999`.
Script à joindre à l'`initScript` du manifeste (ou à jouer une fois, avant le premier démarrage avec
le pack-mail) :

```sql
-- 1. V999 du pack-mail considérée comme jouée : le prompt est posé ci-dessous, au bon endroit.
--    Le runner journalisera « checksum mismatch on V999__seed_prompt.sql — skipping » (WARN, sans effet).
CREATE TABLE IF NOT EXISTS public.z_pack_migrations (
    pack_id VARCHAR(100) NOT NULL, version VARCHAR(10) NOT NULL, script_name VARCHAR(200) NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now(), checksum VARCHAR(64), PRIMARY KEY (pack_id, version));
INSERT INTO public.z_pack_migrations (pack_id, version, script_name, checksum)
VALUES ('socle-pack-mail', 'V999', 'V999__seed_prompt.sql', 'pose-par-l-application')
ON CONFLICT (pack_id, version) DO NOTHING;
```

Puis, une fois les tables du pack-ai créées (après le premier démarrage, ou dans une migration de
l'application) — même texte que `V999`, schéma IA explicite :

```sql
INSERT INTO schema_monapp.z_config_ia
    (x_partition, prompt_id, version, content, active, temperature, max_tokens, description, x_createdBy, datas)
SELECT NULL, 'contextual_mail', '1.0.0',
$prompt$Tu rédiges un email professionnel en {language} de la part de {from_name} <{from_email}>.

Destinataire : {contact.civility} {contact.first_name} {contact.last_name}
Entreprise : {contact.company}
Fonction : {contact.job_title}
Ton requis : {tone} (vouvoiement ou tutoiement)
Proximité : score {contact.proximity_score}/100, {contact.exchange_count} échanges précédents

Prétexte de contact :
Titre : {content.title}
Résumé : {content.summary}
Source : {content.url}

Historique récent (5 derniers échanges, sujets uniquement) :
{history}

{slots_section}

Rédige un email court (5-8 phrases max), naturel, qui donne envie de répondre. Commence par une accroche personnalisée (pas "Bonjour" seul). Termine par une question ouverte ou une proposition d'action concrète. Ne signe pas (la signature sera ajoutée).

Retourne un JSON strict :
{
  "subject": "...",
  "body": "...",
  "explanation": "pourquoi ce contact + pourquoi ce contenu + ton choisi",
  "matching_score": 0-100,
  "matching_factors": {"tags_match": [...], "proximity": ..., "sector": ...}
}$prompt$,
       true, 0.6, 1024, 'Génération de mail contextualisé (socle-pack-mail)', 'system', '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM schema_monapp.z_config_ia
                  WHERE prompt_id = 'contextual_mail' AND x_partition IS NULL AND version = '1.0.0');
```

Le pack-ai garde ses prompts en cache : redémarrer l'app (ou recharger le cache par le moyen que
documente [[howto-ai-01-integrer-le-pack|AI-01]]) après la pose.

Réglages côté pack-mail :

```yaml
socle:
  mail:
    generation:
      prompt-id: ${SOCLE_MAIL_GENERATION_PROMPT_ID:contextual_mail}
      max-history-entries: ${SOCLE_MAIL_GENERATION_MAX_HISTORY_ENTRIES:5}
      temperature: ${SOCLE_MAIL_GENERATION_TEMPERATURE:0.6}
      max-tokens: ${SOCLE_MAIL_GENERATION_MAX_TOKENS:1024}
```

## 4. Étape 2 — Générer

```bash
curl -s https://monapp.thesocle.net/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"mail_generation_worker__generate_mail",
                 "arguments":{"user_id":"alice","contact_id":42,
                   "content_ref":{"type":"article","id":1001,
                     "title":"Nouvelle levée de fonds chez ACME",
                     "summary":"ACME lève 10 M€ pour accélérer en Europe…",
                     "url":"https://exemple.org/acme"},
                   "slots":["Mardi 22 avril à 14h","Mercredi 23 avril à 10h30"]}}}'
```

Réponse (dans `content[0].text`) :

```json
{"mail_propose_id":88,"subject":"…","body":"…","explanation":"…",
 "matching_score":87,"matching_factors":{…},
 "tokens_input":812,"tokens_output":231,"model":"…","latency_ms":2140}
```

| Action | Rôle |
|---|---|
| `generate_mail` | une génération, persistée dans `tr_mail_propose` |
| `preview` | même calcul, **rien n'est écrit** ni compté |
| `generate_batch` | `user_id` + `proposals: [{contact_id, content_ref, slots?}]` → `{success, failed, total, mail_propose_ids}` |
| `get_status` | générations, jetons consommés, `prompt_id` |

`options` (facultatif) écrase `temperature`, `max_tokens`, et tout ce que le pack-ai accepte
(`provider`, `model`) — en `generate_mail` seulement : `generate_batch` n'en tient pas compte.

## 5. Étape 3 — Valider puis envoyer

L'utilisateur relit le brouillon ; l'application garde l'original et écrit la version corrigée :

```java
package eu.lmvi.mail;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class BrouillonsDepot {

    private final JdbcTemplate jdbc;

    public BrouillonsDepot(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** body_original garde le texte du LLM : l'écart mesure ce que l'humain a corrigé. */
    public int corriger(long idPropose, String utilisateur, String sujet, String corps) {
        return jdbc.update("""
            UPDATE schema_monapp.tr_mail_propose
               SET subject = ?, body = ?, x_dateUpdated = now()
             WHERE x_id = ? AND owner_user_id = ? AND status = 'proposed'""",
            sujet, corps, idPropose, utilisateur);
    }
}
```

Puis `mail_send_worker__send_mail` avec `"id_mail_propose": 88` : à l'envoi réussi, la ligne passe
en `status = 'sent'` ([[howto-mail-03-envoyer-depuis-la-boite-utilisateur|MAIL-03]]).

---

## 6. Vérifier

```sql
SELECT x_id, status, matching_score, model, tokens_input, tokens_output, prompt_version
FROM schema_monapp.tr_mail_propose WHERE owner_user_id = 'alice' ORDER BY x_id DESC LIMIT 5;

SELECT prompt_id, version, active FROM schema_monapp.z_config_ia WHERE prompt_id = 'contextual_mail';
```

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `preview` sur un contact existant | sujet + corps + explication ; aucune ligne `tr_mail_propose` |
| 2 | `generate_mail` | ligne `proposed`, `body = body_original` |
| 3 | `contact_id` d'un autre utilisateur | échec « Contact 42 not found for user alice » |
| 4 | Prompt absent | échec « Prompt not found: contextual_mail » |
| 5 | LLM qui rend du texte sans JSON | `body` = texte brut, `subject` vide, `matching_score` 0 |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Prompt posé par `V999` dans `public` alors que le pack-ai lit un autre schéma | « Prompt not found: contextual_mail » | Poser le prompt dans `${SOCLE_AI_SCHEMA}.z_config_ia` (§3) |
| Base neuve, pack-mail migré avant le pack-ai | prompt jamais posé, `V999` marquée jouée | Même correction (§3) |
| `SOCLE_AI_SCHEMA` ≠ `public` et tables IA déjà là | `Migration V999__seed_prompt.sql failed`, l'app ne démarre pas | Neutraliser `V999` **avant** le premier démarrage avec le pack-mail (§3) |
| Persistance en échec | réponse réussie **sans** `mail_propose_id` | `persistProposed` journalise en WARN et rend `null` : surveiller le journal `[mail-gen] persist failed` |
| JSON du LLM entouré de texte ou de blocs ``` | — | Géré : le pack prend du premier `{` au dernier `}` |
| `generate_batch` attendu asynchrone | appel long, délai MCP dépassé sur un gros lot | L'action est déclarée `ASYNC` mais boucle dans l'appel : lots courts, ou une génération par appel |
| Multi-tenant | le pack-ai résout le prompt « global » | La partition passée au pack-ai vaut toujours `null` (`safePartition`) : un prompt par tenant n'est pas sélectionné |
| Historique vide | `{history}` = « (aucun échange précédent) » | L'historique vient de `tr_email_import.id_contact` : importer d'abord (MAIL-02) |

---

## 9. Pour aller plus loin

- [[howto-ai-01-integrer-le-pack|HOWTO AI-01]] — fournisseurs, cascade, cache de prompts
- [[howto-mail-03-envoyer-depuis-la-boite-utilisateur|MAIL-03]] — envoyer le brouillon validé
- [[howto-27-configurer-agentia-gateway|HOWTO 27]] — passerelle IA du Hub
