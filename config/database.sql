CREATE TABLE initiatives (
	uuid TEXT PRIMARY KEY NOT NULL,
	mailchimp_interest_id TEXT NULL UNIQUE, notes TEXT NOT NULL DEFAULT "", parliament_api_data TEXT NULL, sent_to_parliament_at TEXT NULL, finished_in_parliament_at TEXT NULL, discussion_end_email_sent_at TEXT NULL, signing_end_email_sent_at TEXT NULL, author_url TEXT NOT NULL DEFAULT "", community_url TEXT NOT NULL DEFAULT "", organizations TEXT NOT NULL DEFAULT "[]", meetings TEXT NOT NULL DEFAULT "[]", url TEXT NOT NULL DEFAULT "", media_urls TEXT NOT NULL DEFAULT "[]", signature_milestones TEXT NOT NULL DEFAULT "{}", phase TEXT NOT NULL DEFAULT "edit", government_change_urls TEXT NOT NULL DEFAULT "[]", public_change_urls TEXT NOT NULL DEFAULT "[]", has_paper_signatures INTEGER NOT NULL DEFAULT 0, received_by_parliament_at TEXT, accepted_by_parliament_at TEXT, archived_at TEXT, parliament_decision TEXT, parliament_committee TEXT, parliament_uuid TEXT, external INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), parliament_synced_at TEXT, government_agency TEXT, sent_to_government_at TEXT, finished_in_government_at TEXT, government_contact TEXT, government_contact_details TEXT, government_decision TEXT, text TEXT, text_type TEXT, text_sha256 BLOB, undersignable INTEGER NOT NULL DEFAULT 0, parliament_token BLOB, destination TEXT, user_id INTEGER,

	FOREIGN KEY (user_id) REFERENCES users (id),

	CONSTRAINT initiatives_uuid_length
	CHECK (length(uuid) == 36),

	CONSTRAINT initiatives_user_id_or_external
	CHECK ((user_id IS NULL) = external),

	CONSTRAINT initiatives_mailchimp_interest_id
	CHECK (length(mailchimp_interest_id) > 0),

	CONSTRAINT initiatives_text_not_null
	CHECK (external OR (text IS NULL) = (phase = 'edit')),

	CONSTRAINT initiatives_text_type_not_null
	CHECK ((text IS NULL) = (text_type IS NULL)),

	CONSTRAINT initiatives_text_type_length CHECK (length(text_type) > 0),

	CONSTRAINT initiatives_text_sha256_not_null
	CHECK ((text IS NULL) = (text_sha256 IS NULL)),

	CONSTRAINT initiatives_text_sha256_length CHECK (length(text_sha256) = 32),

	CONSTRAINT initiatives_undersignable_and_text
	CHECK (NOT undersignable OR phase = 'edit' OR text IS NOT NULL),

	CONSTRAINT initiatives_destination
	CHECK (destination IS NOT NULL OR phase = 'edit')
);
CREATE TABLE initiative_messages (
	id INTEGER PRIMARY KEY NOT NULL,
	initiative_uuid TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	title TEXT NOT NULL,
	"text" TEXT NOT NULL,
	sent_at TEXT,
	sent_to TEXT NOT NULL DEFAULT '[]', origin TEXT NOT NULL DEFAULT 'message',

	FOREIGN KEY (initiative_uuid) REFERENCES initiatives (uuid) ON DELETE CASCADE,

	CONSTRAINT initiative_messages_title_length
	CHECK (length(title) > 0),

	CONSTRAINT initiative_messages_text_length
	CHECK (length("text") > 0)
);
CREATE TABLE IF NOT EXISTS "initiative_events" (
	id INTEGER PRIMARY KEY NOT NULL,
	initiative_uuid TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	created_by TEXT,
	title TEXT,
	content TEXT, origin TEXT NOT NULL DEFAULT 'admin', external_id TEXT, type TEXT NOT NULL DEFAULT 'text', user_id INTEGER,

	FOREIGN KEY (initiative_uuid) REFERENCES initiatives (uuid),
	FOREIGN KEY (user_id) REFERENCES users (id),

	CONSTRAINT initiative_events_title_length
	CHECK (length(title) > 0),

	CONSTRAINT initiative_events_text_length
	CHECK (length(content) > 0)
);
CREATE INDEX index_initiative_events_on_initiative_uuid
ON initiative_events (initiative_uuid);
CREATE TABLE IF NOT EXISTS "initiative_subscriptions" (
	initiative_uuid TEXT NULL,
	email TEXT COLLATE NOCASE NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	confirmed_at TEXT,
	confirmation_sent_at TEXT,
  update_token TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(8)))),
  created_ip TEXT NULL,
  origin TEXT NULL,
  official_interest INTEGER NOT NULL DEFAULT 1,
  author_interest INTEGER NOT NULL DEFAULT 1, comment_interest INTEGER NOT NULL DEFAULT 0,

	PRIMARY KEY (initiative_uuid, email),
	FOREIGN KEY (initiative_uuid) REFERENCES initiatives (uuid) ON DELETE CASCADE,

	CONSTRAINT iniative_subscriptions_email_length
	CHECK (length(email) > 0),

	CONSTRAINT iniative_subscriptions_update_token_length
	CHECK (length(update_token) > 0)
);
CREATE UNIQUE INDEX index_initiative_subscriptions_initiative_uuid_and_email
ON initiative_subscriptions (COALESCE(initiative_uuid, ""), email);
CREATE TABLE comments (
	id INTEGER PRIMARY KEY NOT NULL,
	uuid TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	initiative_uuid TEXT NOT NULL,
	user_uuid TEXT NOT NULL,
	parent_id INTEGER,
	title TEXT NOT NULL DEFAULT '',
	"text" TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL,

	FOREIGN KEY (user_id) REFERENCES users (id),
	FOREIGN KEY (parent_id) REFERENCES comments (id),
	FOREIGN KEY (initiative_uuid) REFERENCES initiatives (uuid),

	CONSTRAINT comments_title_present
	CHECK (
		(title != '' AND parent_id IS NULL) OR
		(title = '' AND parent_id IS NOT NULL)
	),

	CONSTRAINT comments_title_length
	CHECK (length(title) <= 140),

	CONSTRAINT comments_text_length
	CHECK (text != '' AND length(text) <= 3000)
);
CREATE UNIQUE INDEX index_comments_on_uuid
ON comments (uuid);
CREATE INDEX index_comments_on_parent_id
ON comments (parent_id);
CREATE INDEX index_comments_on_initiative_uuid
ON comments (initiative_uuid);
CREATE TABLE IF NOT EXISTS "initiative_files" (
	id INTEGER PRIMARY KEY NOT NULL,
	initiative_uuid TEXT NOT NULL,
	event_id INTEGER,
	external_id TEXT,
	external_url TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	name TEXT NOT NULL,
	title TEXT,
	url TEXT,
	content BLOB NOT NULL,
	content_type TEXT NOT NULL,

	FOREIGN KEY (initiative_uuid) REFERENCES initiatives (uuid),
	FOREIGN KEY (event_id) REFERENCES initiative_events (id) ON DELETE CASCADE,

	CONSTRAINT initiative_files_external_id_length
	CHECK (length(external_id) > 0),

	CONSTRAINT initiative_files_external_url_length
	CHECK (length(external_url) > 0),

	CONSTRAINT initiative_files_name_length
	CHECK (length(name) > 0),

	CONSTRAINT initiative_files_title_length
	CHECK (length(title) > 0),

	CONSTRAINT initiative_files_url_length
	CHECK (length(url) > 0),

	CONSTRAINT initiative_files_content_length
	CHECK (length(content) > 0),

	CONSTRAINT initiative_files_content_type_length
	CHECK (length(content_type) > 0)
);
CREATE INDEX index_initiative_files_on_initiative_uuid
ON initiative_files (initiative_uuid);
CREATE INDEX index_initiative_files_on_event_id
ON initiative_files (event_id);
CREATE UNIQUE INDEX index_initiative_files_on_event_id_and_external_id
ON initiative_files (event_id, external_id);
CREATE TABLE initiative_images (
	initiative_uuid TEXT PRIMARY KEY NOT NULL,
	data BLOB NOT NULL,
	type TEXT NOT NULL,
	preview BLOB NOT NULL,

	FOREIGN KEY (initiative_uuid) REFERENCES initiatives (uuid) ON DELETE CASCADE
);
CREATE TABLE initiative_signables (
	initiative_uuid TEXT NOT NULL,
	country TEXT NOT NULL,
	personal_id TEXT NOT NULL,
  token BLOB UNIQUE NOT NULL DEFAULT (randomblob(12)),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	xades TEXT NOT NULL,
	signed INTEGER NOT NULL DEFAULT 0,
	timestamped INTEGER NOT NULL DEFAULT 0,
	error TEXT, method TEXT NOT NULL,

	FOREIGN KEY (initiative_uuid) REFERENCES initiatives (uuid) ON DELETE CASCADE,

	CONSTRAINT initiative_signables_country_length CHECK (length(country) = 2),

	CONSTRAINT initiative_signables_personal_id_length
	CHECK (length(personal_id) > 0),

	CONSTRAINT initiative_signables_token_length CHECK (length(token) > 0),
	CONSTRAINT initiative_signables_xades_length CHECK (length(xades) > 0)
);
CREATE INDEX index_signables_on_initiative_uuid
ON initiative_signables (initiative_uuid);
CREATE TABLE initiative_signatures (
	initiative_uuid TEXT NOT NULL,
	country TEXT NOT NULL,
	personal_id TEXT NOT NULL,
	token BLOB UNIQUE NOT NULL DEFAULT (randomblob(12)),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	xades TEXT NOT NULL,
	hidden INTEGER NOT NULL DEFAULT 0,
	oversigned INTEGER NOT NULL DEFAULT 0, method TEXT NOT NULL,

	PRIMARY KEY (initiative_uuid, country, personal_id),
	FOREIGN KEY (initiative_uuid) REFERENCES initiatives (uuid),

	CONSTRAINT initiative_signatures_country_length CHECK (length(country) = 2),

	CONSTRAINT initiative_signatures_personal_id_length
	CHECK (length(personal_id) > 0),

	CONSTRAINT initiative_signatures_token_length CHECK (length(token) > 0),
	CONSTRAINT initiative_signatures_xades_length CHECK (length(xades) > 0)
);
CREATE INDEX index_signatures_on_country_and_personal_id
ON initiative_signatures (country, personal_id);
CREATE TABLE users (
	id INTEGER PRIMARY KEY NOT NULL,
	uuid BLOB UNIQUE NOT NULL,
	country TEXT,
	personal_id TEXT,
	name TEXT NOT NULL,
	official_name TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	email TEXT UNIQUE COLLATE NOCASE,
	email_confirmed_at TEXT,
	unconfirmed_email TEXT COLLATE NOCASE,
	email_confirmation_token BLOB UNIQUE,
	email_confirmation_sent_at TEXT,
	language TEXT NOT NULL DEFAULT 'et', merged_with_id INTEGER,

	FOREIGN KEY (merged_with_id) REFERENCES users (id),

	CONSTRAINT users_uuid_length CHECK (length(uuid) == 16),
	CONSTRAINT users_country_length CHECK (length(country) == 2),
	CONSTRAINT users_personal_id_length CHECK (length(personal_id) > 0),
	CONSTRAINT users_name_length CHECK (length(name) > 0),
	CONSTRAINT users_official_name_length CHECK (length(official_name) > 0),
	CONSTRAINT users_email_length CHECK (length(email) >= 3),
	CONSTRAINT users_language_length CHECK (length(language) == 2),
	CONSTRAINT users_country_uppercase CHECK (country == upper(country)),
	CONSTRAINT users_language_lowercase CHECK (language == lower(language)),

	CONSTRAINT users_unconfirmed_email_length
	CHECK (length(unconfirmed_email) >= 3),

	CONSTRAINT users_email_format CHECK (email GLOB '*?@?*'),

	CONSTRAINT users_unconfirmed_email_format
	CHECK (unconfirmed_email GLOB '*?@?*'),

	CONSTRAINT users_email_confirmation_token
	CHECK (length(email_confirmation_token) > 0),

	CONSTRAINT users_email_confirmed
	CHECK ((email IS NULL) = (email_confirmed_at IS NULL)),

	CONSTRAINT users_unconfirmed_email_token
	CHECK ((unconfirmed_email IS NULL) = (email_confirmation_token IS NULL)),

	CONSTRAINT users_email_and_unconfirmed_email_different
	CHECK (email <> unconfirmed_email),

	CONSTRAINT users_country_and_personal_id
	CHECK ((country IS NULL) = (personal_id IS NULL)),

	CONSTRAINT users_personal_id_and_official_name
	CHECK ((personal_id IS NULL) = (official_name IS NULL)),

	CONSTRAINT users_personal_id_or_email
	CHECK (
		personal_id IS NOT NULL OR
		email IS NOT NULL OR
		unconfirmed_email IS NOT NULL
	)
);
CREATE UNIQUE INDEX index_users_on_country_and_personal_id
ON users (country, personal_id);
CREATE TABLE authentications (
	id INTEGER PRIMARY KEY NOT NULL,
	country TEXT NOT NULL,
	personal_id TEXT NOT NULL,
	method TEXT NOT NULL,
	certificate BLOB,
  token BLOB UNIQUE NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	created_ip TEXT,
	created_user_agent TEXT,
	authenticated INTEGER NOT NULL DEFAULT 0,
	error TEXT,

	CONSTRAINT authentications_country_length CHECK (length(country) = 2),
	CONSTRAINT authentications_personal_id_length
	CHECK (length(personal_id) > 0),

	CONSTRAINT authentications_certificate_length CHECK (length(certificate) > 0),
	CONSTRAINT authentications_token_sha256_length CHECK (length(token) > 0),

	CONSTRAINT authentications_country_uppercase
	CHECK (country == upper(country))
);
CREATE TABLE sessions (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id INTEGER NOT NULL,
  token_sha256 BLOB UNIQUE NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	authentication_id INTEGER UNIQUE,
	method TEXT NOT NULL,
	created_ip TEXT,
	created_user_agent TEXT,
	deleted_at TEXT,

	FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

	FOREIGN KEY (authentication_id) REFERENCES authentications (id)
	ON DELETE SET NULL,

	CONSTRAINT sessions_token_sha256_length CHECK (length(token_sha256) == 32)
);
CREATE INDEX index_initiatives_on_user_id ON initiatives (user_id);
CREATE INDEX index_initiative_events_on_user_id ON initiative_events (user_id);
CREATE INDEX index_users_on_merged_with_id ON users (merged_with_id)
WHERE merged_with_id IS NOT NULL;

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE migrations (version TEXT PRIMARY KEY NOT NULL);
INSERT INTO migrations VALUES('20181201195222');
INSERT INTO migrations VALUES('20181201200519');
INSERT INTO migrations VALUES('20181209204318');
INSERT INTO migrations VALUES('20181211192927');
INSERT INTO migrations VALUES('20190108102703');
INSERT INTO migrations VALUES('20190304110736');
INSERT INTO migrations VALUES('20190310164217');
INSERT INTO migrations VALUES('20190311183208');
INSERT INTO migrations VALUES('20190410080730');
INSERT INTO migrations VALUES('20190410173242');
INSERT INTO migrations VALUES('20190427232247');
INSERT INTO migrations VALUES('20190428103608');
INSERT INTO migrations VALUES('20190428114010');
INSERT INTO migrations VALUES('20190428170006');
INSERT INTO migrations VALUES('20190519192050');
INSERT INTO migrations VALUES('20190523150859');
INSERT INTO migrations VALUES('20190527092632');
INSERT INTO migrations VALUES('20190531131546');
INSERT INTO migrations VALUES('20190531132234');
INSERT INTO migrations VALUES('20190531141956');
INSERT INTO migrations VALUES('20190607111527');
INSERT INTO migrations VALUES('20190613120456');
INSERT INTO migrations VALUES('20190614131543');
INSERT INTO migrations VALUES('20190621112243');
INSERT INTO migrations VALUES('20190628153405');
INSERT INTO migrations VALUES('20190630200833');
INSERT INTO migrations VALUES('20190701103738');
INSERT INTO migrations VALUES('20190703115616');
INSERT INTO migrations VALUES('20190708080000');
INSERT INTO migrations VALUES('20190710214809');
INSERT INTO migrations VALUES('20190710215940');
INSERT INTO migrations VALUES('20190711000000');
INSERT INTO migrations VALUES('20190711000010');
INSERT INTO migrations VALUES('20190711000020');
INSERT INTO migrations VALUES('20190711000030');
INSERT INTO migrations VALUES('20190711000040');
INSERT INTO migrations VALUES('20190711000050');
INSERT INTO migrations VALUES('20190711000060');
INSERT INTO migrations VALUES('20190711000070');
INSERT INTO migrations VALUES('20190723152855');
INSERT INTO migrations VALUES('20190724225535');
INSERT INTO migrations VALUES('20190726112230');
INSERT INTO migrations VALUES('20190819103432');
INSERT INTO migrations VALUES('20190825222200');
INSERT INTO migrations VALUES('20190902090222');
INSERT INTO migrations VALUES('20190902091043');
INSERT INTO migrations VALUES('20190902091235');
INSERT INTO migrations VALUES('20190912160618');
INSERT INTO migrations VALUES('20191021102603');
INSERT INTO migrations VALUES('20191118142601');
INSERT INTO migrations VALUES('20191118184000');
INSERT INTO migrations VALUES('20191118184010');
INSERT INTO migrations VALUES('20191118184020');
INSERT INTO migrations VALUES('20191118184030');
INSERT INTO migrations VALUES('20200106000042');
INSERT INTO migrations VALUES('20200106000100');
INSERT INTO migrations VALUES('20200106000105');
INSERT INTO migrations VALUES('20200106000110');
INSERT INTO migrations VALUES('20200106000120');
INSERT INTO migrations VALUES('20200106000130');
INSERT INTO migrations VALUES('20200124094227');
INSERT INTO migrations VALUES('20200124101632');
INSERT INTO migrations VALUES('20200124121145');
INSERT INTO migrations VALUES('20200124131836');
INSERT INTO migrations VALUES('20200125071216');
INSERT INTO migrations VALUES('20200125122607');
COMMIT;
