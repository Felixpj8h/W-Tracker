"""SQLite guards for the routine-to-folder ownership boundary."""

TRIGGERS = {
    "routine_folder_insert": """
CREATE TRIGGER IF NOT EXISTS routine_folder_insert BEFORE INSERT ON routines
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS
(SELECT 1 FROM routine_folders WHERE id=NEW.folder_id AND owner_email=NEW.owner_email)
BEGIN SELECT RAISE(ABORT, 'Invalid routine folder'); END
""",
    "routine_folder_update": """
CREATE TRIGGER IF NOT EXISTS routine_folder_update BEFORE UPDATE OF folder_id, owner_email ON routines
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS
(SELECT 1 FROM routine_folders WHERE id=NEW.folder_id AND owner_email=NEW.owner_email)
BEGIN SELECT RAISE(ABORT, 'Invalid routine folder'); END
""",
    "routine_folder_delete": """
CREATE TRIGGER IF NOT EXISTS routine_folder_delete BEFORE DELETE ON routine_folders
WHEN EXISTS (SELECT 1 FROM routines WHERE folder_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'Folder still contains routines'); END
""",
    "routine_folder_owner": """
CREATE TRIGGER IF NOT EXISTS routine_folder_owner BEFORE UPDATE OF owner_email ON routine_folders
WHEN EXISTS (SELECT 1 FROM routines WHERE folder_id=OLD.id AND owner_email!=NEW.owner_email)
BEGIN SELECT RAISE(ABORT, 'Invalid folder owner'); END
""",
}


def install_folder_guards(connection):
    if connection.dialect.name != "sqlite":
        return
    connection.exec_driver_sql("""
        UPDATE routines SET folder_id=NULL WHERE folder_id IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM routine_folders WHERE id=routines.folder_id AND owner_email=routines.owner_email)
    """)
    for statement in TRIGGERS.values():
        connection.exec_driver_sql(statement)
