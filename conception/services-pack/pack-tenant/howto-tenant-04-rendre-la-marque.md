# HOWTO tenant-04 — Rendre la marque du tenant (couleurs, typographies, logo)

**Niveau :** Intermédiaire
**Cible :** `socle-pack-tenant` 0.5.0 — `TenantBranding`, `TenantBrandingDialect`, objet `#tenant`
**Hub :** ≥ 3.63.0 (`GET /api/iam/tenant/{slug}/logo` → `302` vers une URL signée)
**Vérifié au code :** 2026-10-28
**Prérequis :** [[howto-tenant-01-integrer-le-pack|tenant-01]], [[howto-tenant-02-poser-le-tenant-courant|tenant-02]] ; bloc `marque` de la fiche saisi, logo déposé par `iam_worker.set_tenant_logo`
**Temps estimé :** 25 min

---

## 1. Contexte

Une même application sert plusieurs cabinets, chacun avec sa palette et son logo. Le pack fournit :

- `TenantBranding` : les six valeurs de marque, `logoUrl()` (URL signée), `logoBytes()` (pour les
  générateurs de PDF) et `variablesCss()` ;
- un **dialecte Thymeleaf**, actif seulement si Thymeleaf est sur le classpath
  (`@ConditionalOnClass("org.thymeleaf.dialect.IDialect")`), qui injecte les variables CSS dans le
  `<head>` et expose l'objet `#tenant`.

Le binaire du logo reste dans le magasin du Hub : « un seul logo au bon endroit ». Aucune couleur par
défaut : sans fiche, le rendu échoue.

---

## 2. Architecture

```
Gabarit Thymeleaf                         TenantBrandingDialect (préfixe « socle »)
 <head> … </head>  ──── MarqueHeadProcessor ──► <style data-socle-tenant="marque">
                                                 :root{--socle-couleur-principale:#2F6B4F;…}
 ${#tenant.nom} ${#tenant.logoUrl}  ──── TenantExpressionObject (non mis en cache)
 ${#tenant.perimee} ${#tenant.age}             │
                                               ▼
                         TenantBrandingService ── FicheService (cache) ── marque
                                  │ logoUrl()  : GET /logo à CHAQUE appel → Location du 302
                                  │ logoBytes(): LogoStore, cache disque <logo-cache-disque>/<slug>/<asset_id>
                                  ▼
                               TheSocleHub — magasin S3, URL signée
```

Variables CSS produites (`Marque.variablesCss()`, seules les valeurs renseignées) :

| Champ de la fiche | Variable |
|---|---|
| `marque.couleur_principale` | `--socle-couleur-principale` |
| `marque.couleur_secondaire` | `--socle-couleur-secondaire` |
| `marque.couleur_fond` | `--socle-couleur-fond` |
| `marque.couleur_texte` | `--socle-couleur-texte` |
| `marque.typographie_titres` | `--socle-typo-titres` |
| `marque.typographie_texte` | `--socle-typo-texte` |

---

## 3. Étape 1 — Gabarit Thymeleaf

Aucune déclaration : le bean `tenantBrandingDialect` est enregistré par
`TenantThymeleafConfiguration` et Spring Boot l'ajoute au moteur de gabarits.

`src/main/resources/templates/accueil.html` :

```html
<!DOCTYPE html>
<html lang="fr" xmlns:th="http://www.thymeleaf.org">
<head>
  <meta charset="UTF-8">
  <title th:text="${#tenant.nom}">Société</title>
  <link rel="stylesheet" th:href="@{/css/app.css}">
  <!-- le pack insère ici, juste avant </head>, <style data-socle-tenant="marque">:root{…}</style> -->
</head>
<body>
  <div th:if="${#tenant.perimee}" class="bandeau-fraicheur">
    Informations de société vieilles de <span th:text="${#tenant.age}">PT2H</span>.
  </div>
  <header>
    <img th:if="${#tenant.logoUrl != null}" th:src="${#tenant.logoUrl}" th:alt="${#tenant.nom}">
    <h1 th:text="${#tenant.raisonSociale}">Raison sociale</h1>
  </header>
  <footer th:text="${#tenant.mentionLegale}">Mention légale</footer>
</body>
</html>
```

`src/main/resources/static/css/app.css` — le gabarit ne connaît que les variables :

```css
body   { background: var(--socle-couleur-fond); color: var(--socle-couleur-texte);
         font-family: var(--socle-typo-texte), sans-serif; }
h1     { color: var(--socle-couleur-principale); font-family: var(--socle-typo-titres), serif; }
a      { color: var(--socle-couleur-secondaire); }
```

Objet `#tenant` (`TenantExpressionObject`) : `fiche`, `nom`, `raisonSociale`, `mentionLegale`,
`logoUrl`, `perimee` (ne lève jamais), `age` (ISO-8601, chaîne vide sans fiche).

---

## 4. Étape 2 — API Java (courriel, front React, PDF)

```java
package eu.lmvi.marque;

import eu.lmvi.socle.pack.tenant.api.TenantBranding;
import eu.lmvi.socle.pack.tenant.api.TenantProfile;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class MarqueController {

    private final TenantProfile profil;
    private final TenantBranding marque;

    public MarqueController(TenantProfile profil, TenantBranding marque) {
        this.profil = profil;
        this.marque = marque;
    }

    /** Pour un front React : la palette et l'URL signée du logo. */
    @GetMapping("/api/marque")
    public Map<String, Object> marque() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("nom", profil.fiche().nomAffiche());
        m.put("variables", marque.variablesCss());
        String logo = marque.logoUrl();
        m.put("logo_url", logo == null ? "" : logo);
        return m;
    }

    /** Le logo servi par l'app elle-même — utile pour un courriel, où l'URL signée expirerait. */
    @GetMapping("/public/logo")
    public ResponseEntity<byte[]> logo() {
        byte[] octets = marque.logoBytes();
        if (octets == null) return ResponseEntity.notFound().build();
        // Le pack ne rend pas le type du logo : PNG ici, à adapter (JPEG, WebP, SVG acceptés au Hub).
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .cacheControl(CacheControl.noCache())
                .body(octets);
    }
}
```

Pour un PDF (OpenPDF, iText…), `logoBytes()` donne directement les octets : téléchargés une fois
depuis l'URL signée puis gardés dans `socle.tenant.logo-cache-disque`, sous
`<slug>/<logo_asset_id>`. Un nouveau logo porte un nouvel `asset_id`, donc un nouveau fichier.

---

## 5. Vérifier

```bash
# La balise injectée
curl -s https://monapp.thesocle.net/ -b "soclehub_token=$JWT" | grep -o '<style data-socle-tenant[^<]*'
# → <style data-socle-tenant="marque">:root{--socle-couleur-principale:#2F6B4F;…}

# Le logo côté Hub : 302 + Location signée
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -H "X-API-Key: $APIM_KEY" https://admin.thesocle.net/api/iam/tenant/atelier-des-parcours/logo
```

---

## 6. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Même page, deux tenants | deux jeux de couleurs (`MarqueThymeleafTest.deuxTenantsDeuxJeuxDeCouleursDansLeMemeRendu`) |
| 2 | Variables dans le `<head>`, pas dans le `<body>` | `laMarqueEstInjecteeDansLeHeadEtNonDansLeCorps` |
| 3 | Fiche servie depuis le cache au-delà de `fraicheur-max` | bandeau affiché |
| 4 | Tenant sans fiche | le rendu échoue (`sansFicheLeRenduEchoueAuLieuDeServirDesCouleursParDefaut`) |
| 5 | Tenant sans logo | `logoUrl()` = `null`, `logoBytes()` = `null`, la page sort |
| 6 | Valeur de marque contenant `</style>` | filtrée (`<`, `>`, `;`, `}` retirés) |

---

## 7. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Le processeur s'applique à TOUT `<head>` Thymeleaf** | page de connexion, page d'erreur ou page publique sans tenant : rendu en erreur `TenantSansFiche` | poser le tenant pour ces routes (tenant-02), ou les servir hors Thymeleaf ; aucune propriété ne désactive le dialecte en 0.5.0 |
| `#tenant.logoUrl` appelé plusieurs fois par page | un aller-retour `GET /logo` vers le Hub **à chaque appel** (non mis en cache, l'URL signée expire) | l'évaluer une fois (`th:with`) |
| Mettre l'URL signée dans un courriel | image cassée à l'ouverture, l'URL a expiré | servir `logoBytes()` depuis l'app (§4) |
| Couleurs de repli codées dans le CSS | marque générique servie en silence | pas de repli : l'absence de fiche doit se voir |
| Hub muet : `logoUrl()` | `null`, la page sort sans logo (WARN) | normal : le bandeau de fraîcheur le signale |
| `logo-cache-disque` sur `/tmp` du conteneur | re-téléchargé après chaque redéploiement | volume persistant si les PDF sont fréquents |
| Attendre une seule typographie | deux valeurs : titres et texte | `typographieTitres()` / `typographieTexte()` |

---

## 8. Pour aller plus loin

- [[howto-tenant-03-lire-la-fiche-societe|tenant-03]] — la fiche
- [[howto-tenant-07-fraicheur-cache-et-mode-degrade|tenant-07]] — bandeau, âge, mode dégradé
- [[howto-16-storage-s3-quotas|HOWTO 16]] — le magasin d'où viennent les URL signées
