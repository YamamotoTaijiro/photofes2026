CREATE TABLE IF NOT EXISTS thumbnails (photo_index INTEGER PRIMARY KEY, image BLOB NOT NULL, content_type TEXT NOT NULL);
DELETE FROM thumbnails;
