# HOWTO 45 — Classer un texte avec KEV (rubrique, catégorie, routage, oui/non)

> **Pour qui** : le développeur ou l'agent qui doit **trancher** sur un texte — ranger un article
> dans une rubrique, router un ticket, décider si un cas part en revue humaine — depuis une app de
> la flotte **ou depuis un client hors du Hub** (plugin WordPress, site tiers).
>
> **Durée** : 20 minutes jusqu'au premier classement. **Prérequis** : MCP `soclehub` disponible
> (pour frapper la clé), un appelant capable de faire un `POST` HTTPS.
>
> **État de référence** : API publiées vérifiées le **2026-10-28** ; chiffres **mesurés** du
> 2026-10-02 au 2026-10-15 sur `spark-cf72` et `nas4`. Source de l'app : `APP-32-KEV/`.

---

## 0. Ce que KEV fait — et ce qu'il ne fait pas

On lui donne **un texte** (l'*état*) et **une question typée**. Il rend une **probabilité calibrée**
par réponse possible, en une seule passe, **sans générer de texte**.

| Il fait | Il ne fait pas |
|---|---|
| répondre oui/non, choisir parmi N, noter sur une échelle | rédiger, résumer, traduire, extraire |
| rendre la **distribution** de probabilités | rendre une étiquette sèche |
| dire qu'il ne sait pas, en s'effondrant | refuser explicitement |

KEV n'est **pas un LLM**. Pour rédiger ou résumer : [[howto-27-configurer-agentia-gateway|HOWTO 27]]
(AgentIA). KEV sert à **décider**, vite et à coût fixe.

**La propriété qui le rend utile** : sur une question hors de son champ, sa confiance s'effondre au
lieu de mentir — mesuré à **0,07** (9B) et **0,236** (4B) sur un ticket hors sujet, contre
0,95–0,97 sur les cas francs. C'est ce qui permet une règle d'acceptation automatique (§5).

---

## 1. Les deux moteurs, et lequel appeler

| | `/kev/v1` — Spark | `/kev-nas4/v1` — nas4 |
|---|---|---|
| Modèle | Kev-**9B**, CUDA bf16 | Kev-**4B**, MLX / Metal |
| Scope | `api:kev:read` | `api:kev-nas4:read` |
| Texte court, 3 options | 197–304 ms | 197–303 ms |
| 12 / 24 options décrites | **328 / 370 ms** | 641 / 980 ms |
| Nouvel état long (65k jetons) | dans la seconde, à chaud | **84,5 s** (mesure amont) |
| Hors sujet | s'effondre mieux (0,07) | moins bien (0,236) |

**Règle** :
- **classement à plus de trois options** (rubriques, catégories) → **Spark** ;
- **texte > 16 000 jetons** → **Spark** ;
- texte court et 2–3 options → l'un ou l'autre, nas4 soulage le GPU du Spark.

Ce sont deux apps indépendantes : **c'est l'appelant qui choisit**, rien n'oriente à sa place.

### Recette et production

Les deux API sont publiées sur **`api.thesocle.net`** — la plateforme de **recette**. L'APIM de
production (`thesocle.io`) **ne les publie pas** au 2026-10-28. Développez et recettez sur `.net` ;
une mise en service réelle à plusieurs sites suppose de publier KEV sur `.io`
([[howto-30-publier-une-api-apim|HOWTO 30]]) et de frapper les clés là-bas.

---

## 2. Étape 0 — Obtenir une clé

**Une clé par appelant** : par app, et **par site** pour un plugin déployé sur plusieurs sites.
Chacun se révoque seul, et le débit se compte par clé.

```
apim_provisioning_worker.create_api_key(
    key_name = "wp-<site>-kev",
    tenant   = "lmvi",
    scopes   = "api:kev:read",          # ajouter api:kev-nas4:read pour la variante à deux machines (§6.4)
    tier     = "internal")
```

⚠️ Utiliser **`apim_provisioning_worker`**, pas `iam_worker.create_api_key` : ce dernier rend un
UUID sans scope, refusé en **401** par la passerelle
([[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]] §0).

⚠️ **La clé rendue figure en clair dans le journal des actions du Hub.** La ranger aussitôt dans
Vault (`vault_worker.set_secret`, chemin `soclehub/apps/<appelant>/apim`), ou côté serveur du site
pour un client externe (§6.3).

**Débit** : 10/s, 300/min, 50 000/jour par clé.

---

## 3. Étape 1 — Premier appel

⚠️ **Le chemin se répète** : le `base_path` de l'API est `/kev/v1`, la route de l'app est
`/v1/ops/<action>`. L'URL complète est donc `…/kev/v1/v1/ops/choisir`. Ce n'est pas une faute.

```bash
curl -sS https://api.thesocle.net/kev/v1/v1/ops/choisir \
  -H "X-API-Key: $KEV_API_KEY" -H 'Content-Type: application/json' \
  -d '{"etat":"Le conseil municipal a voté hier le budget 2027, en hausse de 4 % sur la voirie.",
       "consigne":"Dans quelle rubrique du site cet article doit-il être publié ?",
       "options":{"politique-locale":"Conseil municipal, élus, budget de la commune, élections",
                  "economie":"Entreprises, emploi, commerces, marchés",
                  "culture":"Spectacles, expositions, livres, patrimoine"}}'
```

Forme de la réponse (valeurs d'illustration ; une réponse mesurée figure au §4 du HOWTO de l'app) :

```json
{"job_id":"…","op":"choisir","state":"done",
 "result":{"choice":"politique-locale","confidence":0.93,
           "probabilities":{"politique-locale":0.95,"economie":0.04,"culture":0.01}}}
```

Le premier appel après un redémarrage coûte **~4 s** sur le Spark (compilation des noyaux) ; les
suivants, quelques centaines de millisecondes.

---

## 4. Les quatre actions

Toutes en `POST /v1/ops/<action>`. Réponse : `{"job_id","op","state","result":{…}}`, avec
`state:"done"` quand le calcul tient dans l'appel — le cas normal.

| Action | Corps | `result` |
|---|---|---|
| `oui_non` | `{"etat","consigne"}` | `{"type":"noul","noul":0.79}` — probabilité du **oui** |
| `choisir` | `{"etat","consigne","options":{"<clé>":"<description>",…}}` (≥ 2 options) | `{"choice","confidence","probabilities":{…}}` |
| `noter` | `{"etat","consigne","niveaux":{"niveaux":["Calme","Agacé","Très en colère"]}}` | `{"score":1.55,"legend":{…},"probabilities":{…}}` — `score` est une **espérance** |
| `decider` | `{"etat","questions":{"<nom>":{"type":"choice"\|"noul"\|"score","instructions",…}}}` | un résultat par question |

**Préférez `decider`** pour plusieurs questions sur un même texte : il n'est lu qu'une fois
(trois questions en 1 452 ms). Les questions partagent le texte mais ne se lisent pas entre elles.

```json
{"etat":"<le texte>",
 "questions":{
   "rubrique":  {"type":"choice","instructions":"Quelle rubrique ?","criteria":{"economie":"…","culture":"…"}},
   "sensible":  {"type":"noul","instructions":"L'article met-il en cause une personne nommée ?"}}}
```

---

## 5. Étape 2 — Lire la réponse : la règle de décision

**Ne lisez pas `choice`, lisez `probabilities`.** Sur un cas ambigu, l'étiquette de tête change
d'un appel à l'autre (mesuré : `livraison` seul, `facturation` dans un `decider`, 0,46 contre
0,47). Aucune logique ne doit reposer sur `choice` quand la tête est basse.

### 5.1 À deux ou trois options

Accepter au-dessus de **0,80** de `confidence`, envoyer le reste à un humain.

| Cas mesuré (tickets, 3 options) | `confidence` | Décision |
|---|---|---|
| un seul sujet, net | 0,96 | automatique |
| formulation ambiguë | 0,64 | automatique, surveillé |
| trois sujets à la fois | 0,20 | revue humaine |
| hors sujet | 0,07 | revue humaine, ou rejet |

### 5.2 Au-delà de trois options — décider sur l'écart

La probabilité se **répartit** entre les options : plus la liste est longue, plus la tête descend,
même quand le modèle a raison. Mesure du 2026-10-15 (vraies tâches classées par application) :

| | nas4 4B, 12 opt. | nas4 4B, 24 opt. | Spark 9B, 12 opt. | Spark 9B, 24 opt. |
|---|---|---|---|---|
| Cas tranchés corrects | **9/9** | **9/9** | 8/9 | 8/9 |
| Probabilité de tête | 0,25 → 0,83 | 0,25 → 0,73 | 0,55 → 0,90 | 0,39 → 0,86 |
| Écart au second | 1,5× → 16× | 2,1× → 14,8× | 1,6× → 18× | 1,4× → 13,4× |

**Une seule tâche sur seize franchissait 0,80, alors que neuf sur neuf étaient bien classées.** En
exécution réelle (24 tâches, 17 options), des classements justes sortaient à **0,18–0,22**.

```
accepter si   p1 / p2 ≥ 2,0   ET   p1 ≥ 0,20
sinon         « à classer » (revue humaine)
```

`p1`, `p2` : les deux plus fortes valeurs de `probabilities`.

Deux constats de la même mesure :
- **allonger la liste ne dégrade pas le classement** : un seul appel à 24 options tient ; inutile
  de classer en deux tours (famille puis détail) ;
- KEV **lit tout l'état** : un classement qui paraît faux au vu du titre peut être juste au vu du
  corps. Vérifier sur le texte envoyé avant de « corriger » une sortie.

**Recalibrer sur ses propres données** avant de figer la règle : ces chiffres viennent de tâches et
de tickets, pas d'articles. Une centaine d'articles déjà rangés suffit à mesurer l'écart utile.

---

## 6. Étape 3 — Classer des articles depuis WordPress

### 6.1 Écrire les options

- **Une description par rubrique**, en une ligne concrète, avec les mots que l'on retrouvera dans
  les articles. C'est elle qui guide le modèle ; `{"a":null,"b":null}` marche, mais classe moins bien.
- **La clé de l'option = le slug de la rubrique** : la réponse se range sans retraduction.
- Une rubrique fourre-tout (« général ») se classe juste si sa description dit ce qu'elle reçoit ;
  ses bons classements sortent souvent avec une tête basse — d'où la règle de l'écart.

### 6.2 Ce qu'il faut envoyer d'un article

- **Du texte brut** : `strip_shortcodes()` puis `wp_strip_all_tags()`. Le balisage coûte des
  jetons et n'aide pas.
- **Titre, chapô, corps**, dans cet ordre. L'état accepte 65 536 jetons : un article ordinaire passe
  entier ; bornez les très longs textes pour éviter le `422`.

### 6.3 Le code

Configuration, côté serveur, dans `wp-config.php` — **jamais** dans du JavaScript servi au
navigateur :

```php
define( 'KEV_URL',     'https://api.thesocle.net/kev/v1' );
define( 'KEV_API_KEY', 'apim_…' );   // la clé de CE site (§2)
```

Le classement tourne **hors de la requête d'enregistrement**, en tâche différée : un appel lent ou
un moteur arrêté ne doit jamais retarder ni bloquer la publication.

```php
<?php
/**
 * Plugin Name: Rubrique par KEV
 */

const KEV_RATIO_MIN = 2.0;
const KEV_TETE_MIN  = 0.20;

/** Rubriques proposées : slug => description d'une ligne. */
function kev_rubriques(): array {
	$rubriques = [];
	foreach ( get_categories( [ 'hide_empty' => false ] ) as $cat ) {
		if ( 'uncategorized' === $cat->slug ) {
			continue;
		}
		$rubriques[ $cat->slug ] = $cat->description !== '' ? $cat->description : $cat->name;
	}
	return $rubriques;
}

/** À la publication : programmer le classement, ne rien appeler ici. */
add_action( 'transition_post_status', function ( $nouveau, $ancien, $post ) {
	if ( 'publish' === $nouveau && 'publish' !== $ancien && 'post' === $post->post_type ) {
		wp_schedule_single_event( time() + 5, 'kev_classer_article', [ $post->ID ] );
	}
}, 10, 3 );

add_action( 'kev_classer_article', 'kev_classer_article' );

function kev_classer_article( int $post_id ): void {
	$post = get_post( $post_id );
	if ( ! $post ) {
		return;
	}
	$texte = $post->post_title . "\n\n" . $post->post_excerpt . "\n\n"
		. wp_strip_all_tags( strip_shortcodes( $post->post_content ) );
	$texte = mb_substr( $texte, 0, 40000 );

	$probas = kev_choisir(
		$texte,
		'Dans quelle rubrique du site cet article doit-il être publié ?',
		kev_rubriques()
	);

	$slug = $probas === null ? null : kev_accepter( $probas );
	if ( $slug === null ) {
		update_post_meta( $post_id, '_kev_a_classer', 1 );
		return;
	}
	$cat = get_category_by_slug( $slug );
	if ( $cat ) {
		wp_set_post_categories( $post_id, [ $cat->term_id ] );
		delete_post_meta( $post_id, '_kev_a_classer' );
		update_post_meta( $post_id, '_kev_probabilites', wp_json_encode( $probas ) );
	}
}

/** Appelle KEV ; rend les probabilités, ou null si KEV n'a pas pu répondre. */
function kev_choisir( string $etat, string $consigne, array $options ): ?array {
	$corps = wp_json_encode( [ 'etat' => $etat, 'consigne' => $consigne, 'options' => $options ] );
	for ( $essai = 0; $essai < 3; $essai++ ) {
		if ( $essai > 0 ) {
			sleep( 2 ** $essai );                       // 2 s puis 4 s
		}
		$rep = wp_remote_post( KEV_URL . '/v1/ops/choisir', [
			'timeout' => 30,
			'headers' => [ 'X-API-Key' => KEV_API_KEY, 'Content-Type' => 'application/json' ],
			'body'    => $corps,
		] );
		if ( is_wp_error( $rep ) ) {
			continue;
		}
		$code = (int) wp_remote_retrieve_response_code( $rep );
		if ( in_array( $code, [ 429, 503, 504 ], true ) ) {
			continue;                                   // rejouables (§7)
		}
		if ( 200 !== $code ) {
			return null;                                // 202 (calcul long), 4xx, 502 : à classer
		}
		$json = json_decode( wp_remote_retrieve_body( $rep ), true );
		if ( ( $json['state'] ?? '' ) !== 'done' ) {
			return null;
		}
		return $json['result']['probabilities'] ?? null;
	}
	return null;
}

/** Règle de l'écart (§5.2) : rend le slug accepté, ou null. */
function kev_accepter( array $probas ): ?string {
	arsort( $probas );
	$valeurs = array_values( $probas );
	$p1      = (float) ( $valeurs[0] ?? 0 );
	$p2      = (float) ( $valeurs[1] ?? 0 );
	if ( $p1 < KEV_TETE_MIN ) {
		return null;
	}
	if ( $p2 > 0 && $p1 / $p2 < KEV_RATIO_MIN ) {
		return null;
	}
	return (string) array_key_first( $probas );
}
```

Les articles marqués `_kev_a_classer` forment la file de revue humaine ; `_kev_probabilites` garde
la distribution, utile pour recalibrer la règle (§5.2).

### 6.4 Variante plus sûre — les deux machines

Appeler **aussi** `/kev-nas4/v1` (scope `api:kev-nas4:read`) et n'accepter que si les deux
moteurs donnent **la même rubrique** et que la règle de l'écart tient. Le 2026-10-15, leur
désaccord a isolé **la seule erreur du lot**, qu'aucun des deux n'aurait attrapée seul, et les cas
renvoyés en revue étaient ambigus pour un humain aussi. Coût : ≈ 1 s de plus à 24 options (nas4).

---

## 7. Les erreurs, et lesquelles réessayer

Format commun : `{"error":{"code":…,"message":…,"retryable":…}}`. Décider sur `code` et
`retryable`, jamais sur le message.

| Code | HTTP | Rejouable | Sens |
|---|---|---|---|
| `invalid_params` | 400 | non | demande mal formée — le détail nomme le champ |
| `unauthorized` | 401 | non | clé absente, invalide ou révoquée |
| `forbidden` | 403 | non | en-tête d'identité présenté deux fois |
| `queue_full` | 429 | **oui** | file pleine ; respecter `Retry-After` |
| `upstream_unavailable` | 503 | **oui** | moteur arrêté ou en redémarrage |
| `upstream_refused` | 502 | non | le moteur a refusé la demande |
| `timeout` | 504 | **oui** | un lien vivant ne prouve pas un canal vivant |

---

## 8. Les limites

| Limite | Valeur | Au-delà |
|---|---|---|
| Réponse dans l'appel | 20 s (Spark), 25 s (nas4) | `202` + `job_id`, suivre par `GET /v1/jobs/<id>` |
| Arguments | 1 Mio | refus |
| Corps par le tunnel | 16 Mo, sans flux | corps arrivé **vide, sans erreur** |
| État | 65 536 jetons | `422` |
| Débit par clé | 10/s, 300/min, 50 000/jour | `429` |
| Disponibilité | **une machine par modèle** | le Spark est tombé 2 h 51 le 2026-10-04, KEV avec lui |

---

## 9. Pièges, dans l'ordre où on les rencontre

| Symptôme | Cause | Correctif |
|---|---|---|
| `401` avec une clé fraîche | clé frappée par `iam_worker.create_api_key` (UUID sans scope) | `apim_provisioning_worker.create_api_key` (§2) |
| `404` | chemin simple `…/kev/v1/ops/…` | le chemin se répète : `…/kev/v1/v1/ops/…` (§3) |
| Presque tout part « à classer » | seuil de 0,80 appliqué à une liste de rubriques | règle de l'écart (§5.2) |
| Classement lent (~1 s) | nas4 appelé pour une liste de 12–24 options | appeler le Spark (§1) |
| Premier appel à ~4 s | compilation des noyaux après redémarrage | normal ; chauffer après un redéploiement si la latence compte |
| La rubrique de tête change d'un appel à l'autre | cas ambigu, tête basse | ne jamais lire `choice` seul (§5) |
| Classement « faux » au vu du titre | KEV a lu le corps | vérifier sur le texte envoyé avant de corriger |
| Clé visible dans le navigateur | appel fait en JavaScript | appeler côté serveur, clé dans `wp-config.php` (§6.3) |
| Publication bloquée quand le Spark tombe | appel synchrone dans `save_post` | tâche différée, « à classer » en repli (§6.3) |
| Clé exposée | elle figure en clair dans le journal des actions du Hub | la ranger aussitôt, la traiter comme un secret exposé (§2) |
| Outils KEV visibles au MCP mais `invoke` impossible | `BUG-MH-010` : le Hub n'invoque pas une app de minihub | passer par l'APIM |
| Rien ne marche sur `api.thesocle.io` | KEV n'est publié qu'en recette (`.net`) | publier sur `.io` avant la mise en service (§1) |

---

## 10. Voir aussi

- [[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]] — clés APIM, Vault, preuve depuis le conteneur
- [[howto-30-publier-une-api-apim|HOWTO 30]] — publier une API (pour KEV sur `.io`)
- [[howto-27-configurer-agentia-gateway|HOWTO 27]] — quand il faut **rédiger**, pas trancher
- `APP-32-KEV/README.md` — la pose du moteur, l'arbitrage CUDA / MLX, les pièges de l'image
- `APP-32-KEV/docs/HOWTO-UTILISER-KEV.md` — appel depuis la même machine que le moteur (chemin A)
- `APP-20-ToDo/docs/Upgrade/2026-10-15-Cosmetics/classement/` — la mesure à 12 et 24 options et le programme à deux machines
- Amont : [github.com/jaredpalmer/kev](https://github.com/jaredpalmer/kev), fiches de modèle dans `docs/model-cards/`
