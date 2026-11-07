# DOCUMENTS-03 — Produire un document Word et son PDF (modèle, OnlyOffice, secours)

**Cible :** `eu.lmvi:socle-pack-documents:0.3.0` · socle-v005 5.11.2 (minimum 5.10.0) · Spring Boot 4.1.2
**Service du Hub consommé :** OnlyOffice (`soclehub-onlyoffice`, howto-14) — facultatif : sans lui, le PDF de secours.

---

## 1. Contexte

Une app produit des documents (CV, lettre, synthèse) à partir de ses données : un **modèle Word**
rempli, puis son **PDF**. Le pack fait les trois gestes, extraits de Your360 où ils servaient une
seule app : remplir le modèle (`ModeleWord`), convertir par OnlyOffice (`ProductionService`), et
servir un **PDF de secours** quand OnlyOffice est coupé ou refuse (`PdfSecours`). Jamais « rien ».

## 2. Architecture

```
app ──remplirWord(modèle, données)──▶ .docx
app ──pdfDepuisWord(.docx, titre, secours)──▶ ProductionService
        │ garde le .docx en mémoire (jeton aléatoire, 300 s)
        ├──▶ OnlyOffice : ConvertService.ashx { url = <base-rappel>/socle-documents/conversion/<jeton> }
        │        OnlyOffice ──GET (signé JWT)──▶ app : ConversionController ──▶ .docx
        │◀── fileUrl ── PDF rapatrié par l'adresse interne
        └── échec, refus, non configuré ──▶ secours.get()
```

## 3. Étape 1 — Remplir un modèle

```java
byte[] docx = production.remplirWord(modele, new ModeleWord.Donnees(
        Map.of("identite.prenom", "Camille", "identite.nom", "Martin"),
        Map.of("bloc:experiences", e -> {
                    e.titre("Expériences", 2);
                    for (Experience x : experiences) e.paragraphe(x.intitule() + " — " + x.employeur());
                },
               "tableau:langues", e -> e.tableau(List.of("Langue", "Niveau"), lignes, List.of(), null, null)),
        Map.of("photo", new ModeleWord.Image(octetsPng, 3, 4)),
        null));                                     // couleur d'accent des en-têtes de tableau (hex), null = défaut
```

- `{{cle}}` partout (corps, tableaux, en-têtes, pieds), même coupé par Word sur plusieurs « runs ».
- `{{bloc:x}}`, `{{tableau:x}}`, `{{image:x}}` **seuls sur leur paragraphe** : remplacés par du contenu
  généré. L'auteur du modèle les déplace ou les retire dans Word, sans toucher au code.
- Un champ **inconnu reste visible** : une faute de frappe se voit dans le document.
- `ModeleWord.verifier(octets)` avant d'accepter un modèle ; `ModeleWord.champsPresents(octets)` pour l'afficher.

## 4. Étape 2 — Le PDF, avec son secours

```java
ResultatPdf r = production.pdfDepuisWord(docx, "cv.docx",
        () -> new PdfSecours().titre("Curriculum vitae").section("Expériences").paragraphe(texte).octets());
// r.octets() : le PDF ; r.origine() : ONLYOFFICE ou SECOURS ; r.motif() : pourquoi le secours ;
// r.dureeMs() : à mesurer (M4 Q21 : export < 10 s)
```

Motifs du secours : `onlyoffice_non_configure`, `onlyoffice_refuse` (code d'erreur du serveur),
`onlyoffice_indisponible` (injoignable après reprises), `conversions_saturees` (mémoire réservée pleine).

## 5. Étape 3 — Configurer (Hub `.net`, `.io`)

| Propriété | Valeur sur le Hub |
|---|---|
| `socle.documents.onlyoffice.url-interne` | `http://soclehub-onlyoffice` (défaut) |
| `socle.documents.onlyoffice.secret` | `ONLYOFFICE_JWT_SECRET` du Hub, **écrit dans Vault** `soclehub/apps/<app>/env` (jamais par `set_env_var`, qui journalise en clair) |
| `socle.documents.onlyoffice.base-rappel` | **l'adresse publique de l'app** : `https://<app>.thesocle.net` |

Et dans l'app : laisser passer **sans session** `GET /socle-documents/conversion/**` (filtre
d'identité de l'app, route du Hub en SSO `optional`). La route se protège seule : jeton aléatoire de
256 bits dans le chemin **et** requête signée par le serveur OnlyOffice ; sinon 404.

## 6. Vérifier

`ProductionPdfTest` (pack) : vrai `onlyoffice/documentserver:8.2` réglé comme le Hub ; PDF en ~1 s
serveur chaud ; route refusée sans signature ; secours sur mauvais secret, serveur coupé, non
configuré, mémoire pleine.

## 7. Pièges courants

| Symptôme | Cause | Correction |
|---|---|---|
| Code -4 (téléchargement impossible) avec une URL S3 présignée | Le serveur du Hub joint son JWT (`Authorization`) à ses téléchargements ; MinIO refuse deux authentifications (400 `InvalidRequest`) | Ne pas présigner : le pack sert le .docx par sa route de rappel (0.3.0) |
| `EHOSTUNREACH` quelques minutes après une mise à jour de l'app | Le convertisseur garde en cache l'IP d'un nom de conteneur (`http://<app>:8080`) | `base-rappel` = adresse **publique** de l'app |
| Code -4 avec `base-rappel` publique | La route `/socle-documents/conversion/**` exige une session dans l'app | La déclarer publique dans le filtre d'identité de l'app |
| Code -8 | Mauvais secret | `secret` = `ONLYOFFICE_JWT_SECRET` du Hub |
| 502 sur `ConvertService.ashx` | Client Java en h2c | Le pack impose HTTP/1.1 — ne pas remplacer son client |
| Accents cassés dans le PDF de secours | Hors Latin-1 | Transposés par `PdfSecours` (tirets, guillemets, œ) ; pas d'image, pas de couleur : limites assumées |

## 8. Pour aller plus loin

- `howto-documents-01` (intégrer le pack), `howto-documents-02` (fichiers).
- Code de référence de l'extraction : `APP-28-Your360/your360/src/main/java/eu/lmvi/restitution/`.
