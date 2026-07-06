### Création de Table PostgreSQL

**Nom de la Table**: [NomDeLaTable]

**Schéma**: [NomDuSchéma] (si non spécifié, utiliser 'public')

**Champs de la Table (Liste initiale)**:
1. `x_id` - `BIGINT` (Identité, généré automatiquement)
2. `x_dateCreated` - `timestamp with time zone NOT NULL DEFAULT now()`, (Date de création, Valeur par défaut: CURRENT_TIMESTAMP, Non Null)
3. `x_dateChanged` - `timestamp with time zone,` (Date de modification, mis à jour par un trigger)
4. `x_sub` - `VARCHAR(255)` (Sujet)
4.1 'x_partition' 'varchar(30)' (partiton le cas echeant)
5. `x_comment` - `JSONB` (Stockage des commentaires et changements en JSON)
5.1    `x_keyhash`          `VARCHAR(32)`, clef pour le hash
5.2    `x_hash`             `VARCHAR(32)`, hash de l'enregistrement

6. [Autres champs spécifiques à chaque table]

**Séquence**:
- Nom de la séquence: `[NomDuSchéma]_seq_[NomDeLaTable]_x_id`
- Commence avec 1, s'incrémente de 1

**Triggers**:



 Creer les triggers suivants :
1-						-- Trigger: after_insert_audit_[NomDeLaTable]
							
							-- DROP TRIGGER IF EXISTS after_insert_audit_[NomDeLaTable] ON [NomDuSchéma].[NomDeLaTable];
							
							CREATE  TRIGGER after_insert_audit_[NomDeLaTable]
							    after INSERT
							    ON [NomDuSchéma].[NomDeLaTable]
							    FOR EACH ROW
							    EXECUTE FUNCTION public.z_after_insert();
							    
2-  					-- Trigger: after_delete_audit_[NomDeLaTable]
							
							-- DROP TRIGGER IF EXISTS after_delete_audit_[NomDeLaTable] ON [NomDuSchéma].[NomDeLaTable];
							
							CREATE  TRIGGER after_delete_audit_[NomDeLaTable]
							    after DELETE
							    ON [NomDuSchéma].[NomDeLaTable]
							    FOR EACH ROW
							    EXECUTE FUNCTION public.z_after_delete();
							    
3-						-- Trigger: after_update_audit_[NomDeLaTable]
							
							-- DROP TRIGGER IF EXISTS after_update_audit_[NomDeLaTable] ON [NomDuSchéma].[NomDeLaTable];
							
							CREATE  TRIGGER after_update_audit_[NomDeLaTable]
							    after update
							    ON [NomDuSchéma].[NomDeLaTable]
							    FOR EACH ROW
							    EXECUTE FUNCTION public.z_after_update();

4-					-- Trigger: after_update_[NomDeLaTable]
						
						-- DROP TRIGGER IF EXISTS after_update_[NomDeLaTable] ON [NomDuSchéma].[NomDeLaTable];
						
						CREATE  TRIGGER after_update_[NomDeLaTable]
						    after UPDATE 
						    ON [NomDuSchéma].[NomDeLaTable]
						    FOR EACH ROW
						    EXECUTE FUNCTION public.update_changed_fields();
						    

```
**Permissions**:
- Définir le propriétaire de la table à l'utilsateur createur.

### Instructions
1. Créer la séquence spécifique à la table.
2. Créer la table avec les champs initiaux spécifiés.
3. pour tous les champs qui sont lié à une autre table par leur x_id, le nom du champs sera toujour : "id_"+le nom de la table vers laquelle le champs pointe.
4. Ajouter les triggers conformément aux détails fournis.
5. Configurer les permissions de la table.
6. La structure permet d'ajouter facilement des champs supplémentaires à la table selon les besoins futurs.
7. On ajoutes à la fin de chaque table un champs datas au jormat JSONB
8. Si une Clef primaire existe on la garde sinon on utilise x_id comme clef primaire
9. Si il y a déjà un champ "id" dans la définiton de la table on le rempace par le x_id qui prendra le role de l'"id"
10. Les fonctions appelées par les triggers existent déjà dans la base de données

**Remarques supplémentaires**:
- Veiller à ce que les modifications du trigger de mise à jour n'affectent pas les performances globales de la base de données.
- Tester les triggers pour s'assurer qu'ils maintiennent la structure JSON valide et performante dans `x_comment`.