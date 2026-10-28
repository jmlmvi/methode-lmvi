# HOWTO tenant-08 — Remplacer une table locale par la fiche : lecture double (P4) puis bascule (P5)

**Niveau :** Confirmé
**Cible :** `socle-pack-tenant` ≥ 0.3.0 (normalisations pays et montant) — documenté sur 0.5.0
**Vérifié au code :** 2026-10-28 (`ecarts/*`, `V001__ecarts_lecture_double.sql`, `docs/P4-LECTURE-DOUBLE.md`)
**Prérequis :** [[howto-tenant-01-integrer-le-pack|tenant-01]] ; l'app **lit réellement** les fiches (tenant-02, et tenant-06 si multi-tenant) ; une base PostgreSQL et le schéma de l'app
**Temps estimé :** 1 h de branchement + **7 jours** d'observation

---

## 1. Contexte

Une app qui porte déjà la société dans ses tables (`db_cabinet`, `z_politique_tenant`,
`z_settings/cabinet.config`) ne peut pas basculer d'un coup sur la fiche du Hub : un accent, un
« SARL » en trop, une TVA formatée autrement — en bascule directe, ces écarts se découvrent sur
l'écran d'un client.

Le pack outille deux jalons :

- **P4 — lecture double.** L'app lit sa table **et** la fiche, le pack compare, journalise les
  écarts, et l'app **continue d'afficher sa valeur locale**. Propriété de sûreté tenue par une
  ligne : `LectureDoubleService.identiteRetenue(slug)` rend **toujours** la vue locale.
- **P5 — bascule.** Les colonnes locales sont supprimées, l'app lit la fiche (tenant-03). P5 est un
  changement **de l'app** (migration SQL, code) : le pack ne l'outille pas, il fournit le critère qui
  l'autorise.

**Règle : P5 jamais avant que `ecarts_resume` ne réponde vert sur sept jours** — aucun écart
bloquant **et** des observations effectivement faites. P5 est le seul pas **irréversible**.

Cas réels : `APP-25-UniqPersonnality` (`CabinetLocal`, 18 champs, câblé, `enabled=false`) ;
`APP-28-Your360` (passé en P5 le 2026-10-09, par exception documentée §8).

---

## 2. Architecture

```
            ┌────────────── Application ───────────────┐
 requête ──►│ lectureDouble.identiteRetenue(slug)        │──► rend TOUJOURS la vue locale
            │    │                                       │
            │    ├─ SourceIdentiteLocale.pour(slug)  ◄── le SEUL bean écrit par l'app
            │    │      (une lecture de la table)        │
            │    ├─ FicheService.entreeOptionnelle(slug) │  Hub muet → compteur hub_muet, aucun écart
            │    ├─ Comparateur + Normalisation          │  seuls les champs DÉCLARÉS sont comparés
            │    └─ JournalEcarts (JDBC ou mémoire)      │
            └────────────────┬──────────────────────────┘
                             ▼
     schéma de l'app : tr_tenant_ecarts (1 ligne par écart distinct, occurrences, vu_le_*)
                       z_tenant_lectures_doubles (compteur d'observations par tenant × app)
                       z_pack_migrations (registre, pack_id = socle-pack-tenant)
                             ▲
     tenant_ecarts_worker (PASSIVE) : get_status · ecarts_resume · ecarts_lister · ecarts_comparer
```

Tout ce câblage est conditionné à `socle.tenant.lecture-double.enabled=true`
(`LectureDoubleConfiguration`, `MigrationEcarts`, `TenantEcartsWorker`).

---

## 3. Étape 1 — Déclarer la source locale

Chemins de champs = la fiche aplatie, en `snake_case` pointé :

```
raison_sociale · nom_commercial · signature · metier · annee_creation · effectif
identite_legale.{forme_juridique,enseigne_de,siren,siret,tva,naf,capital_euros,rcs,representant}
coordonnees.{adresse,code_postal,ville,pays,telephone,email,site_web}
dirigeant.{prenom,nom,qualite,email,telephone,iam_login}
editeur.{raison_sociale,forme,siren,tva,siege,directeur_publication,hebergeur,role}
marque.{couleur_principale,couleur_secondaire,couleur_fond,couleur_texte,typographie_titres,typographie_texte,logo_asset_id}
domaine.nom · domaine.hotes.<role> · datas.<clé libre>
```

```java
package eu.lmvi.cabinet;

import eu.lmvi.socle.pack.tenant.api.IdentiteLocale;
import eu.lmvi.socle.pack.tenant.api.SourceIdentiteLocale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

@Component
public class CabinetLocal implements SourceIdentiteLocale {

    private final JdbcTemplate jdbc;

    public CabinetLocal(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String application() {
        return "APP-XX-MonApp";
    }

    @Override
    public Optional<IdentiteLocale> pour(String slug) {
        List<IdentiteLocale> lignes = jdbc.query(
                "SELECT raison_sociale, siren, ville, couleur_principale "
                        + "FROM db_cabinet WHERE code = ? AND x_active",
                (rs, i) -> IdentiteLocale.de("db_cabinet")
                        .champ("raison_sociale", rs.getString("raison_sociale"))
                        .champ("identite_legale.siren", rs.getString("siren"))
                        .champ("coordonnees.ville", rs.getString("ville"))
                        .champ("marque.couleur_principale", rs.getString("couleur_principale"))
                        .fin(),
                slug);
        return lignes.stream().findFirst();   // empty = tenant inconnu localement, pas un écart
    }
}
```

**Ne déclarer que les champs qui se correspondent sans ambiguïté.** Un champ local sans équivalent
dans la fiche remonte `ABSENT_FICHE`, bloquant : le critère devient inatteignable par construction.
UniqPersonnality a écarté le logo (data URL locale contre `logo_asset_id`), la typographie (une
valeur contre deux) et ses champs métier. Une app qui ne porte rien déclare
`IdentiteLocale.aucune("…")` : elle observe sans pouvoir diverger.

## 4. Étape 2 — Activer

```yaml
socle:
  tenant:
    hub-url: ${SOCLE_TENANT_HUB_URL:https://admin.thesocle.net}
    cle-apim: ${SOCLE_TENANT_CLE_APIM:}
    lecture-double:
      enabled: ${SOCLE_TENANT_LECTURE_DOUBLE_ENABLED:false}
      schema: ${DATABASE_SCHEMA:schema_monapp}    # jamais public sur le Hub
      fenetre: 7d
```

Au démarrage, `MigrationEcarts` (`@PostConstruct`) crée `z_pack_migrations` puis rejoue
`classpath*:db/tenant/V*.sql` avec `${tenant_schema}` substitué. Un DDL en échec **arrête le
démarrage** (volontaire : une lecture double qui jetterait ses constats fausserait la semaine). Un
script déjà appliqué dont la somme a changé n'est pas rejoué (WARN). Sans `DataSource`, le journal
part en mémoire — perdu au redéploiement, donc inapte à prouver sept jours.

## 5. Étape 3 — Lire par le service

```java
package eu.lmvi.cabinet;

import eu.lmvi.socle.pack.tenant.api.IdentiteLocale;
import eu.lmvi.socle.pack.tenant.ecarts.LectureDoubleService;
import org.springframework.stereotype.Service;

@Service
public class IdentiteCabinet {

    private final LectureDoubleService lectureDouble;

    public IdentiteCabinet(LectureDoubleService lectureDouble) {
        this.lectureDouble = lectureDouble;
    }

    public String raisonSociale(String slug) {
        return lectureDouble.identiteRetenue(slug)          // rend TOUJOURS le local
                .map(i -> i.valeur("raison_sociale"))
                .orElse(null);
    }
}
```

`LectureDoubleService` n'existe que si `enabled=true` : avec `false`, ce bean est absent et
l'injection échoue. Pour garder un seul code dans les deux états, injecter
`ObjectProvider<LectureDoubleService>` et lire la table directement quand il est vide.

## 6. Étape 4 — Relever

```bash
APP=monapp
for a in get_status ecarts_resume; do
  curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
    -X POST https://admin.thesocle.net/api/actions/mcp_proxy_worker/mcp_proxy_invoke \
    -d "{\"tool\":\"${APP}__tenant_ecarts_worker__${a}\",\"params\":\"{\\\"jours\\\":7}\"}"
done
```

`ecarts_resume` rend :

```json
{ "fenetre": "PT168H", "depuis": "2026-10-21T…Z",
  "ecarts_bloquants": 0, "ecarts_informatifs": 12, "dernier_bloquant": "",
  "observations": 48310, "critere_p4_satisfait": true,
  "verdict": "journal vide sur la fenêtre — la bascule P5 est ouverte" }
```

Autres actions : `ecarts_lister` (`jours`, `limite` = 100) — chaque écart porte `slug`,
`application`, `source`, `champ`, `valeur_fiche`, `valeur_locale`, `nature`, `bloquant` ;
`ecarts_comparer` (`slug`) force une lecture double immédiate.

| Nature | Situation | Bloquant | Où corriger |
|---|---|---|---|
| `DIFFERENT` | les deux côtés diffèrent après normalisation | oui | **au Hub** (`upsert_tenant_fiche`) |
| `ABSENT_FICHE` | l'app sait, le Hub ignore — P5 perdrait la valeur | oui | au Hub |
| `ABSENT_LOCAL` | le Hub apporte, l'app ne renseignait pas | non | rien : c'est le gain |

Normalisé : séparateurs SIREN/SIRET/TVA/NAF/code postal, casse et forme courte des couleurs,
indicatif téléphonique, schéma et `www.` d'une URL, zéros de tête, décimales inutiles d'un montant,
pays (`FR` / `FRA` / `France` → ISO alpha-2, table du JDK), espaces doublés. **Non normalisé** : les
accents, la casse des mots, une forme juridique en trop.

## 7. Étape 5 — Basculer (P5)

Quand `critere_p4_satisfait` est vrai sur la fenêtre :

1. figer un dernier `ecarts_lister` dans le journal du chantier ;
2. remplacer chaque lecture locale par `TenantProfile` (tenant-03) ;
3. retirer `SourceIdentiteLocale` et `lecture-double` de la configuration ;
4. livrer la migration qui supprime les colonnes (modèle : `APP-28-Your360/your360/sql/migrations/V002__p5_retrait_colonnes_societe.sql`).

Les tables `tr_tenant_ecarts` et `z_tenant_lectures_doubles` restent ; elles ne gênent rien.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `get_status` après une journée | `lectures` > 0, `hub_muet` ≈ 0, `tenants_inconnus_localement` attendu |
| 2 | Valeur locale modifiée exprès | un `DIFFERENT` dans `ecarts_lister`, l'écran montre toujours la valeur locale |
| 3 | Redéploiement de l'app | `observations` conservées (journal en base) |
| 4 | App débranchée 7 jours | `verdict` « aucune lecture double sur la fenêtre — rien n'est prouvé » |
| 5 | Tests du pack | `LectureDoubleTest.laValeurRendueEstTOUJOURSCelleDeLaSourceLocaleMemeQuandLaFicheDiffere` ; `JournalEcartsIntegrationTest` (14, sautés sans PostgreSQL de test) |

**Précédent Your360 (2026-10-09).** Bascule P5 sans les sept jours, à la demande du commanditaire :
les 13 champs des 4 cabinets ont été confrontés directement, base de production contre fiches
servies — **`ABSENT_FICHE` = 0**, 40 `ABSENT_LOCAL`, 5 `DIFFERENT` en faveur de la fiche. Ce relevé
ponctuel ne vaut que là où champs et tenants s'énumèrent et se lisent tous ; il ne voit qu'un
instant. Il n'abroge pas la fenêtre, voie par défaut — en particulier pour `APP-17-BilanSocle` et son
JSON libre.

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Armer la fenêtre sur une app qui ne lit pas la fiche (MDC absent, `403` multi-tenant) | `hub_muet` monte, `observations` à 0, sept jours perdus sans explication | vérifier `refresh_fiche` sur chaque tenant **avant** `enabled=true` (tenant-02, tenant-06) |
| Croire que la fenêtre court depuis l'écriture du bean | « câblé » ≠ « actif » | elle commence à `enabled=true` + clé APIM posée |
| Déclarer un champ sans équivalent | `ABSENT_FICHE` permanent, critère inatteignable | ne déclarer que les correspondances exactes |
| Coquille de chemin (`coordonnee.ville`) | rien ne casse, champ jamais comparé | test qui confronte les chemins déclarés à la liste §3 (modèle `CabinetLocalPerimetreTest`) |
| `schema: public` sur le Hub | migration en échec, démarrage arrêté | schéma de l'app |
| Corriger l'écart dans l'app | il revient, ou P5 l'efface | corriger au Hub |
| `en-memoire: true` | journal perdu au redéploiement | base PostgreSQL |
| Injecter `LectureDoubleService` avec `enabled=false` | l'app ne démarre pas (bean absent) | `ObjectProvider<LectureDoubleService>` |
| Passer P5 sur un « journal vide » sans observations | bascule non prouvée | les **deux** conditions de `critere_p4_satisfait` |
| Tenant réel sans tenant ni fiche au Hub (cas `be-rhc-001` chez UniqP) | `hub_muet` pour lui, P5 perdrait ses données | créer le tenant et sa fiche au Hub avant P5 |

---

## 10. Pour aller plus loin

- `socle-pack-tenant/docs/P4-LECTURE-DOUBLE.md` — mode d'emploi et justifications
- [[howto-tenant-03-lire-la-fiche-societe|tenant-03]] — la lecture après P5
- [[howto-34-gerer-les-tenants-iam|HOWTO 34]] — saisir ou corriger la fiche côté Hub
- Conventions de table : `APP-ZZ-TEMPLATE/docs/09-PGSQL_Fields.md`
